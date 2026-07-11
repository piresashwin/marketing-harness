#!/usr/bin/env bash
# Rsync release/ + remote/ to the shared droplet, then bring the single
# inflxr-app container up. Modeled on the hiredesq/tradex deploy pipeline.
# Idempotent — safe to re-run.
#
# This is the RECURRING deploy. For a never-deployed host (no DB role, no
# .env.production, no cert) run ./deploy/bootstrap.sh first — it does the
# one-time provisioning + cert issuance, then calls this script.
#
# inflxr.com is a SIBLING stack on the shared droplet that tradex owns: it plugs
# into tradex's nginx (the shared proxy on :80/:443), tradex's certbot, and
# tradex's Postgres (`tradex-postgres`) over the external `edge` network. It runs
# NO nginx/certbot/postgres of its own.
#
# Encodes the hard-won deploy learnings as fail-fast guards (see deploy/README.md):
#   - the compose service key MUST be prefixed (inflxr-app), never a bare
#     app/web/api/worker — a bare name leaks a generic alias onto the SHARED edge
#     net and can hijack sibling stacks' upstreams.
#   - .env.production must exist AND be complete (no empty required keys / CHANGE_ME).
#   - after `up`, verify.sh confirms the right app is served and nothing bled across
#     domains.
#
# NB: there is no migrate step here. Migrations are raw-pg and applied on container
# BOOT (runMigrations()). A bad migration therefore crashes the container on start —
# scan new migrations in src/db/migrations.ts before deploying.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HERE="$ROOT/deploy"

if [ ! -f deploy/.env.deploy ]; then
  echo "missing deploy/.env.deploy — copy from .env.deploy.example and fill in" >&2
  exit 1
fi
# shellcheck disable=SC1091
source deploy/.env.deploy
: "${DEPLOY_USER:?}" "${DEPLOY_HOST:?}" "${DEPLOY_PATH:?}"
SSH_OPTS="${SSH_OPTS:-}"
# Shared reverse-proxy integration (inflxr is a sibling behind the tradex nginx):
SHARED_NET="${SHARED_NET:-edge}"
VHOST_DIR="${VHOST_DIR:-/srv/nginx-vhosts}"
PROXY_CONTAINER="${PROXY_CONTAINER:-tradex-nginx}"
# Container name of the SHARED Postgres (tradex's) that inflxr-app connects to over
# $SHARED_NET. It ships only on tradex's private net, so we attach it to the shared
# net here (idempotent).
SHARED_PG_CONTAINER="${SHARED_PG_CONTAINER:-tradex-postgres}"
APP_HOST="$(printf '%s' "${PUBLIC_APP_URL:-https://inflxr.com}" | sed -E 's#^https?://##; s#/.*$##')"

TARGET="$DEPLOY_USER@$DEPLOY_HOST"
COMPOSE="docker-compose.prod.yml"
ENVFILE=".env.production"
# Compose SERVICE key (NOT the container name). Prefixed on purpose — see guard.
SERVICES="inflxr-app"
VHOST_FILE="$APP_HOST.conf"
sshq() { # shellcheck disable=SC2086
  ssh $SSH_OPTS "$TARGET" "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# Preflight (local) — cheap guards that catch the mistakes the sibling stacks
# actually made.
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -d release ]; then
  echo "no release/ — run ./deploy/build.sh first" >&2
  exit 1
fi

# COLLISION GUARD: a bare app/web/api/worker compose service name registers that
# name as an alias on the shared edge net (docker adds the service name as a
# per-network alias). Sibling stacks resolve bare web/api for their OWN upstreams
# and would be hijacked. The service key must be inflxr-prefixed so the only edge
# alias is the unique container name.
if grep -nE '^[[:space:]]{2}(app|web|api|worker):[[:space:]]*$' "deploy/remote/$COMPOSE" >/dev/null; then
  echo "ERROR: deploy/remote/$COMPOSE defines a BARE service name (app/web/api/worker)." >&2
  echo "       On the shared '$SHARED_NET' net that leaks a generic alias and can hijack" >&2
  echo "       sibling stacks. Rename the service key to inflxr-* (keep container_name)." >&2
  exit 1
fi

echo "==> ensuring $DEPLOY_PATH + shared proxy paths + shared net exist on $TARGET"
sshq "mkdir -p '$DEPLOY_PATH' '$VHOST_DIR' && docker network create '$SHARED_NET' 2>/dev/null || true"

echo "==> attaching $SHARED_PG_CONTAINER to '$SHARED_NET' so inflxr-app can reach the shared DB"
sshq "docker network connect '$SHARED_NET' '$SHARED_PG_CONTAINER' 2>/dev/null || true; \
  docker network inspect '$SHARED_NET' --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | grep -qw '$SHARED_PG_CONTAINER' \
    && echo '   $SHARED_PG_CONTAINER is on $SHARED_NET' \
    || echo 'WARN: $SHARED_PG_CONTAINER not on $SHARED_NET (is tradex deployed?). inflxr-app will fail to reach the DB until it is.' >&2"

# ─────────────────────────────────────────────────────────────────────────────
# Preflight (remote) — .env.production exists AND is complete.
# ─────────────────────────────────────────────────────────────────────────────
echo "==> validating $ENVFILE on the droplet"
# shellcheck disable=SC2086
ssh $SSH_OPTS "$TARGET" "DEPLOY_PATH='$DEPLOY_PATH' ENVFILE='$ENVFILE' bash -s" <<'REMOTE'
set -euo pipefail
cd "$DEPLOY_PATH"
if [ ! -f "$ENVFILE" ]; then
  echo "ERROR: $ENVFILE missing on droplet. Run ./deploy/bootstrap.sh (first deploy) or" >&2
  echo "       copy .env.production.example → $ENVFILE and fill it in, then re-run." >&2
  exit 1
fi
missing=""
# Keys with no safe default — the app cannot publish to Instagram without them.
required="DATABASE_URL PUBLIC_BASE_URL APP_ENCRYPTION_KEY IG_CLIENT_ID IG_CLIENT_SECRET RESEND_API_KEY"
# S3 creds are only needed when the media store is s3 (env.ts defaults MEDIA_STORE
# to s3, so treat an unset value as s3). A local store serves /media from the
# container and needs none of them.
media_store="$(grep -E '^MEDIA_STORE=' "$ENVFILE" | head -n1 | cut -d= -f2- || true)"
if [ "${media_store:-s3}" = "s3" ]; then
  required="$required S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET S3_PUBLIC_BASE_URL"
fi
for k in $required; do
  grep -qE "^${k}=.+" "$ENVFILE" || missing="$missing $k"
done
if [ -n "$missing" ]; then
  echo "ERROR: $ENVFILE has empty/missing required key(s):$missing" >&2
  exit 1
fi
if grep -q 'CHANGE_ME' "$ENVFILE"; then
  echo "ERROR: $ENVFILE still contains CHANGE_ME placeholder(s) — fill in real values." >&2
  exit 1
fi
echo "   $ENVFILE present and complete"
REMOTE

echo "==> snapshotting previous release on droplet (for rollback)"
sshq "cd '$DEPLOY_PATH' && rm -rf release.prev && (cp -al release release.prev 2>/dev/null || cp -R release release.prev 2>/dev/null || true)"

echo "==> rsync release/ → $TARGET:$DEPLOY_PATH/release/"
# shellcheck disable=SC2086
rsync -az --delete \
  ${SSH_OPTS:+-e "ssh $SSH_OPTS"} \
  release/ "$TARGET:$DEPLOY_PATH/release/"

echo "==> rsync remote/ scaffolding → $TARGET:$DEPLOY_PATH/"
# --delete clears stale files, but protect droplet-only paths:
#   release/, release.prev/   shipped above — don't nuke
#   .env.production           populated secrets (never overwrite/delete)
# shellcheck disable=SC2086
rsync -az --delete \
  --exclude='release/' \
  --exclude='release.prev/' \
  --exclude='.env.production' \
  ${SSH_OPTS:+-e "ssh $SSH_OPTS"} \
  deploy/remote/ "$TARGET:$DEPLOY_PATH/"

sshq "chmod +x '$DEPLOY_PATH/provision-shared-db.sh' 2>/dev/null || true"

echo "==> publishing vhost → $VHOST_DIR/$VHOST_FILE and reloading $PROXY_CONTAINER"
# Drop the vhost into the shared host dir (outside any rsync --delete tree), then
# validate + hot-reload the tradex nginx. A bad config fails `nginx -t` and we
# abort WITHOUT reloading, so a broken vhost can never take the shared proxy down.
# On a first deploy the cert doesn't exist yet → `nginx -t` fails → we copy but
# skip the reload and warn (bootstrap.sh issues the cert, then re-runs this).
sshq "cp '$DEPLOY_PATH/nginx-vhosts/$VHOST_FILE' '$VHOST_DIR/$VHOST_FILE' && \
  if docker exec '$PROXY_CONTAINER' nginx -t 2>/dev/null; then \
    docker exec '$PROXY_CONTAINER' nginx -s reload && echo '   vhost reloaded'; \
  else \
    echo 'WARN: $PROXY_CONTAINER nginx -t failed or container not running — vhost copied but NOT reloaded. Issue the cert (./deploy/bootstrap.sh or README), then re-run.' >&2; \
  fi"

echo "==> docker compose up -d --build --remove-orphans ($SERVICES)"
# --remove-orphans clears containers from a previous service layout so they don't
# linger with stale aliases on the shared net. NB: the image build can take a
# couple of minutes; when invoked by an agent/CI with a command timeout, run in
# the background (see README "Running the build").
# shellcheck disable=SC2086
sshq "cd '$DEPLOY_PATH' && \
  docker compose -f '$COMPOSE' --env-file '$ENVFILE' up -d --build --remove-orphans $SERVICES"

# Re-resolve the shared proxy's upstreams after recreate. inflxr's own vhost uses
# a runtime resolver so it self-heals, but reloading is cheap insurance.
echo "==> reloading $PROXY_CONTAINER post-up"
sshq "docker exec '$PROXY_CONTAINER' nginx -t 2>/dev/null && docker exec '$PROXY_CONTAINER' nginx -s reload 2>/dev/null && echo '   reloaded' || echo '   (reload skipped — cert not yet issued)'"

# ─────────────────────────────────────────────────────────────────────────────
# Postflight verification (health + per-domain correctness + collision guard).
# ─────────────────────────────────────────────────────────────────────────────
if [ -x "$HERE/verify.sh" ]; then
  echo "==> verifying deployment"
  "$HERE/verify.sh" || echo "WARN: verify.sh reported issues (see above)." >&2
fi

echo
echo "==> done. Migrations apply automatically on container boot."
echo "Tail logs:  ssh $TARGET 'cd $DEPLOY_PATH && docker compose -f $COMPOSE --env-file $ENVFILE logs -f --tail=200'"

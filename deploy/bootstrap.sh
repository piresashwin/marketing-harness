#!/usr/bin/env bash
# FIRST-DEPLOY orchestrator for a never-deployed host. Idempotent — each phase
# checks whether it's already done, so it's safe to re-run after a failure.
# For subsequent deploys use ./deploy/deploy.sh directly.
#
# Sequences the one-time steps for a new sibling on the shared tradex droplet:
#   0. preflight: .env.production must already exist on the droplet and be
#      complete (a human fills the secrets — this script never generates or
#      echoes secrets; the guard-secrets hook blocks that anyway).
#   1. ensure the shared `edge` net + deploy paths exist
#   2. ship the remote/ scaffolding (compose + Dockerfile + provision + vhost)
#   3. provision the `inflxr` DB/role INSIDE tradex-postgres (password parsed
#      from .env.production's DATABASE_URL so provisioning + runtime can't drift)
#   4. build + first deploy (container comes up; vhost copied, reload skipped —
#      the TLS cert doesn't exist yet). Migrations apply on container boot.
#   5. cert bootstrap: verify DNS → temp ACME vhost → issue via the SHARED certbot
#   6. re-deploy so the full TLS vhost loads + reloads the proxy
#   7. verify

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HERE="$ROOT/deploy"
# shellcheck disable=SC1091
source deploy/.env.deploy
: "${DEPLOY_USER:?}" "${DEPLOY_HOST:?}" "${DEPLOY_PATH:?}"
SSH_OPTS="${SSH_OPTS:-}"
SHARED_NET="${SHARED_NET:-edge}"
VHOST_DIR="${VHOST_DIR:-/srv/nginx-vhosts}"
PROXY_CONTAINER="${PROXY_CONTAINER:-tradex-nginx}"
SHARED_PG_CONTAINER="${SHARED_PG_CONTAINER:-tradex-postgres}"
# Cert bootstrap settings (shared tradex certbot).
TRADEX_DEPLOY_PATH="${TRADEX_DEPLOY_PATH:-/opt/tradex}"
CERT_EMAIL="${CERT_EMAIL:-admin@inflxr.com}"

TARGET="$DEPLOY_USER@$DEPLOY_HOST"
APP_HOST="$(printf '%s' "${PUBLIC_APP_URL:-https://inflxr.com}" | sed -E 's#^https?://##; s#/.*$##')"
WWW_HOST="www.$APP_HOST"
ENVFILE=".env.production"
VHOST_FILE="$APP_HOST.conf"
sshq() { # shellcheck disable=SC2086
  ssh $SSH_OPTS "$TARGET" "$@"
}

echo "######## inflxr first-deploy bootstrap → $TARGET ($APP_HOST) ########"

# ── 0. env preflight ─────────────────────────────────────────────────────────
echo "==> [0/7] checking $ENVFILE on the droplet"
sshq "mkdir -p '$DEPLOY_PATH'"
if ! sshq "test -f '$DEPLOY_PATH/$ENVFILE'"; then
  cat >&2 <<EOF
ERROR: $DEPLOY_PATH/$ENVFILE does not exist.
  This script never invents secrets. Create it first (on the droplet):
    cp $DEPLOY_PATH/.env.production.example $DEPLOY_PATH/$ENVFILE
    \$EDITOR $DEPLOY_PATH/$ENVFILE   # fill DATABASE_URL (→ tradex-postgres),
                                     # generate APP_ENCRYPTION_KEY (openssl rand -hex 32),
                                     # set IG_*, S3_*/R2, RESEND_*.
  Then re-run this script.
EOF
  exit 1
fi
sshq "cd '$DEPLOY_PATH' && grep -q CHANGE_ME '$ENVFILE' && { echo 'ERROR: $ENVFILE still has CHANGE_ME placeholders.' >&2; exit 1; } || true"

# ── 1. shared net + paths ────────────────────────────────────────────────────
echo "==> [1/7] ensuring shared net '$SHARED_NET' + paths"
sshq "mkdir -p '$DEPLOY_PATH' '$VHOST_DIR' && docker network create '$SHARED_NET' 2>/dev/null || true"

# ── 2. ship scaffolding (compose/Dockerfile/provision/vhost live in remote/) ──
echo "==> [2/7] shipping remote/ scaffolding"
# shellcheck disable=SC2086
rsync -az --delete --exclude='release/' --exclude='release.prev/' --exclude="$ENVFILE" \
  ${SSH_OPTS:+-e "ssh $SSH_OPTS"} deploy/remote/ "$TARGET:$DEPLOY_PATH/"
sshq "chmod +x '$DEPLOY_PATH/provision-shared-db.sh' 2>/dev/null || true"

# ── 3. provision DB (password parsed from .env.production) ────────────────────
echo "==> [3/7] provisioning inflxr DB/role in $SHARED_PG_CONTAINER"
# Parse the password out of DATABASE_URL on the droplet so it always matches the
# runtime connection. Done remotely — the secret never transits this machine.
sshq "set -e; cd '$DEPLOY_PATH'; \
  url=\$(grep -E '^DATABASE_URL=' '$ENVFILE' | head -n1 | cut -d= -f2-); \
  pw=\$(printf '%s' \"\$url\" | sed -E 's#^[^:]+://[^:]+:([^@]+)@.*#\1#'); \
  [ -n \"\$pw\" ] || { echo 'ERROR: could not parse DB password from DATABASE_URL' >&2; exit 1; }; \
  INFLXR_DB_PASSWORD=\"\$pw\" PG_CONTAINER='$SHARED_PG_CONTAINER' ./provision-shared-db.sh"

# ── 4. build + first deploy (no cert yet) ────────────────────────────────────
echo "==> [4/7] building release/ locally"
"$HERE/build.sh"
echo "==> [4/7] first deploy (vhost copied; proxy reload skipped until the cert exists)"
"$HERE/deploy.sh" || true   # verify.sh inside will warn about the missing cert — expected here

# ── 5. cert bootstrap ────────────────────────────────────────────────────────
echo "==> [5/7] TLS cert for $APP_HOST"
if sshq "test -d '$TRADEX_DEPLOY_PATH/certbot/conf/live/$APP_HOST'"; then
  echo "   cert already present — skipping issuance"
else
  resolved="$(dig +short @1.1.1.1 "$APP_HOST" A 2>/dev/null | tr '\n' ' ')"
  if ! printf '%s' "$resolved" | grep -qw "$DEPLOY_HOST"; then
    cat >&2 <<EOF
ERROR: $APP_HOST resolves to [$resolved], not $DEPLOY_HOST.
  Point $APP_HOST + $WWW_HOST at $DEPLOY_HOST (A records, DNS-only / grey-cloud)
  so the Let's Encrypt HTTP-01 challenge reaches this droplet, then re-run.
EOF
    exit 1
  fi
  echo "   DNS OK ($APP_HOST → $DEPLOY_HOST). Installing temp ACME vhost + issuing cert."
  sshq "cat > '$VHOST_DIR/$VHOST_FILE' <<EOF
server {
  listen 80;
  server_name $APP_HOST $WWW_HOST;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 404; }
}
EOF
  docker exec '$PROXY_CONTAINER' nginx -t && docker exec '$PROXY_CONTAINER' nginx -s reload"
  # Issue via the SHARED tradex certbot (run from tradex's deploy path).
  sshq "cd '$TRADEX_DEPLOY_PATH' && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
    --entrypoint '' certbot certbot certonly --webroot -w /var/www/certbot \
    -d '$APP_HOST' -d '$WWW_HOST' --email '$CERT_EMAIL' --agree-tos --no-eff-email"
fi

# ── 6. re-deploy so the full TLS vhost loads ─────────────────────────────────
echo "==> [6/7] re-deploy (installs full TLS vhost + reloads proxy)"
"$HERE/deploy.sh"

# ── 7. verify ────────────────────────────────────────────────────────────────
echo "==> [7/7] verifying"
"$HERE/verify.sh"

echo
echo "######## bootstrap complete — https://$APP_HOST should be live ########"

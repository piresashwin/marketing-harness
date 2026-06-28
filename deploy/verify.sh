#!/usr/bin/env bash
# Post-deploy verification for inflxr.com on the shared droplet.
# Run standalone any time, or automatically at the end of deploy.sh.
#
# Encodes the sibling-stack deploy incident as automated checks so it can't
# silently recur:
#   1. the inflxr-app container is Up
#   2. it does NOT leak a bare app/web/api/worker alias onto the shared net
#      (the alias collision that once hijacked a sibling's upstreams)
#   3. inflxr.com serves the inflxr app over HTTPS, and /healthz is reachable
#   4. every SIBLING domain on the shared proxy still serves ITS OWN app — i.e.
#      inflxr did not bleed across (catches "hiredesq.com is loading inflxr")
#   5. the TLS cert covers inflxr.com
#
# Exit non-zero if any HARD check fails. Curls run ON the droplet against
# 127.0.0.1 (the shared nginx) so the result is independent of where you run this.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
[ -f deploy/.env.deploy ] && source deploy/.env.deploy
: "${DEPLOY_USER:?set in deploy/.env.deploy}" "${DEPLOY_HOST:?}"
SSH_OPTS="${SSH_OPTS:-}"
SHARED_NET="${SHARED_NET:-edge}"
PROXY_CONTAINER="${PROXY_CONTAINER:-tradex-nginx}"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"

# inflxr's public host, derived from PUBLIC_APP_URL (deploy/.env.deploy).
APP_HOST="$(printf '%s' "${PUBLIC_APP_URL:-https://inflxr.com}" | sed -E 's#^https?://##; s#/.*$##')"
# A string in inflxr's served HTML shell but NOT on a sibling app's homepage.
# The SPA is client-rendered, so curl only sees index.html — match its <title>.
APP_MARKER="${APP_MARKER:-Marketing Harness}"
# Space-separated OTHER domains served by the SAME shared proxy. Each must NOT
# render the inflxr marker. Set SIBLING_PROXY_DOMAINS in deploy/.env.deploy.
SIBLING_PROXY_DOMAINS="${SIBLING_PROXY_DOMAINS:-}"

# Single container (container_name is fixed in compose, independent of service key).
CONTAINERS="inflxr-app"

# shellcheck disable=SC2086
ssh $SSH_OPTS "$TARGET" \
  "SHARED_NET='$SHARED_NET' PROXY_CONTAINER='$PROXY_CONTAINER' APP_HOST='$APP_HOST' \
   APP_MARKER='$APP_MARKER' SIBLING_PROXY_DOMAINS='$SIBLING_PROXY_DOMAINS' \
   CONTAINERS='$CONTAINERS' bash -s" <<'REMOTE'
set -uo pipefail
fail=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*" >&2; fail=1; }
warn() { echo "  ! $*" >&2; }

echo "== 1. container health =="
for c in $CONTAINERS; do
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  [ "$st" = "running" ] && ok "$c running" || bad "$c is '$st' (expected running)"
done

echo "== 2. shared-net alias collision guard ($SHARED_NET) =="
for c in $CONTAINERS; do
  aliases="$(docker inspect -f "{{json .NetworkSettings.Networks.$SHARED_NET.Aliases}}" "$c" 2>/dev/null || echo null)"
  # Match the EXACT quoted JSON token "app"/"web"/"api"/"worker" — not a substring,
  # so "inflxr-app" (the legit container-name alias) does not trip the guard.
  if printf '%s' "$aliases" | grep -qE '"(app|web|api|worker)"'; then
    bad "$c exposes a BARE alias on $SHARED_NET ($aliases) — will hijack sibling upstreams. Prefix the compose service key."
  else
    ok "$c aliases clean ($aliases)"
  fi
done

echo "== 3. inflxr.com serves the inflxr app =="
code="$(curl -sS -o /dev/null -w '%{http_code}' --resolve "$APP_HOST:443:127.0.0.1" "https://$APP_HOST/" -k 2>/dev/null || echo 000)"
body="$(curl -sS --resolve "$APP_HOST:443:127.0.0.1" "https://$APP_HOST/" -k 2>/dev/null || true)"
[ "$code" = "200" ] && ok "https://$APP_HOST/ → 200" || bad "https://$APP_HOST/ → $code (expected 200)"
printf '%s' "$body" | grep -qi "$APP_MARKER" && ok "homepage shell contains marker '$APP_MARKER'" || bad "homepage missing marker '$APP_MARKER' (wrong app served?)"
hcode="$(curl -sS -o /dev/null -w '%{http_code}' --resolve "$APP_HOST:443:127.0.0.1" "https://$APP_HOST/healthz" -k 2>/dev/null || echo 000)"
[ "$hcode" = "200" ] && ok "/healthz → 200" || bad "/healthz → $hcode (expected 200)"

echo "== 4. cross-domain bleed guard =="
if [ -z "$SIBLING_PROXY_DOMAINS" ]; then
  warn "SIBLING_PROXY_DOMAINS unset — skipping bleed guard. Set it in deploy/.env.deploy (e.g. 'hiredesq.com tradex.inflxr.com')."
else
  for d in $SIBLING_PROXY_DOMAINS; do
    sbody="$(curl -sS --resolve "$d:443:127.0.0.1" "https://$d/" -k 2>/dev/null || true)"
    if printf '%s' "$sbody" | grep -qi "$APP_MARKER"; then
      bad "$d is serving the INFLXR app (marker '$APP_MARKER' present) — cross-domain bleed!"
    else
      ok "$d still serves its own app (no inflxr marker)"
    fi
  done
fi

echo "== 5. TLS cert covers $APP_HOST =="
cn="$(echo | openssl s_client -servername "$APP_HOST" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null)"
if printf '%s' "$cn" | grep -q "$APP_HOST"; then ok "cert covers $APP_HOST"; else warn "could not confirm cert covers $APP_HOST (cert may be Cloudflare-terminated or not yet issued)"; fi

echo
[ "$fail" = 0 ] && echo "VERIFY: PASS" || echo "VERIFY: FAIL (see ✗ above)"
exit "$fail"
REMOTE

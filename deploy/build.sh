#!/usr/bin/env bash
# Local build → assembles a deployable release/ snapshot for the SINGLE
# marketing-harness container (one Express process that serves the REST API, the
# MCP endpoint, auth, connector OAuth, /media, AND the Vite SPA from web/dist —
# see src/index.ts). Run this BEFORE deploy.sh. deploy.sh rsyncs release/ to the
# droplet, where a thin Docker image runs `npm ci --omit=dev` + `node dist/index.js`.
#
# This is intentionally MUCH simpler than the hiredesq monorepo build:
#   - NO prisma generate / no node_modules symlink repair (raw `pg`, pure-JS deps).
#   - NO build-time SPA env baking. The SPA calls RELATIVE /api,/auth on its own
#     origin (web/src/api.ts), so nothing about the public URL is compiled in —
#     deploy/.env.deploy carries no PUBLIC_APP_URL to bake.
#   - NO migrate artifact. Migrations are raw-pg and run on container BOOT
#     (runMigrations() in src/db/index.ts), so there is nothing to ship for them.
#
# Produces release/{dist,web/dist,package.json,package-lock.json}.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RELEASE_DIR="$ROOT/release"

echo "==> installing deps (frozen) — root + web"
npm ci
npm ci --prefix web

echo "==> typecheck (root + web) — gate before shipping"
npm run typecheck
npm run typecheck --prefix web

echo "==> build (tsc → dist/, vite → web/dist/)"
npm run build

if [ ! -d dist ] || [ ! -d web/dist ]; then
  echo "ERROR: expected dist/ and web/dist/ after build — got dist:$( [ -d dist ] && echo y || echo n ) web/dist:$( [ -d web/dist ] && echo y || echo n )" >&2
  exit 1
fi

echo "==> cleaning $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/web"

echo "==> assembling release/ (dist, web/dist, package manifests)"
cp -R dist "$RELEASE_DIR/dist"
cp -R web/dist "$RELEASE_DIR/web/dist"
cp package.json package-lock.json "$RELEASE_DIR/"

echo
echo "==> release sizes"
du -sh "$RELEASE_DIR"/* 2>/dev/null || true
echo
echo "release ready at $RELEASE_DIR — now run ./deploy/deploy.sh"

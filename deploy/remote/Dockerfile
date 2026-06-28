# Thin image wrapping the rsynced release/ folder.
# Build context = ./release (set in docker-compose.prod.yml). release/ holds the
# compiled backend (dist/), the built SPA (web/dist/), and the package manifests.
# Prod deps are installed HERE (pure-JS: express, pg, @aws-sdk, mcp-sdk, zod) —
# no native engines, no prisma generate, so `npm ci --omit=dev` is clean.
FROM node:20-alpine

RUN apk add --no-cache curl
WORKDIR /app

# Install prod deps first so this layer caches across deploys that only change code.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled backend + built SPA (served from /app/web/dist — matches the
# path.resolve("web/dist") in src/index.ts, relative to WORKDIR).
COPY dist ./dist
COPY web/dist ./web/dist

ENV NODE_ENV=production \
    PORT=8787

EXPOSE 8787

# runMigrations() runs on boot; the server then listens on :8787.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8787/healthz || exit 1

CMD ["node", "dist/index.js"]

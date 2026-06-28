# Deploy — inflxr.com

Rsync-based deploy to the **shared droplet** (the same host as tradex + hiredesq).
The local machine builds the dist artifacts; rsync ships them; a thin Docker image
on the droplet installs prod deps, COPYs the artifacts, and runs them. TLS + reverse
proxy + Postgres are **not** part of this stack — the **tradex nginx is the shared
proxy** and fronts `inflxr.com`, and Postgres is the shared `tradex-postgres`.

## Architecture

- **One container.** `inflxr-app` runs the whole app: a single Express process
  (`src/index.ts`) serving the REST API (`/api`), magic-link auth (`/auth`),
  connector OAuth (`/connectors`), the MCP endpoint (`/mcp`), `/media`, `/healthz`,
  **and** the built Vite SPA from `web/dist`. No web/api/worker split. The compose
  **service key is `inflxr-app` on purpose** — a bare `app`/`web`/`api` service name
  leaks that alias onto the shared `edge` net and can hijack a sibling's upstreams.
- **Shared Postgres.** `inflxr-app` connects to tradex's **`tradex-postgres`**
  container over the `edge` net, to a **separate `inflxr` database + role** inside
  that instance (created once by `remote/provision-shared-db.sh`). The
  `DATABASE_URL` host is the **container name `tradex-postgres`**. **Migrations run
  on container boot** (`runMigrations()` — raw `pg`, no Prisma, no separate migrate
  step).
- **Shared nginx / certbot.** The tradex nginx owns `:80/:443`. inflxr registers a
  vhost by dropping `nginx-vhosts/inflxr.com.conf` into **`/srv/nginx-vhosts`** on
  the host (tradex mounts it at `/etc/nginx/vhosts` and `include`s it). The cert is
  issued/renewed by the **shared tradex certbot**. The vhost has **one upstream**
  (`inflxr-app:8787`) and does no path rewriting.
- **Media.** `MEDIA_STORE=s3` → a **public** S3/R2 bucket, because Instagram fetches
  media over the public internet (CLAUDE.md §5). No stateful volume in this stack.

## Prerequisites (one-time, on the droplet)

1. **tradex is deployed** with the shared-proxy setup — its nginx mounts
   `/srv/nginx-vhosts` and `include`s `/etc/nginx/vhosts/*.conf`, its nginx joins
   the `edge` network, and `tradex-postgres` is up. (Already true — hiredesq is a
   sibling on the same box.)
2. **DNS**: `inflxr.com` + `www.inflxr.com` A records → the droplet IP, **DNS-only
   (grey-cloud)** if behind Cloudflare, resolving before the cert is requested
   (`bootstrap.sh` refuses to issue until DNS points here). ⚠️ Confirm nothing
   already serves the `inflxr.com` apex on the shared proxy (tradex runs at
   `tradex.inflxr.com`) — the verify bleed guard will flag a collision.
3. **Object storage**: a public S3/R2 bucket + keys for `S3_*` in `.env.production`.

## Local config

```bash
cp deploy/.env.deploy.example deploy/.env.deploy
$EDITOR deploy/.env.deploy   # DEPLOY_HOST, shared-infra vars, SIBLING_PROXY_DOMAINS
```

## Scripts

| Script | When | What it does |
|---|---|---|
| `deploy/build.sh` | every deploy | `npm ci` (root+web) → typecheck → build → assemble `release/{dist,web/dist,manifests}`. |
| `deploy/deploy.sh` | every deploy | Preflight guards → rsync → vhost reload → `compose up --build --remove-orphans` → `verify.sh`. Idempotent. |
| `deploy/verify.sh` | after every deploy (auto + standalone) | Container health, **alias-collision guard**, homepage + `/healthz` correctness, **cross-domain bleed guard**, cert check. Exits non-zero on failure. |
| `deploy/bootstrap.sh` | **first deploy only** | One-time: shared net → provision DB → first deploy → cert bootstrap → re-deploy → verify. Idempotent/re-runnable. |
| `deploy/remote/provision-shared-db.sh` | first deploy (called by bootstrap) | Creates the `inflxr` role + DB inside `tradex-postgres` (+ best-effort pgvector/pg_trgm). |

## First deploy (one command, after secrets are in place)

```bash
# 1. create + fill the prod secrets ON THE DROPLET (the only manual step —
#    bootstrap.sh never invents secrets):
ssh root@<droplet> 'cd /opt/inflxr && cp .env.production.example .env.production'
ssh root@<droplet> '$EDITOR /opt/inflxr/.env.production'
#    DATABASE_URL password (single source of truth — bootstrap parses it to
#    provision the role), APP_ENCRYPTION_KEY (openssl rand -hex 32), IG_*, S3_*/R2,
#    RESEND_*. DNS: point inflxr.com + www at the droplet (A records, grey-cloud).

# 2. run the bootstrap — provisions, deploys, issues the cert, verifies:
./deploy/bootstrap.sh
```

The full vhost references a TLS cert that doesn't exist on a first run, so the
tradex nginx won't load it (deploy.sh copies the vhost, skips the reload, warns —
tradex/hiredesq stay up). `bootstrap.sh` handles the cert dance: checks DNS points
here, installs a temporary HTTP-only ACME vhost, issues via the **shared tradex
certbot**, then re-deploys so the full TLS vhost loads.

## Subsequent deploys

```bash
./deploy/build.sh && ./deploy/deploy.sh
```

No migrate step — migrations apply on container boot. **A bad migration crashes the
container on start**, so scan new entries in `src/db/migrations.ts` before deploying
(check for destructive ops: `DROP`/`TRUNCATE`/narrowing `NOT NULL`).

### Running the build (agents/CI)
`compose up --build` on the droplet can take a couple of minutes (image build).
When invoking `deploy.sh` from an agent or CI with a command timeout, run it in the
**background** and poll, or it will be killed mid-`up` and leave the stack down.
`verify.sh` is safe to run repeatedly to confirm recovery.

## Gotchas the scripts guard against (inherited from the sibling stacks)

1. **Shared-net alias collision.** A bare `app`/`web`/`api` compose *service* name
   registers that name as an alias on the shared `edge` net; a sibling's nginx then
   resolves its own upstreams to the wrong containers (this once made
   `tradex.inflxr.com` serve the hiredesq app). Fix: the service key is `inflxr-app`.
   `deploy.sh` refuses a bare service name; `verify.sh` asserts no bare alias + that
   siblings still serve their own app.
2. **`.env.production` must be complete.** `deploy.sh` fails if a required key is
   empty or a `CHANGE_ME` placeholder remains. `PORT` is set by the image.
3. **`tradex-postgres` must be on `edge`.** It ships only on tradex's private net;
   `deploy.sh` attaches it to `edge` (idempotent). If a tradex `compose up` recreates
   the postgres container, the attachment drops until the next inflxr deploy — if
   `inflxr-app` can't reach the DB, check `docker network inspect edge` first.
4. **Public media.** Instagram fetches media over the internet — `S3_PUBLIC_BASE_URL`
   must be an internet-reachable public bucket URL, not the internal endpoint.

## Rollback

`deploy.sh` keeps the previous release under `release.prev/`:
```bash
ssh root@<droplet> "cd /opt/inflxr && mv release release.bad && mv release.prev release && \
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --remove-orphans inflxr-app"
```
Migrations do not auto-roll-back — assess separately. Rolling back inflxr never
touches tradex, hiredesq, or the shared cert.

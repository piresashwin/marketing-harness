# CLAUDE.md — marketing-harness

Product name: **Inflxr** (live at inflxr.com) — use it in all user-facing copy,
emails, and OAuth/consent pages; the repo, package, and infra identifiers (DB
container, S3 bucket, `harness-theme` storage key, `harness_info` MCP tool) keep
the marketing-harness name.

A **BYOK** (bring-your-own-keys) marketing automation tool. It is a *harness*: the
user supplies their own provider keys (LLM, image/video gen, Instagram). It exposes
an **MCP server** so Claude / other MCP clients can drive marketing workflows, plus
a **web UI** for humans. Everything is a **connector**.

Origin goal: stop manually moving Instagram content desktop→phone. The harness
publishes server-side via the Instagram Content Publishing API (host media at a
public URL → create container → publish), schedulable.

## Stack & layout

- **Backend** (`src/`): Node/TS + **Express**, also hosting an **MCP server** over
  Streamable HTTP at `POST /mcp`. Entry: `src/index.ts`.
- **Frontend** (`web/`): **Vite + React + Tailwind v4** SPA. Dev server proxies
  `/api` and `/auth` to the backend (`web/vite.config.ts`).
- **Database**: **Postgres via `pg`** (no ORM). Migrations are an ordered array in
  `src/db/migrations.ts`, applied on boot by `runMigrations()` (`_migrations` table
  tracks applied ids). Don't reach for Prisma — this project uses raw `pool.query`.
- **Connectors** (`src/connectors/`): a uniform interface (`types.ts`) —
  `instagram/` (OAuth + publish), `media/` (MediaStore: `s3` for S3/MinIO/R2, or
  `local`), `anthropic/` (workspace BYOK LLM, see below), `fal/` (BYOK image gen
  via sync fal.run + video gen via async queue.fal.run — Kling; model allowlists
  because model ids are URL paths), `elevenlabs/` (BYOK TTS, live key
  validation), `higgsfield/` (credential store only). **Generation routing**
  lives in `src/connectors/generation.ts`: one choke point per capability
  (`generateImage` / `generateVideo`+`readGenerationJob` / `generateVoice`) that
  resolves the provider (explicit request → workspace default in
  `workspace_settings.generation_defaults` → only-connected fallback →
  enumerated `no_provider_configured`), dispatches to the provider connector,
  and re-hosts output to the MediaStore for a stable public URL. Video is async:
  submit inserts a `generation_jobs` row; the status read polls the provider
  on demand (no background worker). Voice (MP3) is an input asset — not
  IG-publishable alone. REST (`/api/brands/:id/ai/{image,video,voice}`,
  `/ai/jobs/:jobId`) and MCP (`generate_image`/`generate_video`/
  `generation_status`/`generate_voice`) call the same functions — add new
  providers behind the resolver, never in routes.
- **Auth** (`src/auth/`): passwordless **magic link** via **Resend**
  (`src/email/resend.ts`), DB-backed cookie sessions.

```
src/
  index.ts                 # Express + MCP entry, mounts routers, serves web/dist in prod
  config/env.ts            # all env loading (single source)
  db/{index.ts,migrations.ts}
  auth/{routes,session,magicLink}.ts
  email/resend.ts
  api/routes.ts            # authed SPA REST API, mounted at /api
  http/oauth.ts            # /connectors/instagram/{connect,callback}
  mcp/server.ts            # MCP tool registrations
  connectors/{types.ts, instagram/*, media/*}
web/src/{App,auth,api,main}.tsx, pages/, index.css (@theme tokens)
```

## Commands

- `npm run dev` — backend (port 8787, tsx watch).
- `npm run dev --prefix web` — frontend (port 5173). Or `npm run dev:all` for both.
- `npm run typecheck` (root) and `npm run typecheck --prefix web` — **run both before
  handing back code.**
- `npm run build` — compiles backend (`tsc`) + `web` (vite build).
- Postgres: `docker exec -it marketing-harness-postgres psql -U harness -d marketing_harness`.

## Invariants (non-negotiable)

1. **Secrets at rest & in env.** Provider keys come from `process.env` via
   `src/config/env.ts` — never hard-coded. Persisted OAuth tokens / connector
   secrets must be encrypted before Postgres (AES-GCM helper). The `guard-secrets`
   and `post-edit-pii-scan` hooks enforce this; don't fight them.
2. **No PII / tokens in logs.** Log ids and counts, never user emails/profiles,
   captions, or `access_token`/`refresh_token`/`client_secret`. Return **safe
   enumerated** error messages to the client; log raw errors server-side only.
3. **Uniform connector interface.** New providers implement `src/connectors/types.ts`
   (`Connector` / `MediaStore`) so the MCP layer and (future) scheduler treat them
   interchangeably. Don't special-case a provider in routing.
4. **MCP + REST parity.** A capability exposed to humans (REST in `src/api`) and to
   agents (MCP tool in `src/mcp`) calls the **same** connector method — don't fork
   the logic.
5. **Public media reality.** Instagram fetches the OAuth redirect *and* the media
   over the public internet. Local dev therefore needs a **public HTTPS tunnel**
   (`cloudflared tunnel --url http://localhost:8787`) with `PUBLIC_BASE_URL` and a
   public media URL pointed at it. The tunnel hostname is **ephemeral** — on restart,
   update `.env` *and* the Meta app's redirect URI.
6. **Tenancy (incoming).** The app is moving to multi-tenant **Workspace → Brand →
   Social accounts** (see Roadmap). Once built, every `pg` query on a tenant table
   carries the `workspace_id`/`brand_id` predicate (app-layer only, no RLS backstop)
   — run the `tenant-security-auditor` on anything touching tenant data.

## Auth flow

`POST /auth/request {email}` → Resend emails a link to `${PUBLIC_BASE_URL}/auth/verify`
→ `GET /auth/verify?token` creates-or-finds the user, opens a cookie session, and
redirects to `${APP_BASE_URL}` `/onboarding` (new) or `/dashboard` (onboarded). No
separate registration. **Resend caveat:** with the shared `onboarding@resend.dev`
sender, mail only delivers to your own Resend account email — verify a domain and set
`RESEND_FROM` to send to anyone. Without a key, the link is logged + returned as a
dev link.

## Instagram connector

Central **Meta app** model (you own one app; `IG_CLIENT_ID`/`SECRET` in env). It
starts in **Development mode** → only Instagram accounts added as **Testers** (invite
accepted at instagram.com/accounts/manage_access) can connect; public users need Meta
**App Review** for `instagram_business_content_publish` + Business Verification. Uses
the Instagram-Login Graph API (`graph.instagram.com`): OAuth → long-lived token
(auto-refreshed) → `media` container → `media_publish`. Verified live (a real post
published).

**Analytics** (`/api/brands/:id/analytics/instagram` + `ig_analytics` /
`ig_analytics_insights` MCP tools): `fetchAnalytics()` pulls account KPIs, account
insights, audience demographics, and per-post metrics, normalizes them, and persists
a snapshot to `ig_analytics_snapshots` (jsonb) for week-over-week deltas;
`deriveInsights()` runs Claude over the latest snapshot. A third read,
`analyticsHistory()` (`GET …/analytics/instagram/history` + `ig_analytics_history`
MCP tool), distills the stored snapshots into a compact KPI series (no Graph call)
that drives the dashboard's trend **sparklines**. The Analytics tab visualizes all of
this with dependency-free SVG primitives in `web/src/components/charts.tsx`
(`Sparkline`/`Donut`/`Scatter`, token-driven so they flip in dark mode — no charting
lib): KPI-card sparklines, an engagement-mix donut, a reach-vs-engagement post
scatter, and a gender donut. This needs the
**`instagram_business_manage_insights`** scope (now in `buildAuthorizeUrl`), so
accounts connected before it must **reconnect** — a pre-scope token surfaces an
`InsightsPermissionError` that the API maps to a `reconnect_required` 409 and the UI
turns into a reconnect prompt. Graph metric names are version-sensitive
(`IG_GRAPH_VERSION`, default v21.0); the client tolerates missing metrics rather than
failing the whole pull.

## Frontend conventions

- **Tailwind v4**; tokens in `web/src/index.css`. Brand ramp is **indigo**
  (`brand-50/100/500/600/700`). **Theming = semantic tokens** that flip on `.dark`:
  use `bg-surface`/`bg-canvas`/`bg-elevated`, `text-ink`/`text-muted`/`text-faint`,
  `border-line`/`border-line-strong`, `bg-hover`, and `accent`/`accent-soft`/
  `accent-soft-fg`/`accent-line` for tinted (selected/AI) states — **not** literal
  `slate-*`/`white` or `brand-50` fills, so dark mode works without per-element
  `dark:` variants. Light/dark/system toggle lives in `src/theme.tsx` (persisted);
  `ThemeProvider` wraps the app. Keep `focus:ring-brand-100` / `bg-brand-600`
  primary buttons as-is. No purple-gradient AI-slop.
- **Behaviour primitives = Radix (+ cmdk), styling = ours.** Dialogs/menus/popovers/
  tooltips/focus-traps → `@radix-ui/react-*`; command palette / combobox → `cmdk`.
  Wrap them behind `web/src/components/ui/` and skin with tokens — **never hand-roll**
  a dialog or focus trap. (Deps installed.)
- **Icons = `lucide-react`** (installed). Use lucide components sized with
  `className="h-4 w-4"`; `Loader2` + `animate-spin motion-reduce:animate-none` for
  spinners. Don't hand-roll inline `<svg>` glyphs or use emoji as UI controls
  (decorative emoji in copy is fine).
- No side effects in render bodies; paginate long lists; consume `web/src/api.ts`
  (cookie session, `credentials: include`) rather than ad-hoc fetch.

## Infra (dev)

- Postgres (pgvector pg16) container `marketing-harness-postgres` on **:5433**, db
  `marketing_harness`, user `harness`, volume `marketing-harness-pgdata`. `vector`
  extension enabled (free optionality for embeddings).
- A MinIO on :9000 exists on this machine (different project) — usable as an
  S3-compatible MediaStore, but its objects aren't internet-reachable without a
  tunnel; for real IG publishing use a public S3/R2 or tunnel the local store.

## Claude Code setup (`.claude/`)

- **Skills:** `higgsfield-prompting` (image/video gen via the Higgsfield MCP),
  `viral-content`, `product-manager`. The latter two carry hiredesk-flavored example
  bodies — retune per active brand.
- **Agents:** `fullstack-developer`, `tailwind-developer`, `hook-designer`,
  `pii-privacy-auditor`, `tenant-security-auditor`.
- **Hooks:** `guard-secrets` (PreToolUse Bash, blocking), `post-edit-pii-scan` +
  `post-edit-quality` (PostToolUse, warn-only).
- **MCP** (`.mcp.json`): `higgsfield` (hosted) + `marketing-harness` (local /mcp).

## Working with Claude / model defaults

When writing code that calls Claude/Anthropic, **load the `claude-api` skill** — it
holds current model ids and SDK patterns. Default model `claude-opus-4-8`. The
workspace-level LLM connector is **built** (`src/connectors/anthropic/`, BYOK
per-workspace key resolved via `getConnectorApiKey`): all generation routes through
the single `runTask()` choke point (per-task model tiering + output caps + cacheable
brand-profile prefix). It powers AI caption assist (`/api/ai/caption`), the Brand
Profile draft/refine assist, and Instagram analytics insights (`deriveInsights`) —
add new generations as a `TaskType`, never a fresh client.

## Roadmap / not yet built

Current DB: `users`, `magic_link_tokens`, `sessions`, `profiles`, plus `ig_accounts`
/ `posts` keyed by a flat `user_key`. **Next slice — multi-tenancy:** workspaces,
`workspace_members`, brands, `brand_settings`, `content_pillars`, `social_accounts`
(replacing `ig_accounts`), `brand_platform_settings`, `workspace_connectors`,
`user_settings`; signup creates a workspace; refactor the IG connector from
`user_key` to brand scope; add AES-GCM encryption-at-rest; header brand switcher.
Then: scheduling/content calendar, and the Claude + Higgsfield connectors that make
the AI-first dashboard real. The `tenant-security-auditor` agent already targets this
model — apply it as the tables land.

## Conventions

- Match the surrounding code's style, naming, and structure. Make the change
  requested; no speculative abstractions or error handling for impossible cases.
- Confirm before destructive/outward-facing actions (dropping data, sending email to
  real users, anything hard to reverse).

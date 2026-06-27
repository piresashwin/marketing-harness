# marketing-harness

A BYOK (bring-your-own-keys) marketing automation harness exposed over **MCP**.
Connect Claude (or any MCP client) and drive your marketing workflows through
**connectors**.

**Slice 1 (this build):** Instagram *publish-now* — connect a Business/Creator
account via OAuth and publish images & carousels from your MCP client. No more
moving content desktop → phone.

> Roadmap: Slice 2 = scheduling + content calendar · Slice 3 = LLM caption &
> image/video generation connectors · Milestone = Meta App Review before public
> launch.

---

## Architecture

```
  MCP client (Claude)  ──POST /mcp──▶  MCP server
                                          │
                                   Connector layer
                                   • Instagram (OAuth + publish)
                                          │
              ┌───────────────────────────┼───────────────────────┐
        MediaStore (S3/MinIO or local)   Postgres (:5433)    Instagram Graph API
        public URLs for IG to fetch      tokens + post log   graph.instagram.com
```

- **Connectors** implement a uniform interface (`src/connectors/types.ts`).
- **MediaStore** gives Instagram a public URL to fetch (`s3` or `local`).
- **Postgres** stores OAuth tokens (auto-refreshed) and a publish audit log.

## Prerequisites

- Node 20+
- The Postgres instance (already running on **:5433**, db `marketing_harness`).
- A media store reachable by Instagram's servers (see note below).
- A Meta developer app (central app — you own it). See setup below.

## Setup

```bash
npm install
cp .env.example .env      # then fill in IG_CLIENT_ID / IG_CLIENT_SECRET
npm run dev
```

### Meta app (one-time, central-app model)

1. Create an app at https://developers.facebook.com → add the **Instagram** product.
2. While the app is in **Development mode**, add your Instagram account (and any
   testers) under app **Roles** → they can connect & publish with **no App Review**.
3. In the Instagram product settings, add your OAuth **redirect URI**:
   `${PUBLIC_BASE_URL}/connectors/instagram/callback`
4. Copy the app's client id/secret into `.env` as `IG_CLIENT_ID` / `IG_CLIENT_SECRET`.
5. Your Instagram account must be a **Business or Creator** account.

> **Going public later** requires Meta **App Review** for
> `instagram_business_content_publish` + Business Verification, then flipping the
> app to Live. Not needed for you/testers now.

### ⚠️ Public URL requirement

Instagram's servers fetch the OAuth redirect **and** the media over the public
internet. `localhost` will work for local OAuth in a browser, but **publishing
real posts requires public HTTPS URLs** for both `PUBLIC_BASE_URL` and the media
store. For local end-to-end testing, run a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787   # or: ngrok http 8787
```

Then set `PUBLIC_BASE_URL` (and a public `S3_PUBLIC_BASE_URL`, e.g. AWS S3 / R2)
accordingly. The bundled MinIO on `:9000` is fine for dev but isn't internet-
reachable unless you expose it too.

## Connecting an account

- **Browser:** open `http://localhost:8787/connectors/instagram/connect?user_key=default`
- **From an MCP client:** call `ig_get_connect_url`, open the returned URL.

## MCP tools

| Tool | Purpose |
|------|---------|
| `harness_info` | List connectors + config status |
| `ig_get_connect_url` | Get the OAuth URL to connect an account |
| `ig_connect_status` | Check connection + token expiry |
| `ig_publish_image` | Publish one image (`url`/`path`/`base64` + `caption`) |
| `ig_publish_carousel` | Publish 2–10 images |

### Add to Claude Code

```bash
claude mcp add --transport http marketing-harness http://localhost:8787/mcp
```

## Project layout

```
src/
  index.ts                 # HTTP + MCP entry
  config/env.ts            # env loading
  db/                      # pg pool + migrations
  connectors/
    types.ts               # Connector interface
    instagram/graph.ts     # Graph API client
    instagram/index.ts     # connect + publish
    media/                 # MediaStore: s3 / local
  mcp/server.ts            # tool registrations
  http/oauth.ts            # OAuth connect + callback routes
```

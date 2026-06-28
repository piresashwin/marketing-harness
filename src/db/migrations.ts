import type pg from "pg";
import { backfillTenancy } from "./backfill.js";
import { brandScopeCutover } from "./cutover.js";

// A migration is EITHER pure SQL or an imperative JS step (e.g. a backfill that
// must encrypt values in application code). Both run inside the same per-migration
// transaction and are tracked in `_migrations`.
export type Migration = { id: number; name: string } & (
  | { sql: string; run?: never }
  | { run: (client: pg.PoolClient) => Promise<void>; sql?: never }
);

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init",
    sql: `
      -- One connected Instagram account, keyed by a logical harness user.
      CREATE TABLE IF NOT EXISTS ig_accounts (
        id            bigserial PRIMARY KEY,
        user_key      text NOT NULL UNIQUE,
        ig_user_id    text NOT NULL,
        username      text,
        access_token  text NOT NULL,
        token_expires_at timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );

      -- Short-lived CSRF state for the OAuth round trip.
      CREATE TABLE IF NOT EXISTS oauth_states (
        state       text PRIMARY KEY,
        provider    text NOT NULL,
        user_key    text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      -- Audit log of publish attempts.
      CREATE TABLE IF NOT EXISTS posts (
        id           bigserial PRIMARY KEY,
        user_key     text NOT NULL,
        provider     text NOT NULL DEFAULT 'instagram',
        media_type   text NOT NULL,
        caption      text,
        media_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
        provider_media_id text,
        permalink    text,
        status       text NOT NULL DEFAULT 'pending',
        error        text,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: 2,
    name: "auth_and_profiles",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id          bigserial PRIMARY KEY,
        email       text NOT NULL UNIQUE,
        onboarding_completed boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        token       text PRIMARY KEY,
        email       text NOT NULL,
        expires_at  timestamptz NOT NULL,
        used        boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id          text PRIMARY KEY,
        user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  timestamptz NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS profiles (
        user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data        jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: 3,
    name: "multitenancy_tables",
    sql: `
      -- Top-level tenant: a workspace owned by a user.
      CREATE TABLE IF NOT EXISTS workspaces (
        id             bigserial PRIMARY KEY,
        name           text NOT NULL,
        owner_user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces(owner_user_id);

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id  bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role          text NOT NULL DEFAULT 'owner',
        created_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );

      -- Workspace-level API-key connectors (Claude/Higgsfield/...).
      -- secrets values are ENCRYPTED strings (AES-GCM helper), never plaintext.
      CREATE TABLE IF NOT EXISTS workspace_connectors (
        id            bigserial PRIMARY KEY,
        workspace_id  bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider      text NOT NULL,
        secrets       jsonb NOT NULL DEFAULT '{}'::jsonb,
        config        jsonb NOT NULL DEFAULT '{}'::jsonb,
        status        text NOT NULL DEFAULT 'disconnected',
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, provider)
      );

      CREATE TABLE IF NOT EXISTS brands (
        id            bigserial PRIMARY KEY,
        workspace_id  bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name          text NOT NULL,
        slug          text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS brands_workspace_idx ON brands(workspace_id);

      CREATE TABLE IF NOT EXISTS brand_settings (
        brand_id      bigint PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
        description   text,
        branding      jsonb NOT NULL DEFAULT '{}'::jsonb,
        voice         jsonb NOT NULL DEFAULT '{}'::jsonb,
        audience      text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS content_pillars (
        id            bigserial PRIMARY KEY,
        brand_id      bigint NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        name          text NOT NULL,
        description   text,
        ratio         integer,
        sort_order    integer
      );
      CREATE INDEX IF NOT EXISTS content_pillars_brand_idx ON content_pillars(brand_id);

      -- Will replace ig_accounts in Phase 2. access_token/refresh_token ENCRYPTED.
      CREATE TABLE IF NOT EXISTS social_accounts (
        id               bigserial PRIMARY KEY,
        brand_id         bigint NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        platform         text NOT NULL,
        external_id      text NOT NULL,
        username         text,
        access_token     text NOT NULL,
        refresh_token    text,
        token_expires_at timestamptz,
        scopes           text,
        meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
        status           text NOT NULL DEFAULT 'connected',
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS social_accounts_brand_platform_idx
        ON social_accounts(brand_id, platform);

      CREATE TABLE IF NOT EXISTS brand_platform_settings (
        brand_id   bigint NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        platform   text NOT NULL,
        settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (brand_id, platform)
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id             bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        active_workspace_id bigint,
        active_brand_id     bigint,
        updated_at          timestamptz NOT NULL DEFAULT now()
      );

      -- Additive: tag existing posts so Phase 2 can scope them by brand/account.
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS brand_id bigint;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS social_account_id bigint;
    `,
  },
  {
    id: 4,
    name: "backfill_tenancy",
    run: backfillTenancy,
  },
  {
    id: 5,
    name: "tenant_constraints",
    sql: `
      ALTER TABLE social_accounts
        ADD CONSTRAINT social_accounts_brand_platform_external_uq
        UNIQUE (brand_id, platform, external_id);

      ALTER TABLE brands
        ADD CONSTRAINT brands_workspace_slug_uq
        UNIQUE (workspace_id, slug);

      ALTER TABLE posts
        ADD CONSTRAINT posts_brand_fk
        FOREIGN KEY (brand_id) REFERENCES brands(id);
      ALTER TABLE posts
        ADD CONSTRAINT posts_social_account_fk
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id);

      ALTER TABLE user_settings
        ADD CONSTRAINT user_settings_active_workspace_fk
        FOREIGN KEY (active_workspace_id) REFERENCES workspaces(id);
      ALTER TABLE user_settings
        ADD CONSTRAINT user_settings_active_brand_fk
        FOREIGN KEY (active_brand_id) REFERENCES brands(id);
    `,
  },
  {
    id: 6,
    name: "brand_scope_cutover",
    run: brandScopeCutover,
  },
  {
    id: 7,
    name: "mcp_oauth",
    sql: `
      -- Dynamically-registered OAuth clients (DCR). Public PKCE clients have a
      -- NULL client_secret_hash and token_endpoint_auth_method = 'none'.
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id                  text PRIMARY KEY,
        client_secret_hash         text,
        client_name                text,
        redirect_uris              jsonb NOT NULL DEFAULT '[]'::jsonb,
        grant_types                jsonb NOT NULL DEFAULT '[]'::jsonb,
        response_types             jsonb NOT NULL DEFAULT '[]'::jsonb,
        scope                      text,
        token_endpoint_auth_method text NOT NULL DEFAULT 'none',
        client_id_issued_at        bigint NOT NULL,
        client_secret_expires_at   bigint
      );

      -- Pending authorize requests, bound to a user later by the consent route.
      CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
        id                    text PRIMARY KEY,
        client_id             text NOT NULL,
        redirect_uri          text NOT NULL,
        code_challenge        text NOT NULL,
        code_challenge_method text NOT NULL DEFAULT 'S256',
        scopes                jsonb NOT NULL DEFAULT '[]'::jsonb,
        state                 text,
        resource              text,
        expires_at            timestamptz NOT NULL
      );

      -- Issued authorization codes (store only the SHA-256 hash).
      CREATE TABLE IF NOT EXISTS oauth_auth_codes (
        code_hash      text PRIMARY KEY,
        client_id      text NOT NULL,
        user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_challenge text NOT NULL,
        redirect_uri   text NOT NULL,
        scopes         jsonb NOT NULL DEFAULT '[]'::jsonb,
        resource       text,
        expires_at     timestamptz NOT NULL,
        used           boolean NOT NULL DEFAULT false
      );

      -- Access/refresh tokens (store only SHA-256 hashes).
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id                 bigserial PRIMARY KEY,
        access_token_hash  text NOT NULL UNIQUE,
        refresh_token_hash text UNIQUE,
        client_id          text NOT NULL,
        user_id            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scopes             jsonb NOT NULL DEFAULT '[]'::jsonb,
        resource           text,
        access_expires_at  timestamptz NOT NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        revoked            boolean NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS oauth_tokens_access_hash_idx ON oauth_tokens(access_token_hash);
      CREATE INDEX IF NOT EXISTS oauth_tokens_refresh_hash_idx ON oauth_tokens(refresh_token_hash);
    `,
  },
  {
    id: 8,
    name: "oauth_consent_csrf",
    sql: `
      -- Per-request CSRF token (hash only) + the session user who loaded the
      -- consent page, so the approving POST must come from that same session.
      ALTER TABLE oauth_authorization_requests
        ADD COLUMN IF NOT EXISTS csrf_token_hash text;
      ALTER TABLE oauth_authorization_requests
        ADD COLUMN IF NOT EXISTS consent_user_id bigint REFERENCES users(id) ON DELETE CASCADE;
    `,
  },
];

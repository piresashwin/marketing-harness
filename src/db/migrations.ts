export interface Migration {
  id: number;
  name: string;
  sql: string;
}

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
];

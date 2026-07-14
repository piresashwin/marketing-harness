import { pool } from "../db/index.js";
import { encrypt, decrypt } from "../crypto/secrets.js";

// Workspace-level API-key connectors (workspace_connectors).
//   provider ∈ 'anthropic' | 'higgsfield' | 'fal' | 'elevenlabs'
//   secrets jsonb holds ENCRYPTED values (e.g. { apiKey: "v1:..." }) — NEVER plaintext.
//   config jsonb holds non-secret settings (e.g. { model }).
// Decrypt is narrow: plaintext keys stay in locals and are never logged/stringified.

export type WorkspaceProvider = "anthropic" | "higgsfield" | "fal" | "elevenlabs";

export interface ConnectorStatus {
  provider: WorkspaceProvider;
  status: string;
  config: Record<string, unknown>;
  updatedAt: string;
}

/** UPSERT a workspace connector, storing the key encrypted. Never logs the key. */
export async function setConnector(
  workspaceId: number,
  provider: WorkspaceProvider,
  opts: { apiKey: string; config?: Record<string, unknown> },
): Promise<void> {
  const secrets = { apiKey: encrypt(opts.apiKey) };
  await pool.query(
    `INSERT INTO workspace_connectors (workspace_id, provider, secrets, config, status, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, 'connected', now())
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       secrets = EXCLUDED.secrets,
       config = EXCLUDED.config,
       status = 'connected',
       updated_at = now()`,
    [workspaceId, provider, JSON.stringify(secrets), JSON.stringify(opts.config ?? {})],
  );
}

/** Returns the decrypted API key for a workspace provider, or null if absent. */
export async function getConnectorApiKey(
  workspaceId: number,
  provider: WorkspaceProvider,
): Promise<string | null> {
  const { rows } = await pool.query<{ secrets: { apiKey?: string } }>(
    "SELECT secrets FROM workspace_connectors WHERE workspace_id = $1 AND provider = $2",
    [workspaceId, provider],
  );
  const blob = rows[0]?.secrets?.apiKey;
  if (!blob) return null;
  return decrypt(blob);
}

/** Non-secret connector statuses for a workspace. Never returns secrets. */
export async function listConnectors(
  workspaceId: number,
): Promise<ConnectorStatus[]> {
  const { rows } = await pool.query<{
    provider: WorkspaceProvider;
    status: string;
    config: Record<string, unknown>;
    updated_at: Date;
  }>(
    "SELECT provider, status, config, updated_at FROM workspace_connectors WHERE workspace_id = $1 ORDER BY provider",
    [workspaceId],
  );
  return rows.map((r) => ({
    provider: r.provider,
    status: r.status,
    config: r.config,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function deleteConnector(
  workspaceId: number,
  provider: WorkspaceProvider,
): Promise<void> {
  await pool.query(
    "DELETE FROM workspace_connectors WHERE workspace_id = $1 AND provider = $2",
    [workspaceId, provider],
  );
}

// ── Generation defaults (workspace_settings) ──────────────────────────
// Which provider (and optional model) handles each generation capability.
// A preference *about* connectors, not a connector secret — so it lives in
// workspace_settings, not workspace_connectors.

export interface GenerationDefault {
  provider: WorkspaceProvider;
  model?: string;
}

export type GenerationDefaults = Partial<
  Record<"image" | "video" | "voice", GenerationDefault>
>;

export async function getGenerationDefaults(
  workspaceId: number,
): Promise<GenerationDefaults> {
  const { rows } = await pool.query<{ generation_defaults: GenerationDefaults }>(
    "SELECT generation_defaults FROM workspace_settings WHERE workspace_id = $1",
    [workspaceId],
  );
  return rows[0]?.generation_defaults ?? {};
}

/** UPSERT one capability's default; `null` clears it back to auto-resolution. */
export async function setGenerationDefault(
  workspaceId: number,
  capability: "image" | "video" | "voice",
  value: GenerationDefault | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO workspace_settings (workspace_id, generation_defaults, updated_at)
     VALUES ($1,
             CASE WHEN $3::jsonb IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object($2::text, $3::jsonb) END,
             now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       generation_defaults =
         CASE WHEN $3::jsonb IS NULL
              THEN workspace_settings.generation_defaults - $2::text
              ELSE workspace_settings.generation_defaults || jsonb_build_object($2::text, $3::jsonb)
         END,
       updated_at = now()`,
    [workspaceId, capability, value === null ? null : JSON.stringify(value)],
  );
}

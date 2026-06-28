import { pool } from "../db/index.js";
import { encrypt, decrypt } from "../crypto/secrets.js";

// Workspace-level API-key connectors (workspace_connectors).
//   provider ∈ 'anthropic' | 'higgsfield'
//   secrets jsonb holds ENCRYPTED values (e.g. { apiKey: "v1:..." }) — NEVER plaintext.
//   config jsonb holds non-secret settings (e.g. { model }).
// Decrypt is narrow: plaintext keys stay in locals and are never logged/stringified.

export type WorkspaceProvider = "anthropic" | "higgsfield";

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

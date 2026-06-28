import { pool } from "../db/index.js";
import { encrypt, decrypt } from "./secrets.js";

// Encryption-key ROTATION routine. Re-encrypts every stored secret with the
// current primary key (APP_ENCRYPTION_KEY), decrypting via the primary-or-old
// fallback in decrypt(). Idempotent: re-encrypting a value already under the
// primary key just rewrites it with a fresh IV.
//
// PROCEDURE
//   1. APP_ENCRYPTION_KEY_OLD = <current APP_ENCRYPTION_KEY>
//   2. APP_ENCRYPTION_KEY     = <new `openssl rand -hex 32`>
//   3. npm run reencrypt          # rewrites old-key blobs under the new key
//   4. remove APP_ENCRYPTION_KEY_OLD from the environment
//
// Never prints secret values — only counts.

async function reencryptValue(blob: string): Promise<string> {
  return encrypt(decrypt(blob));
}

async function main(): Promise<void> {
  let social = 0;
  let refresh = 0;
  let connectors = 0;

  const conn = await pool.connect();
  try {
    // social_accounts.access_token + refresh_token (nullable)
    const sa = await conn.query<{
      id: number;
      access_token: string;
      refresh_token: string | null;
    }>("SELECT id, access_token, refresh_token FROM social_accounts");
    for (const row of sa.rows) {
      await conn.query("BEGIN");
      try {
        const newAccess = await reencryptValue(row.access_token);
        const newRefresh =
          row.refresh_token != null ? await reencryptValue(row.refresh_token) : null;
        await conn.query(
          "UPDATE social_accounts SET access_token = $1, refresh_token = $2, updated_at = now() WHERE id = $3",
          [newAccess, newRefresh, row.id],
        );
        await conn.query("COMMIT");
        social++;
        if (newRefresh != null) refresh++;
      } catch (e) {
        await conn.query("ROLLBACK");
        throw e;
      }
    }

    // workspace_connectors.secrets.apiKey
    const wc = await conn.query<{
      id: number;
      secrets: { apiKey?: string } | null;
    }>("SELECT id, secrets FROM workspace_connectors");
    for (const row of wc.rows) {
      const apiKey = row.secrets?.apiKey;
      if (!apiKey) continue;
      await conn.query("BEGIN");
      try {
        const newSecrets = { ...row.secrets, apiKey: await reencryptValue(apiKey) };
        await conn.query(
          "UPDATE workspace_connectors SET secrets = $1::jsonb, updated_at = now() WHERE id = $2",
          [JSON.stringify(newSecrets), row.id],
        );
        await conn.query("COMMIT");
        connectors++;
      } catch (e) {
        await conn.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    conn.release();
  }

  console.log(
    `[reencrypt] social_accounts access_token=${social}, refresh_token=${refresh}, workspace_connectors apiKey=${connectors}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // Never log secret material; the name is enough to diagnose.
    console.error("[reencrypt] failed:", (e as Error).name);
    process.exit(1);
  });

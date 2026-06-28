import type pg from "pg";

// Migration 6: brand-scope cutover.
//   1. Add oauth_states.brand_id (the IG connect flow now scopes by brand).
//   2. Drop the legacy plaintext-token table ig_accounts — but ONLY after
//      asserting every ig_accounts row already has a matching encrypted
//      social_accounts row (same external_id, under a brand owned by the same
//      user the legacy user_key pointed at). If any row is unaccounted for, we
//      throw and leave ig_accounts in place rather than losing data.

export async function brandScopeCutover(client: pg.PoolClient): Promise<void> {
  await client.query(
    `ALTER TABLE oauth_states
       ADD COLUMN IF NOT EXISTS brand_id bigint REFERENCES brands(id) ON DELETE CASCADE`,
  );

  // Safety assert: find any ig_accounts row NOT represented in social_accounts.
  // We resolve the owning user from user_key (user:<id>), then their workspace's
  // brands, and require a social_accounts row with the same instagram external_id.
  const orphans = await client.query<{
    id: number;
    user_key: string;
    ig_user_id: string;
  }>(
    `SELECT ig.id, ig.user_key, ig.ig_user_id
       FROM ig_accounts ig
      WHERE NOT EXISTS (
        SELECT 1
          FROM users u
          JOIN workspaces w ON w.owner_user_id = u.id
          JOIN brands b ON b.workspace_id = w.id
          JOIN social_accounts sa
            ON sa.brand_id = b.id
           AND sa.platform = 'instagram'
           AND sa.external_id = ig.ig_user_id
         WHERE ig.user_key = 'user:' || u.id
      )`,
  );

  if (orphans.rowCount && orphans.rowCount > 0) {
    // Report ids and external_ids only — never tokens.
    const detail = orphans.rows
      .map((r) => `id=${r.id} user_key=${r.user_key} ig_user_id=${r.ig_user_id}`)
      .join("; ");
    throw new Error(
      `Refusing to drop ig_accounts: ${orphans.rowCount} row(s) not migrated to social_accounts [${detail}]. ` +
        `Backfill these into social_accounts (encrypted) before re-running.`,
    );
  }

  await client.query("DROP TABLE ig_accounts");
}

import type pg from "pg";
import { encrypt } from "../crypto/secrets.js";

// Migration 4: backfill the multi-tenancy model from the legacy flat data.
// Idempotent — safe to re-run; it only creates rows that don't already exist.
// Every insert/update carries its owning workspace_id/brand_id, and every token
// is encrypted before it touches social_accounts.

interface ProfileData {
  displayName?: string;
  brandName?: string;
  website?: string;
  industry?: string;
  audience?: string;
  brandVoice?: string[];
  goals?: string;
  platforms?: string[];
  cadence?: string;
}

function localPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export async function backfillTenancy(client: pg.PoolClient): Promise<void> {
  const { rows: users } = await client.query<{ id: number; email: string }>(
    "SELECT id, email FROM users ORDER BY id",
  );

  for (const user of users) {
    // 1. Workspace + owner membership.
    let workspaceId: number;
    const existingWs = await client.query<{ id: number }>(
      "SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY id LIMIT 1",
      [user.id],
    );
    if (existingWs.rows[0]) {
      workspaceId = existingWs.rows[0].id;
    } else {
      const inserted = await client.query<{ id: number }>(
        "INSERT INTO workspaces (name, owner_user_id) VALUES ($1, $2) RETURNING id",
        [`${localPart(user.email)}'s Workspace`, user.id],
      );
      workspaceId = inserted.rows[0].id;
    }
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, user.id],
    );

    // Load this user's onboarding profile (if any) to seed brand settings.
    const profileRow = await client.query<{ data: ProfileData }>(
      "SELECT data FROM profiles WHERE user_id = $1",
      [user.id],
    );
    const profile: ProfileData = profileRow.rows[0]?.data ?? {};

    // 2. Default brand under the workspace. Insert-or-nothing against the
    //    (workspace_id, slug) unique constraint, then re-select to get the id —
    //    avoids a SELECT-then-INSERT race.
    const brandName = profile.brandName?.trim() || "Default";
    await client.query(
      `INSERT INTO brands (workspace_id, name, slug)
       VALUES ($1, $2, 'default')
       ON CONFLICT (workspace_id, slug) DO NOTHING`,
      [workspaceId, brandName],
    );
    const brandRow = await client.query<{ id: number }>(
      "SELECT id FROM brands WHERE workspace_id = $1 AND slug = 'default'",
      [workspaceId],
    );
    const brandId = brandRow.rows[0].id;

    // brand_settings seeded from profile. Keep voice as a small jsonb object.
    const voice: Record<string, unknown> = {};
    if (profile.brandVoice?.length) voice.tone = profile.brandVoice;
    if (profile.goals?.trim()) voice.goals = profile.goals.trim();
    await client.query(
      `INSERT INTO brand_settings (brand_id, description, audience, voice)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (brand_id) DO NOTHING`,
      [
        brandId,
        profile.industry?.trim() || null,
        profile.audience?.trim() || null,
        JSON.stringify(voice),
      ],
    );

    // 3. Seed content pillars only when none exist for the brand (no fabrication).
    // The legacy profile carries no pillar data, so we leave pillars empty.

    // 4. user_settings -> point active workspace/brand at the defaults.
    //    Preserve an existing active selection only if it still belongs to this
    //    user (workspace owned by them / brand inside one of their workspaces);
    //    otherwise overwrite with the backfilled defaults rather than keeping a
    //    possibly-foreign value.
    const existingSettings = await client.query<{
      active_workspace_id: number | null;
      active_brand_id: number | null;
    }>(
      "SELECT active_workspace_id, active_brand_id FROM user_settings WHERE user_id = $1",
      [user.id],
    );
    let activeWorkspaceId = workspaceId;
    let activeBrandId = brandId;
    if (existingSettings.rows[0]) {
      const cur = existingSettings.rows[0];
      if (cur.active_workspace_id != null) {
        const ok = await client.query(
          "SELECT 1 FROM workspaces WHERE id = $1 AND owner_user_id = $2",
          [cur.active_workspace_id, user.id],
        );
        if (ok.rowCount) activeWorkspaceId = cur.active_workspace_id;
      }
      if (cur.active_brand_id != null) {
        const ok = await client.query(
          `SELECT 1 FROM brands b
             JOIN workspaces w ON w.id = b.workspace_id
            WHERE b.id = $1 AND w.owner_user_id = $2`,
          [cur.active_brand_id, user.id],
        );
        if (ok.rowCount) activeBrandId = cur.active_brand_id;
      }
    }
    await client.query(
      `INSERT INTO user_settings (user_id, active_workspace_id, active_brand_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
         SET active_workspace_id = EXCLUDED.active_workspace_id,
             active_brand_id     = EXCLUDED.active_brand_id,
             updated_at          = now()`,
      [user.id, activeWorkspaceId, activeBrandId],
    );

    // 5. Migrate Instagram accounts keyed by user:<id> into social_accounts.
    const userKey = `user:${user.id}`;
    const igAccounts = await client.query<{
      ig_user_id: string;
      username: string | null;
      access_token: string;
      token_expires_at: Date | null;
    }>(
      "SELECT ig_user_id, username, access_token, token_expires_at FROM ig_accounts WHERE user_key = $1",
      [userKey],
    );
    for (const ig of igAccounts.rows) {
      // Insert-or-nothing against the (brand_id, platform, external_id) unique
      // constraint — idempotent without a SELECT-then-INSERT race.
      await client.query(
        `INSERT INTO social_accounts
           (brand_id, platform, external_id, username, access_token, token_expires_at, status)
         VALUES ($1, 'instagram', $2, $3, $4, $5, 'connected')
         ON CONFLICT (brand_id, platform, external_id) DO NOTHING`,
        [
          brandId,
          ig.ig_user_id,
          ig.username,
          encrypt(ig.access_token),
          ig.token_expires_at,
        ],
      );
    }

    // 6. Tag this user's posts with the default brand. Always set brand_id;
    //    resolve social_account_id only when EXACTLY ONE account matches the
    //    brand+platform (an ambiguous match must not be guessed).
    await client.query(
      "UPDATE posts SET brand_id = $1 WHERE user_key = $2 AND brand_id IS NULL",
      [brandId, userKey],
    );
    await client.query(
      `UPDATE posts p
          SET social_account_id = (
                SELECT sa.id FROM social_accounts sa
                 WHERE sa.brand_id = $2 AND sa.platform = p.provider
              )
        WHERE p.user_key = $1
          AND p.brand_id = $2
          AND p.social_account_id IS NULL
          AND (
            SELECT count(*) FROM social_accounts sa
             WHERE sa.brand_id = $2 AND sa.platform = p.provider
          ) = 1`,
      [userKey, brandId],
    );
  }
}

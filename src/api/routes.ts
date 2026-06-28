import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { requireAuth, clearSession, type AuthedRequest } from "../auth/session.js";
import { instagram } from "../connectors/instagram/index.js";
import { generateCaption } from "../connectors/anthropic/index.js";
import {
  listConnectors,
  setConnector,
  deleteConnector,
  type WorkspaceProvider,
} from "../connectors/workspace.js";
import * as anthropic from "../connectors/anthropic/index.js";
import { mediaStore } from "../connectors/media/index.js";

export const apiRouter = Router();
apiRouter.use(requireAuth());

interface BrandRow {
  id: number;
  workspace_id: number;
  name: string;
  slug: string;
}

interface BrandRequest extends AuthedRequest {
  brand?: BrandRow;
}

interface WorkspaceRequest extends AuthedRequest {
  workspaceId?: number;
}

/**
 * Resolve & authorize the workspace in /api/workspaces/:workspaceId/...
 * The authed user must be a member (workspace_members). 403 otherwise.
 */
function requireWorkspace() {
  return async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    const workspaceId = Number(req.params.workspaceId);
    if (!Number.isInteger(workspaceId)) {
      res.status(400).json({ error: "invalid workspace id" });
      return;
    }
    const { rowCount } = await pool.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, req.user!.id],
    );
    if (!rowCount) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.workspaceId = workspaceId;
    next();
  };
}

/**
 * Resolve & authorize the brand in /api/brands/:brandId/...
 * The brand must belong to a workspace the authed user is a member of.
 * Attaches req.brand; 403 otherwise. Never trust a brand id from the body.
 */
function requireBrand() {
  return async (req: BrandRequest, res: Response, next: NextFunction) => {
    const brandId = Number(req.params.brandId);
    if (!Number.isInteger(brandId)) {
      res.status(400).json({ error: "invalid brand id" });
      return;
    }
    const { rows } = await pool.query<BrandRow>(
      `SELECT b.id, b.workspace_id, b.name, b.slug
         FROM brands b
         JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
        WHERE b.id = $1 AND wm.user_id = $2`,
      [brandId, req.user!.id],
    );
    if (!rows[0]) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.brand = rows[0];
    next();
  };
}

/** Brands the authed user can access (member of their workspace). */
async function listBrands(userId: number): Promise<BrandRow[]> {
  const { rows } = await pool.query<BrandRow>(
    `SELECT b.id, b.workspace_id, b.name, b.slug
       FROM brands b
       JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
      WHERE wm.user_id = $1
      ORDER BY b.id`,
    [userId],
  );
  return rows;
}

// ── Current user + context ────────────────────────────────────────────
apiRouter.get("/me", async (req: AuthedRequest, res) => {
  const user = req.user!;
  const [profileRes, settingsRes, brands] = await Promise.all([
    pool.query<{ data: unknown }>("SELECT data FROM profiles WHERE user_id = $1", [
      user.id,
    ]),
    pool.query<{ active_workspace_id: number | null; active_brand_id: number | null }>(
      "SELECT active_workspace_id, active_brand_id FROM user_settings WHERE user_id = $1",
      [user.id],
    ),
    listBrands(user.id),
  ]);
  const settings = settingsRes.rows[0];
  // Workspace connector statuses (no secrets) for the active workspace — handy
  // for the UI to show whether an AI provider is connected. Re-verify membership
  // against the stored active_workspace_id so a revoked/stale workspace surfaces
  // nothing (defense-in-depth; the id is only ever written behind a membership
  // check today, but don't trust stored state on read).
  let workspaceConnectors: Awaited<ReturnType<typeof listConnectors>> = [];
  if (settings?.active_workspace_id) {
    const member = await pool.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [settings.active_workspace_id, user.id],
    );
    if (member.rows.length > 0) {
      workspaceConnectors = await listConnectors(settings.active_workspace_id);
    }
  }
  res.json({
    user: {
      id: user.id,
      email: user.email,
      onboardingCompleted: user.onboarding_completed,
    },
    activeWorkspaceId: settings?.active_workspace_id ?? null,
    activeBrandId: settings?.active_brand_id ?? null,
    brands,
    workspaceConnectors,
    profile: profileRes.rows[0]?.data ?? {},
  });
});

// ── Brands ────────────────────────────────────────────────────────────
apiRouter.get("/brands", async (req: AuthedRequest, res) => {
  res.json({ brands: await listBrands(req.user!.id) });
});

const brandSettingsSchema = z.object({
  description: z.string().max(4000).optional(),
  audience: z.string().max(4000).optional(),
  voice: z.record(z.unknown()).optional(),
  branding: z.record(z.unknown()).optional(),
});

const createBrandSchema = z
  .object({
    name: z.string().min(1).max(120),
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase/kebab"),
  })
  .merge(brandSettingsSchema);

/** Create a brand under the user's active workspace + its brand_settings. */
apiRouter.post("/brands", async (req: AuthedRequest, res) => {
  const parsed = createBrandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const user = req.user!;
  const wsRes = await pool.query<{ id: number }>(
    "SELECT active_workspace_id AS id FROM user_settings WHERE user_id = $1",
    [user.id],
  );
  const workspaceId = wsRes.rows[0]?.id;
  if (!workspaceId) {
    res.status(409).json({ error: "no active workspace" });
    return;
  }
  // Confirm membership of the active workspace before writing under it.
  const member = await pool.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, user.id],
  );
  if (!member.rowCount) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const brandRes = await client.query<{ id: number }>(
      "INSERT INTO brands (workspace_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [workspaceId, parsed.data.name, parsed.data.slug],
    );
    const brandId = brandRes.rows[0].id;
    await client.query(
      `INSERT INTO brand_settings (brand_id, description, audience, voice, branding)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        brandId,
        parsed.data.description ?? null,
        parsed.data.audience ?? null,
        JSON.stringify(parsed.data.voice ?? {}),
        JSON.stringify(parsed.data.branding ?? {}),
      ],
    );
    await client.query("COMMIT");
    res.json({ id: brandId });
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") {
      res.status(409).json({ error: "a brand with that slug already exists" });
      return;
    }
    res.status(500).json({ error: "could not create brand" });
  } finally {
    client.release();
  }
});

interface PillarOut {
  id: number;
  name: string;
  description: string | null;
  ratio: number | null;
  sortOrder: number | null;
}

/** A brand's content pillars, ordered by sort_order. */
async function listPillars(brandId: number): Promise<PillarOut[]> {
  const { rows } = await pool.query<{
    id: number;
    name: string;
    description: string | null;
    ratio: number | null;
    sort_order: number | null;
  }>(
    "SELECT id, name, description, ratio, sort_order FROM content_pillars WHERE brand_id = $1 ORDER BY sort_order NULLS LAST, id",
    [brandId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    ratio: r.ratio,
    sortOrder: r.sort_order,
  }));
}

apiRouter.get(
  "/brands/:brandId",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const [settingsRes, pillars] = await Promise.all([
      pool.query(
        "SELECT description, audience, voice, branding FROM brand_settings WHERE brand_id = $1",
        [req.brand!.id],
      ),
      listPillars(req.brand!.id),
    ]);
    res.json({ brand: req.brand, settings: settingsRes.rows[0] ?? {}, pillars });
  },
);

apiRouter.patch(
  "/brands/:brandId",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = brandSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    await pool.query(
      `INSERT INTO brand_settings (brand_id, description, audience, voice, branding, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, now())
       ON CONFLICT (brand_id) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, brand_settings.description),
         audience    = COALESCE(EXCLUDED.audience, brand_settings.audience),
         voice       = EXCLUDED.voice,
         branding    = EXCLUDED.branding,
         updated_at  = now()`,
      [
        req.brand!.id,
        parsed.data.description ?? null,
        parsed.data.audience ?? null,
        JSON.stringify(parsed.data.voice ?? {}),
        JSON.stringify(parsed.data.branding ?? {}),
      ],
    );
    res.json({ ok: true });
  },
);

// ── Brand deletion (DB cascade + media purge) ─────────────────────────
apiRouter.delete(
  "/brands/:brandId",
  requireBrand(),
  async (req: BrandRequest, res) => {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "confirmation required" });
      return;
    }
    const brandId = req.brand!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // posts FK to brands/social_accounts is NO ACTION — delete them first so
      // the brand row (and its CASCADE children) can be removed.
      await client.query("DELETE FROM posts WHERE brand_id = $1", [brandId]);
      // user_settings.active_brand_id is NO ACTION — repoint any user pointing
      // here to another brand in the same workspace (or null).
      await client.query(
        `UPDATE user_settings us
            SET active_brand_id = (
              SELECT b.id FROM brands b
               WHERE b.workspace_id = (SELECT workspace_id FROM brands WHERE id = $1)
                 AND b.id <> $1
               ORDER BY b.id LIMIT 1
            )
          WHERE us.active_brand_id = $1`,
        [brandId],
      );
      // Removes brand_settings, content_pillars, brand_platform_settings,
      // social_accounts, oauth_states via ON DELETE CASCADE.
      await client.query("DELETE FROM brands WHERE id = $1", [brandId]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "could not delete brand" });
      return;
    } finally {
      client.release();
    }
    // Purge media only AFTER the DB commit succeeds.
    try {
      await mediaStore.deletePrefix(`brands/${brandId}/`);
    } catch {
      console.error("[brand-delete] media purge failed for brand", brandId);
    }
    res.json({ ok: true });
  },
);

// ── Content pillars (replace-the-set CRUD) ────────────────────────────
const pillarsSchema = z.object({
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        ratio: z.number().int().optional(),
      }),
    )
    .max(12),
});

apiRouter.put(
  "/brands/:brandId/pillars",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = pillarsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid pillars" });
      return;
    }
    const brandId = req.brand!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM content_pillars WHERE brand_id = $1", [
        brandId,
      ]);
      let sort = 0;
      for (const p of parsed.data.pillars) {
        await client.query(
          `INSERT INTO content_pillars (brand_id, name, description, ratio, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [brandId, p.name, p.description ?? null, p.ratio ?? null, sort++],
        );
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "could not save pillars" });
      return;
    } finally {
      client.release();
    }
    res.json({ pillars: await listPillars(brandId) });
  },
);

// ── Per-platform settings (brand_platform_settings) ───────────────────
const PLATFORMS = ["instagram", "linkedin", "facebook"] as const;
type Platform = (typeof PLATFORMS)[number];

apiRouter.get(
  "/brands/:brandId/platform-settings",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const { rows } = await pool.query<{
      platform: string;
      settings: Record<string, unknown>;
    }>(
      "SELECT platform, settings FROM brand_platform_settings WHERE brand_id = $1 ORDER BY platform",
      [req.brand!.id],
    );
    res.json({ platforms: rows });
  },
);

const platformSettingsSchema = z.object({ settings: z.record(z.unknown()) });

apiRouter.put(
  "/brands/:brandId/platform-settings/:platform",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const platform = req.params.platform as Platform;
    if (!PLATFORMS.includes(platform)) {
      res.status(400).json({ error: "unknown platform" });
      return;
    }
    const parsed = platformSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "settings object required" });
      return;
    }
    await pool.query(
      `INSERT INTO brand_platform_settings (brand_id, platform, settings)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (brand_id, platform) DO UPDATE SET settings = EXCLUDED.settings`,
      [req.brand!.id, platform, JSON.stringify(parsed.data.settings)],
    );
    res.json({ platform, settings: parsed.data.settings });
  },
);

// ── Active brand (context switch) ─────────────────────────────────────
const activeBrandSchema = z.object({ brandId: z.number().int() });

apiRouter.post("/active-brand", async (req: AuthedRequest, res) => {
  const parsed = activeBrandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "brandId required" });
    return;
  }
  const user = req.user!;
  // Ownership check: the brand must belong to a workspace the user is in.
  const { rows } = await pool.query<{ workspace_id: number }>(
    `SELECT b.workspace_id
       FROM brands b
       JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
      WHERE b.id = $1 AND wm.user_id = $2`,
    [parsed.data.brandId, user.id],
  );
  if (!rows[0]) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  await pool.query(
    `INSERT INTO user_settings (user_id, active_workspace_id, active_brand_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET
       active_workspace_id = EXCLUDED.active_workspace_id,
       active_brand_id = EXCLUDED.active_brand_id,
       updated_at = now()`,
    [user.id, rows[0].workspace_id, parsed.data.brandId],
  );
  res.json({ ok: true });
});

// ── Onboarding: create the first brand + settings, set active, complete ──
const onboardingSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  brandName: z.string().max(120).optional(),
  website: z.string().max(300).optional(),
  industry: z.string().max(120).optional(),
  audience: z.string().max(2000).optional(),
  brandVoice: z.array(z.string()).max(12).optional(),
  goals: z.string().max(2000).optional(),
  platforms: z.array(z.string()).max(12).optional(),
  cadence: z.string().max(60).optional(),
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        ratio: z.number().int().optional(),
      }),
    )
    .max(12)
    .optional(),
});

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand"
  );
}

apiRouter.post("/onboarding", async (req: AuthedRequest, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const user = req.user!;
  const data = parsed.data;

  const wsRes = await pool.query<{ id: number }>(
    "SELECT active_workspace_id AS id FROM user_settings WHERE user_id = $1",
    [user.id],
  );
  const workspaceId = wsRes.rows[0]?.id;
  if (!workspaceId) {
    res.status(409).json({ error: "no active workspace" });
    return;
  }

  const voice: Record<string, unknown> = {};
  if (data.brandVoice?.length) voice.tone = data.brandVoice;
  if (data.goals?.trim()) voice.goals = data.goals.trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Profile (kept for the existing UI surface).
    await client.query(
      `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [user.id, JSON.stringify(data)],
    );

    // First brand. Prefer the 'default' slug; fall back to a derived/unique one.
    const name = data.brandName?.trim() || "Default";
    const baseSlug = data.brandName?.trim() ? slugify(data.brandName) : "default";
    const insertBrand = (slug: string) =>
      client.query<{ id: number }>(
        `INSERT INTO brands (workspace_id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, slug) DO NOTHING RETURNING id`,
        [workspaceId, name, slug],
      );
    let r = await insertBrand(baseSlug);
    if (!r.rows[0]) r = await insertBrand(`${baseSlug}-${Date.now()}`);
    const brandId = r.rows[0].id;

    await client.query(
      `INSERT INTO brand_settings (brand_id, description, audience, voice)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (brand_id) DO NOTHING`,
      [
        brandId,
        data.industry?.trim() || null,
        data.audience?.trim() || null,
        JSON.stringify(voice),
      ],
    );

    if (data.pillars?.length) {
      let sort = 0;
      for (const p of data.pillars) {
        await client.query(
          `INSERT INTO content_pillars (brand_id, name, description, ratio, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [brandId, p.name, p.description ?? null, p.ratio ?? null, sort++],
        );
      }
    }

    await client.query(
      `INSERT INTO user_settings (user_id, active_workspace_id, active_brand_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET
         active_workspace_id = EXCLUDED.active_workspace_id,
         active_brand_id = EXCLUDED.active_brand_id,
         updated_at = now()`,
      [user.id, workspaceId, brandId],
    );

    await client.query(
      "UPDATE users SET onboarding_completed = true WHERE id = $1",
      [user.id],
    );

    await client.query("COMMIT");
    res.json({ ok: true, brandId });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "could not complete onboarding" });
  } finally {
    client.release();
  }
});

// ── Instagram connector (brand-scoped) ────────────────────────────────
apiRouter.get(
  "/brands/:brandId/connectors/instagram/status",
  requireBrand(),
  async (req: BrandRequest, res) => {
    try {
      res.json(await instagram.status(req.brand!.id));
    } catch {
      res.status(500).json({ error: "could not read Instagram status" });
    }
  },
);

apiRouter.get(
  "/brands/:brandId/connectors/instagram/connect-url",
  requireBrand(),
  async (req: BrandRequest, res) => {
    try {
      const url = await instagram.getConnectUrl(req.brand!.id);
      res.json({ url });
    } catch {
      res.status(400).json({ error: "Instagram connector not configured" });
    }
  },
);

const publishSchema = z.object({
  caption: z.string().max(2200).optional(),
  imageBase64: z.string().min(1),
  contentType: z.string().default("image/jpeg"),
});

apiRouter.post(
  "/brands/:brandId/connectors/instagram/publish",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "imageBase64 required" });
      return;
    }
    try {
      const result = await instagram.publishImage(
        req.brand!.id,
        { base64: parsed.data.imageBase64, contentType: parsed.data.contentType },
        parsed.data.caption,
      );
      res.json(result);
    } catch {
      res.status(500).json({ error: "publish failed" });
    }
  },
);

// ── Workspace-level API-key connectors (Claude / Higgsfield) ──────────
apiRouter.get(
  "/workspaces/:workspaceId/connectors",
  requireWorkspace(),
  async (req: WorkspaceRequest, res) => {
    res.json({ connectors: await listConnectors(req.workspaceId!) });
  },
);

const setConnectorSchema = z.object({
  apiKey: z.string().min(1),
  config: z.record(z.unknown()).optional(),
});

const PROVIDERS: WorkspaceProvider[] = ["anthropic", "higgsfield"];

apiRouter.put(
  "/workspaces/:workspaceId/connectors/:provider",
  requireWorkspace(),
  async (req: WorkspaceRequest, res) => {
    const provider = req.params.provider as WorkspaceProvider;
    if (!PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "unknown provider" });
      return;
    }
    const parsed = setConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "apiKey required" });
      return;
    }
    try {
      // anthropic: validate the BYO key live (token-free) before storing.
      // higgsfield: store-only (generation runs through the Higgsfield MCP).
      if (provider === "anthropic") {
        await anthropic.validateKey(parsed.data.apiKey);
      }
      await setConnector(req.workspaceId!, provider, {
        apiKey: parsed.data.apiKey,
        config: parsed.data.config,
      });
      const connectors = await listConnectors(req.workspaceId!);
      res.json({
        connector: connectors.find((c) => c.provider === provider) ?? null,
      });
    } catch (e) {
      // Enumerated only — never echo the key or raw provider error.
      const msg = (e as Error).message;
      res
        .status(msg === "invalid API key" ? 400 : 502)
        .json({ error: msg === "invalid API key" ? "invalid API key" : "could not save connector" });
    }
  },
);

apiRouter.delete(
  "/workspaces/:workspaceId/connectors/:provider",
  requireWorkspace(),
  async (req: WorkspaceRequest, res) => {
    const provider = req.params.provider as WorkspaceProvider;
    if (!PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "unknown provider" });
      return;
    }
    await deleteConnector(req.workspaceId!, provider);
    res.json({ ok: true });
  },
);

// ── AI caption assist (brand-scoped, BYOK Claude) ─────────────────────
const captionSchema = z.object({
  prompt: z.string().max(4000).optional(),
  platform: z.string().max(60).optional(),
});

apiRouter.post(
  "/brands/:brandId/ai/caption",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = captionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    try {
      const result = await generateCaption(req.brand!.id, parsed.data);
      res.json(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "No AI provider connected for this workspace") {
        res
          .status(400)
          .json({ error: "Connect an AI provider in workspace settings" });
        return;
      }
      if (msg === "AI declined to generate this caption") {
        res.status(422).json({ error: msg });
        return;
      }
      if (msg === "AI provider key is invalid") {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(500).json({ error: "caption generation failed" });
    }
  },
);

// ── GDPR data export (no secrets/tokens) ──────────────────────────────
apiRouter.get("/account/export", async (req: AuthedRequest, res) => {
  const userId = req.user!.id;

  const userRow = await pool.query<{ email: string; created_at: Date }>(
    "SELECT email, created_at FROM users WHERE id = $1",
    [userId],
  );
  const profile = await pool.query<{ data: unknown }>(
    "SELECT data FROM profiles WHERE user_id = $1",
    [userId],
  );
  // Only workspaces the user is a member of.
  const workspaces = await pool.query<{
    id: number;
    name: string;
    owner_user_id: number;
    role: string;
    created_at: Date;
  }>(
    `SELECT w.id, w.name, w.owner_user_id, wm.role, w.created_at
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1
      ORDER BY w.id`,
    [userId],
  );

  const exportWorkspaces = [];
  for (const w of workspaces.rows) {
    const connectors = await pool.query<{
      provider: string;
      status: string;
      config: unknown;
    }>(
      "SELECT provider, status, config FROM workspace_connectors WHERE workspace_id = $1 ORDER BY provider",
      [w.id],
    );
    const brands = await pool.query<{ id: number; name: string; slug: string }>(
      "SELECT id, name, slug FROM brands WHERE workspace_id = $1 ORDER BY id",
      [w.id],
    );
    const exportBrands = [];
    for (const b of brands.rows) {
      const [settings, pillars, platformSettings, socials, posts] =
        await Promise.all([
          pool.query(
            "SELECT description, audience, voice, branding FROM brand_settings WHERE brand_id = $1",
            [b.id],
          ),
          pool.query(
            "SELECT name, description, ratio, sort_order FROM content_pillars WHERE brand_id = $1 ORDER BY sort_order NULLS LAST, id",
            [b.id],
          ),
          pool.query(
            "SELECT platform, settings FROM brand_platform_settings WHERE brand_id = $1 ORDER BY platform",
            [b.id],
          ),
          // METADATA ONLY — never access_token/refresh_token.
          pool.query(
            "SELECT platform, username, external_id, status, token_expires_at FROM social_accounts WHERE brand_id = $1 ORDER BY id",
            [b.id],
          ),
          pool.query(
            "SELECT media_type, caption, media_urls, status, permalink, created_at FROM posts WHERE brand_id = $1 ORDER BY id",
            [b.id],
          ),
        ]);
      exportBrands.push({
        name: b.name,
        slug: b.slug,
        settings: settings.rows[0] ?? {},
        contentPillars: pillars.rows,
        platformSettings: platformSettings.rows,
        socialAccounts: socials.rows,
        posts: posts.rows,
      });
    }
    exportWorkspaces.push({
      name: w.name,
      role: w.role,
      isOwner: w.owner_user_id === userId,
      createdAt: w.created_at,
      // provider/status/config only — secrets jsonb is NEVER selected.
      connectors: connectors.rows,
      brands: exportBrands,
    });
  }

  const doc = {
    exportedAt: new Date().toISOString(),
    user: {
      email: userRow.rows[0]?.email,
      createdAt: userRow.rows[0]?.created_at,
    },
    profile: profile.rows[0]?.data ?? {},
    workspaces: exportWorkspaces,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="marketing-harness-export.json"',
  );
  res.send(JSON.stringify(doc, null, 2));
});

// ── Account deletion (DB cascade + manual purges + media) ─────────────
const accountDeleteSchema = z.object({ confirmEmail: z.string() });

apiRouter.post("/account/delete", async (req: AuthedRequest, res) => {
  const user = req.user!;
  const parsed = accountDeleteSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmEmail !== user.email) {
    res.status(400).json({ error: "confirmEmail must match your account email" });
    return;
  }

  // (a) Purge media for every brand in workspaces the user OWNS (those brands
  //     are removed by the cascade below; their objects must go too).
  const brands = await pool.query<{ id: number }>(
    `SELECT b.id FROM brands b
       JOIN workspaces w ON w.id = b.workspace_id
      WHERE w.owner_user_id = $1`,
    [user.id],
  );

  // (b) DELETE FROM users cascades to: workspaces(owner)->brands->brand_settings,
  //     content_pillars, brand_platform_settings, social_accounts, oauth_states;
  //     plus workspace_members, profiles, sessions, user_settings(user_id),
  //     oauth_tokens, oauth_auth_codes, oauth_authorization_requests(consent_user_id).
  //     NOT cascaded (NO ACTION) and handled explicitly:
  //       - posts.brand_id / .social_account_id
  //       - user_settings.active_brand_id / .active_workspace_id (other users)
  //     magic_link_tokens has no FK (keyed by email) — manual.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // posts for the owned brands (NO ACTION FK would block the cascade).
    await client.query(
      `DELETE FROM posts WHERE brand_id IN (
         SELECT b.id FROM brands b JOIN workspaces w ON w.id = b.workspace_id
          WHERE w.owner_user_id = $1
       )`,
      [user.id],
    );
    // Repoint any OTHER user's active pointers that reference the soon-deleted
    // workspaces/brands (NO ACTION would otherwise block deletion).
    await client.query(
      `UPDATE user_settings SET active_brand_id = NULL
        WHERE active_brand_id IN (
          SELECT b.id FROM brands b JOIN workspaces w ON w.id = b.workspace_id
           WHERE w.owner_user_id = $1
        )`,
      [user.id],
    );
    await client.query(
      `UPDATE user_settings SET active_workspace_id = NULL
        WHERE active_workspace_id IN (
          SELECT id FROM workspaces WHERE owner_user_id = $1
        )`,
      [user.id],
    );
    await client.query("DELETE FROM users WHERE id = $1", [user.id]);
    // (c) magic_link_tokens has no FK — purge by email.
    await client.query("DELETE FROM magic_link_tokens WHERE email = $1", [
      user.email,
    ]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "could not delete account" });
    return;
  } finally {
    client.release();
  }

  // Purge media after the DB commit.
  for (const b of brands.rows) {
    try {
      await mediaStore.deletePrefix(`brands/${b.id}/`);
    } catch {
      console.error("[account-delete] media purge failed for brand", b.id);
    }
  }

  // (d) Clear the session cookie.
  await clearSession(req, res);
  res.json({ ok: true });
});

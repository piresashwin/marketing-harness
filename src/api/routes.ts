import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { env } from "../config/env.js";
import { requireAuth, clearSession, type AuthedRequest } from "../auth/session.js";
import { instagram, InsightsPermissionError } from "../connectors/instagram/index.js";
import { generateCaption } from "../connectors/anthropic/index.js";
import {
  listConnectors,
  setConnector,
  deleteConnector,
  type WorkspaceProvider,
} from "../connectors/workspace.js";
import * as anthropic from "../connectors/anthropic/index.js";
import {
  fetchSiteSignal,
  siteSignalToText,
  type SiteExtractError,
} from "../connectors/web-extract/index.js";
import { mediaStore } from "../connectors/media/index.js";
import {
  submitForReview,
  approvePost,
  requestChanges,
  addComment,
  listComments,
  listReviewQueue,
} from "../posts/review.js";
import { createReviewToken } from "../posts/clientPortal.js";

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
  why: z.string().max(2000).optional(),
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
      `INSERT INTO brand_settings (brand_id, why, description, audience, voice, branding)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        brandId,
        parsed.data.why ?? null,
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

interface BrandSettings {
  why: string | null;
  description: string | null;
  audience: string | null;
  voice: Record<string, unknown>;
  branding: Record<string, unknown>;
}

export interface BrandDetail {
  brand: BrandRow;
  settings: BrandSettings;
  pillars: PillarOut[];
}

/**
 * Loads a brand's profile data (settings + pillars) by brand id.
 * The caller is responsible for ownership / membership verification before
 * invoking this — it does NOT re-check tenancy.
 */
export async function loadBrandDetail(brandId: number): Promise<BrandDetail | null> {
  const [brandRes, settingsRes, pillars] = await Promise.all([
    pool.query<BrandRow>(
      "SELECT id, workspace_id, name, slug FROM brands WHERE id = $1",
      [brandId],
    ),
    pool.query<BrandSettings>(
      "SELECT why, description, audience, voice, branding FROM brand_settings WHERE brand_id = $1",
      [brandId],
    ),
    listPillars(brandId),
  ]);
  if (!brandRes.rows[0]) return null;
  return {
    brand: brandRes.rows[0],
    settings: settingsRes.rows[0] ?? { why: null, description: null, audience: null, voice: {}, branding: {} },
    pillars,
  };
}

apiRouter.get(
  "/brands/:brandId",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const detail = await loadBrandDetail(req.brand!.id);
    res.json(detail ?? { brand: req.brand, settings: {}, pillars: [] });
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
      `INSERT INTO brand_settings (brand_id, why, description, audience, voice, branding, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
       ON CONFLICT (brand_id) DO UPDATE SET
         why         = COALESCE(EXCLUDED.why, brand_settings.why),
         description = COALESCE(EXCLUDED.description, brand_settings.description),
         audience    = COALESCE(EXCLUDED.audience, brand_settings.audience),
         voice       = EXCLUDED.voice,
         branding    = EXCLUDED.branding,
         updated_at  = now()`,
      [
        req.brand!.id,
        parsed.data.why ?? null,
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

// ── Instagram scheduled publishing (brand-scoped) ────────────────────
const scheduleSchema = z.object({
  caption: z.string().max(2200).optional(),
  imageBase64: z.string().min(1),
  contentType: z.string().default("image/jpeg"),
  scheduledAt: z.string().datetime({ offset: true }),
});

apiRouter.post(
  "/brands/:brandId/connectors/instagram/schedule",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "imageBase64 and a future scheduledAt (ISO 8601) are required" });
      return;
    }
    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (scheduledAt <= new Date()) {
      res.status(400).json({ error: "scheduledAt must be in the future" });
      return;
    }
    try {
      const postId = await instagram.schedulePost(req.brand!.id, {
        media: { base64: parsed.data.imageBase64, contentType: parsed.data.contentType },
        caption: parsed.data.caption,
        scheduledAt,
      });
      res.status(201).json({ id: postId });
    } catch {
      res.status(500).json({ error: "could not schedule post" });
    }
  },
);

interface PostRow {
  id: number;
  caption: string | null;
  media_urls: string[];
  media_type: string;
  scheduled_at: Date | null;
  status: string;
}

// GET  /brands/:brandId/posts?status=scheduled (defaults to scheduled)
apiRouter.get(
  "/brands/:brandId/posts",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "scheduled";
    const { rows } = await pool.query<PostRow>(
      `SELECT id, caption, media_urls, media_type, scheduled_at, status
         FROM posts
        WHERE brand_id = $1
          AND status = $2
        ORDER BY scheduled_at ASC NULLS LAST, id ASC`,
      [req.brand!.id, status],
    );
    res.json({
      posts: rows.map((r) => ({
        id: r.id,
        caption: r.caption,
        mediaUrls: r.media_urls,
        mediaType: r.media_type,
        scheduledAt: r.scheduled_at?.toISOString() ?? null,
        status: r.status,
      })),
    });
  },
);

// DELETE /brands/:brandId/posts/:postId — cancel a scheduled post only
apiRouter.delete(
  "/brands/:brandId/posts/:postId",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    const { rowCount } = await pool.query(
      `DELETE FROM posts WHERE id = $1 AND brand_id = $2 AND status = 'scheduled'`,
      [postId, req.brand!.id],
    );
    if (!rowCount) {
      res.status(404).json({ error: "post not found or not cancellable" });
      return;
    }
    res.json({ ok: true });
  },
);

// ── Post review workflow (brand-scoped) ───────────────────────────────

// GET /brands/:brandId/posts/review-queue
apiRouter.get(
  "/brands/:brandId/posts/review-queue",
  requireBrand(),
  async (req: BrandRequest, res) => {
    try {
      const posts = await listReviewQueue(req.brand!.id);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "could not load review queue" });
    }
  },
);

// POST /brands/:brandId/posts/:postId/submit
apiRouter.post(
  "/brands/:brandId/posts/:postId/submit",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    try {
      const post = await submitForReview(req.brand!.id, postId);
      res.json({ post });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(404).json({ error: "post not found or cannot be submitted" });
        return;
      }
      res.status(500).json({ error: "could not submit post for review" });
    }
  },
);

// POST /brands/:brandId/posts/:postId/approve
apiRouter.post(
  "/brands/:brandId/posts/:postId/approve",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    try {
      const post = await approvePost(req.brand!.id, postId);
      res.json({ post });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(404).json({ error: "post not found or cannot be approved" });
        return;
      }
      res.status(500).json({ error: "could not approve post" });
    }
  },
);

const requestChangesSchema = z.object({
  body: z.string().min(1).max(10000),
});

// POST /brands/:brandId/posts/:postId/request-changes
apiRouter.post(
  "/brands/:brandId/posts/:postId/request-changes",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    const parsed = requestChangesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const user = req.user!;
    try {
      const result = await requestChanges(req.brand!.id, postId, {
        authorUserId: user.id,
        authorLabel: "Team member",
        body: parsed.data.body,
      });
      res.json(result);
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res
          .status(404)
          .json({ error: "post not found or cannot have changes requested" });
        return;
      }
      res.status(500).json({ error: "could not request changes" });
    }
  },
);

const addCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

// GET /brands/:brandId/posts/:postId/comments
apiRouter.get(
  "/brands/:brandId/posts/:postId/comments",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    try {
      const comments = await listComments(req.brand!.id, postId);
      res.json({ comments });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(404).json({ error: "post not found" });
        return;
      }
      res.status(500).json({ error: "could not load comments" });
    }
  },
);

// POST /brands/:brandId/posts/:postId/comments
apiRouter.post(
  "/brands/:brandId/posts/:postId/comments",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    const parsed = addCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const user = req.user!;
    try {
      const comment = await addComment(req.brand!.id, postId, {
        authorUserId: user.id,
        authorLabel: "Team member",
        body: parsed.data.body,
        visibility: "internal",
      });
      res.status(201).json({ comment });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(404).json({ error: "post not found" });
        return;
      }
      res.status(500).json({ error: "could not add comment" });
    }
  },
);

// POST /brands/:brandId/posts/:postId/review-link — create a public client-review URL
// Returns { url } with the raw token embedded; the token hash is stored, raw token is not.
apiRouter.post(
  "/brands/:brandId/posts/:postId/review-link",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    try {
      const rawToken = await createReviewToken(req.brand!.id, postId);
      const url = `${env.appBaseUrl}/review/${rawToken}`;
      res.status(201).json({ url });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(404).json({ error: "post not found" });
        return;
      }
      res.status(500).json({ error: "could not create review link" });
    }
  },
);

// ── Instagram analytics (brand-scoped) ────────────────────────────────
const ANALYTICS_RANGES = [7, 30, 90];

// Maps the connector's enumerated analytics errors → safe client codes the UI
// branches on (reconnect prompt vs connect prompt). Never echoes raw text.
function handleAnalyticsError(e: unknown, res: Response): void {
  const msg = (e as Error).message;
  if (e instanceof InsightsPermissionError) {
    res.status(409).json({
      error: "reconnect_required",
      message: "Reconnect Instagram to grant analytics access",
    });
    return;
  }
  if (msg.startsWith("No Instagram account connected")) {
    res
      .status(409)
      .json({ error: "not_connected", message: "Connect Instagram first" });
    return;
  }
  res.status(500).json({ error: "could not load analytics" });
}

// GET metrics: returns the latest stored snapshot by default; ?refresh=true (or
// no snapshot yet) pulls fresh from the Graph API. ?range=7|30|90 sets the
// window for a fresh pull.
apiRouter.get(
  "/brands/:brandId/analytics/instagram",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const range = ANALYTICS_RANGES.includes(Number(req.query.range))
      ? Number(req.query.range)
      : 30;
    const refresh = req.query.refresh === "true";
    try {
      let result = refresh ? null : await instagram.latestAnalytics(req.brand!.id);
      if (!result) result = await instagram.fetchAnalytics(req.brand!.id, range);
      res.json(result);
    } catch (e) {
      handleAnalyticsError(e, res);
    }
  },
);

// GET history: compact KPI series from stored snapshots (oldest → newest) for
// trend sparklines. Pure DB read — no Graph API call, no fresh pull.
apiRouter.get(
  "/brands/:brandId/analytics/instagram/history",
  requireBrand(),
  async (req: BrandRequest, res) => {
    try {
      res.json(await instagram.analyticsHistory(req.brand!.id));
    } catch (e) {
      handleAnalyticsError(e, res);
    }
  },
);

// POST insights: runs Claude over the latest snapshot (fetching one first if
// none exists) and returns structured insights/action plan/suggestions/ideas.
apiRouter.post(
  "/brands/:brandId/analytics/instagram/insights",
  requireBrand(),
  async (req: BrandRequest, res) => {
    try {
      let result = await instagram.latestAnalytics(req.brand!.id);
      if (!result) result = await instagram.fetchAnalytics(req.brand!.id, 30);
      const insights = await anthropic.deriveInsights(
        req.brand!.id,
        result.snapshot,
        result.deltas,
      );
      res.json(insights);
    } catch (e) {
      const msg = (e as Error).message;
      if (
        e instanceof InsightsPermissionError ||
        msg.startsWith("No Instagram account connected")
      ) {
        handleAnalyticsError(e, res);
        return;
      }
      handleAiError(e, res, "insights generation failed");
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

// ── Brand Profile assist (brand-scoped, BYOK Claude) ──────────────────
// Maps the connector's enumerated errors → safe client status/messages. Never
// echoes raw provider text.
function handleAiError(e: unknown, res: Response, fallback: string): void {
  const msg = (e as Error).message;
  if (msg === "No AI provider connected for this workspace") {
    res.status(400).json({ error: "Connect an AI provider in workspace settings" });
    return;
  }
  if (msg === "AI provider key is invalid") {
    res.status(400).json({ error: msg });
    return;
  }
  if (msg === "AI declined to generate this content") {
    res.status(422).json({ error: msg });
    return;
  }
  res.status(500).json({ error: fallback });
}

const PROFILE_FIELDS = ["belief", "voice", "visual", "product", "audience"] as const;
const profileDraftSchema = z.object({ seed: z.string().min(1).max(2000) });
const profileRefineSchema = z.object({
  field: z.enum(PROFILE_FIELDS),
  current: z.string().max(4000).optional(),
  steer: z.string().max(60).optional(),
});

apiRouter.post(
  "/brands/:brandId/ai/profile/draft",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = profileDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    try {
      res.json(await anthropic.draftProfile(req.brand!.id, parsed.data.seed));
    } catch (e) {
      handleAiError(e, res, "profile draft failed");
    }
  },
);

// ── Autofill the profile from an external source (website / Instagram) ──
// Both fetch brand signal, then draft via the same runTask choke point as the
// seed-based draft. Nothing is persisted — the UI maps the draft onto fields.
const profileExtractSchema = z.object({ url: z.string().min(1).max(2048) });

// Map the extractor's enumerated codes → safe client messages. Never echoes the
// URL or raw fetch error.
const SITE_EXTRACT_MESSAGES: Record<SiteExtractError, string> = {
  invalid_url: "That doesn't look like a valid website address.",
  blocked_host: "That address can't be reached — try your public website URL.",
  unreachable: "Couldn't reach that website. Check the URL and try again.",
  not_html: "Couldn't read any content from that page.",
  timeout: "That website took too long to respond. Try again.",
};

apiRouter.post(
  "/brands/:brandId/ai/profile/extract",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = profileExtractSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    let signal;
    try {
      signal = await fetchSiteSignal(parsed.data.url);
    } catch (e) {
      const msg = (e as Error).message as SiteExtractError;
      res.status(422).json({
        error: msg in SITE_EXTRACT_MESSAGES ? SITE_EXTRACT_MESSAGES[msg] : "Couldn't read that website.",
      });
      return;
    }
    try {
      res.json(
        await anthropic.draftProfileFromSource(req.brand!.id, {
          label: "the brand's website",
          content: siteSignalToText(signal),
        }),
      );
    } catch (e) {
      handleAiError(e, res, "profile draft failed");
    }
  },
);

apiRouter.post(
  "/brands/:brandId/ai/profile/from-instagram",
  requireBrand(),
  async (req: BrandRequest, res) => {
    let signal;
    try {
      signal = await instagram.profileSignal(req.brand!.id);
    } catch (e) {
      if ((e as Error).message.startsWith("No Instagram account connected")) {
        res.status(409).json({ error: "not_connected", message: "Connect Instagram first" });
        return;
      }
      res.status(502).json({ error: "Couldn't read your Instagram profile." });
      return;
    }
    const content = [
      `Instagram: @${signal.username} (${signal.followersCount} followers)`,
      signal.captions.length
        ? `Recent post captions:\n- ${signal.captions.join("\n- ")}`
        : "No recent captions available.",
    ].join("\n");
    try {
      res.json(
        await anthropic.draftProfileFromSource(req.brand!.id, {
          label: "the brand's Instagram profile and its recent post captions",
          content,
        }),
      );
    } catch (e) {
      handleAiError(e, res, "profile draft failed");
    }
  },
);

apiRouter.post(
  "/brands/:brandId/ai/profile/refine",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = profileRefineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    try {
      res.json(await anthropic.refineProfileField(req.brand!.id, parsed.data));
    } catch (e) {
      handleAiError(e, res, "profile refine failed");
    }
  },
);

// ── AI content plan (brand-scoped, BYOK Claude) ───────────────────────
const contentPlanSchema = z.object({
  note: z.string().max(2000).optional(),
});

apiRouter.post(
  "/brands/:brandId/ai/content-plan",
  requireBrand(),
  async (req: BrandRequest, res) => {
    const parsed = contentPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    try {
      res.json(await anthropic.generateContentPlan(req.brand!.id, parsed.data));
    } catch (e) {
      handleAiError(e, res, "content plan generation failed");
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
      const [settings, pillars, platformSettings, socials, posts, analytics, comments] =
        await Promise.all([
          pool.query(
            "SELECT why, description, audience, voice, branding FROM brand_settings WHERE brand_id = $1",
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
          // Analytics snapshots — payload is metrics + the brand's own captions
          // / @handle (no tokens or secrets).
          pool.query(
            "SELECT range_days, payload, fetched_at FROM ig_analytics_snapshots WHERE brand_id = $1 ORDER BY fetched_at DESC",
            [b.id],
          ),
          // author_user_id excluded (internal id, not useful in export).
          pool.query(
            "SELECT id, post_id, visibility, author_label, body, created_at FROM post_comments WHERE brand_id = $1 ORDER BY created_at",
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
        analyticsSnapshots: analytics.rows,
        postComments: comments.rows,
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
    // Erase comments authored by this user in any workspace (GDPR erasure).
    await client.query("DELETE FROM post_comments WHERE author_user_id = $1", [
      user.id,
    ]);
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

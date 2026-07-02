import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pool } from "../db/index.js";
import { instagram } from "../connectors/instagram/index.js";
import {
  generateCaption,
  draftProfile,
  draftProfileFromSource,
  refineProfileField,
  deriveInsights,
  generateContentPlan,
} from "../connectors/anthropic/index.js";
import {
  fetchSiteSignal,
  siteSignalToText,
} from "../connectors/web-extract/index.js";
import { loadBrandDetail } from "../api/routes.js";
import { env } from "../config/env.js";
import { listReviewQueue, approvePost } from "../posts/review.js";

// MCP tools are reached over POST /mcp, which is now protected by OAuth 2.1
// bearer auth (see requireBearerAuth in src/index.ts). The authenticated user id
// is threaded into createMcpServer(userId), and every brand-scoped tool calls
// assertBrandOwned() FIRST — the same ownership predicate as the REST
// `requireBrand` middleware. brand_id from the caller is therefore never trusted
// blindly; it must belong to a workspace the authenticated user is a member of.
const BRAND_ID_DESC =
  "Brand id (tenant scope). Must belong to your workspace; use list_brands to discover ids.";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// Sanitized tool error. We do NOT forward raw provider/internal error text to the
// agent — known causes map to a small enumerated set; everything else is generic.
// Detail is kept server-side via console.error (name only, no token/PII).
class ToolForbiddenError extends Error {}

function fail(e: unknown) {
  if (e instanceof ToolForbiddenError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Error: forbidden — not your brand" }],
    };
  }
  console.error("[mcp] tool error:", (e as Error).name);
  return {
    isError: true,
    content: [{ type: "text" as const, text: "Error: tool failed" }],
  };
}

/** Ownership check mirroring REST requireBrand. Throws if the user can't access it. */
async function assertBrandOwned(userId: number, brandId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM brands b
       JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
      WHERE b.id = $1 AND wm.user_id = $2`,
    [brandId, userId],
  );
  if (!rowCount) throw new ToolForbiddenError("forbidden");
}

const mediaShape = {
  url: z.string().url().optional().describe("Already-public media URL (used as-is)"),
  path: z.string().optional().describe("Local file path on the harness host"),
  base64: z.string().optional().describe("Base64-encoded bytes"),
  contentType: z.string().optional().describe("e.g. image/jpeg"),
};

/**
 * Builds a fresh MCP server scoped to the authenticated user. All tenant tools
 * are ownership-checked against this userId.
 */
export function createMcpServer(userId: number): McpServer {
  const server = new McpServer({
    name: "marketing-harness",
    version: "0.1.0",
  });

  server.registerTool(
    "list_brands",
    {
      title: "List your brands",
      description:
        "Returns the brands you can access (id + name), for use as brand_id in other tools.",
      inputSchema: {},
    },
    async () => {
      try {
        const { rows } = await pool.query<{ id: number; name: string }>(
          `SELECT b.id, b.name FROM brands b
             JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
            WHERE wm.user_id = $1 ORDER BY b.id`,
          [userId],
        );
        return json({ brands: rows });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_brand_profile",
    {
      title: "Get brand profile",
      description:
        "Read the brand's voice, visual direction, and content pillars to ground a Higgsfield image prompt or caption before generating. " +
        "Returns: name, why/belief, description, target audience, voice (tone list, are/never guidelines), visual direction, brand colors, and content pillars (name + description + ratio). " +
        "Call this first, then use the visual direction + brand colors to craft a Higgsfield generate_image prompt, then pass the returned URL to ig_publish_image or ig_schedule_image. " +
        "Never returns secrets, tokens, or connector keys.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const detail = await loadBrandDetail(brand_id);
        if (!detail) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Error: brand not found" }],
          };
        }
        const { brand, settings, pillars } = detail;
        const voice = (settings.voice ?? {}) as Record<string, unknown>;
        const branding = (settings.branding ?? {}) as Record<string, unknown>;
        return json({
          name: brand.name,
          why: settings.why ?? null,
          description: settings.description ?? null,
          audience: settings.audience ?? null,
          voice: {
            tone: voice.tone ?? [],
            are: voice.are ?? [],
            never: voice.never ?? [],
            guidelines: voice.guidelines ?? null,
          },
          visualDirection: branding.visualDirection ?? null,
          brandColors: branding.colors ?? null,
          contentPillars: pillars.map((p) => ({
            name: p.name,
            description: p.description,
            ratio: p.ratio,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_get_connect_url",
    {
      title: "Get Instagram connect URL",
      description:
        "Returns a URL the user opens in a browser to connect their Instagram Business/Creator account via OAuth.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const url = await instagram.getConnectUrl(brand_id);
        return json({
          connect_url: url,
          instructions:
            "Open this URL in a browser, authorize, and you'll be redirected back to the harness.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_connect_status",
    {
      title: "Instagram connection status",
      description:
        "Reports whether an Instagram account is connected for the given brand, with username and token expiry.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await instagram.status(brand_id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_publish_image",
    {
      title: "Publish image to Instagram",
      description:
        "Publishes a single image post immediately. Provide exactly one of url/path/base64. Returns the published media id and permalink. " +
        "Agent media generation recipe: (1) call get_brand_profile to read the brand's visual direction and colors, " +
        "(2) craft a Higgsfield generate_image prompt grounded in those details, " +
        "(3) pass the returned image URL here as `url`.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        caption: z.string().optional(),
        ...mediaShape,
      },
    },
    async ({ brand_id, caption, url, path, base64, contentType }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const result = await instagram.publishImage(
          brand_id,
          { url, path, base64, contentType },
          caption,
        );
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_publish_carousel",
    {
      title: "Publish carousel to Instagram",
      description:
        "Publishes a carousel (2–10 images). Each item is one media object (url/path/base64).",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        caption: z.string().optional(),
        images: z
          .array(z.object(mediaShape))
          .min(2)
          .max(10)
          .describe("2–10 media items"),
      },
    },
    async ({ brand_id, caption, images }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const result = await instagram.publishCarousel(brand_id, images, caption);
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_schedule_image",
    {
      title: "Schedule an Instagram image post",
      description:
        "Fetches and stores the image now (a stable copy in the media store), then schedules it for publication at the given time. " +
        "Provide exactly one of url/path/base64. Returns the scheduled post id; the worker publishes it automatically. " +
        "Agent media generation recipe: (1) call get_brand_profile to read the brand's visual direction and colors, " +
        "(2) craft a Higgsfield generate_image prompt grounded in those details, " +
        "(3) pass the returned image URL here as `url` — it is re-hosted immediately so the ephemeral URL will not expire before publish time.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        caption: z.string().optional(),
        scheduled_at: z
          .string()
          .describe("ISO 8601 datetime (must be in the future), e.g. 2025-07-01T09:00:00Z"),
        ...mediaShape,
      },
    },
    async ({ brand_id, caption, scheduled_at, url, path, base64, contentType }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const scheduledAt = new Date(scheduled_at);
        if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Error: scheduled_at must be a valid future ISO 8601 datetime" }],
          };
        }
        const postId = await instagram.schedulePost(brand_id, {
          media: { url, path, base64, contentType },
          caption,
          scheduledAt,
        });
        return json({ postId, scheduledAt: scheduledAt.toISOString() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_list_queue",
    {
      title: "List scheduled Instagram posts",
      description:
        "Returns the brand's queue of scheduled posts (id, caption, media URLs, scheduled time, status).",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const { rows } = await pool.query<{
          id: number;
          caption: string | null;
          media_urls: string[];
          media_type: string;
          scheduled_at: Date | null;
          status: string;
        }>(
          `SELECT id, caption, media_urls, media_type, scheduled_at, status
             FROM posts
            WHERE brand_id = $1 AND status = 'scheduled'
            ORDER BY scheduled_at ASC NULLS LAST, id ASC`,
          [brand_id],
        );
        return json({
          posts: rows.map((r) => ({
            id: r.id,
            caption: r.caption,
            mediaUrls: r.media_urls,
            mediaType: r.media_type,
            scheduledAt: r.scheduled_at?.toISOString() ?? null,
            status: r.status,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_analytics",
    {
      title: "Instagram analytics",
      description:
        "Returns a normalized Instagram analytics snapshot for the brand (account counts, account insights, audience demographics, per-post metrics) with week-over-week deltas. Reads the latest stored snapshot by default; set refresh=true to pull fresh from the Graph API (rate-limited). Requires the account to be connected with analytics access.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        range_days: z
          .union([z.literal(7), z.literal(30), z.literal(90)])
          .optional()
          .describe("Window for a fresh pull (7, 30, or 90 days). Default 30."),
        refresh: z
          .boolean()
          .optional()
          .describe("Force a fresh Graph API pull instead of the stored snapshot."),
      },
    },
    async ({ brand_id, range_days, refresh }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const range = range_days ?? 30;
        let result = refresh ? null : await instagram.latestAnalytics(brand_id);
        if (!result) result = await instagram.fetchAnalytics(brand_id, range);
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_analytics_insights",
    {
      title: "Instagram analytics insights",
      description:
        "Runs Claude over the brand's latest Instagram analytics snapshot (pulling one first if none exists) and returns structured insights, a prioritised action plan, tactical suggestions, and content ideas in the brand's voice. Uses the workspace's BYO Claude key and spends its credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        let result = await instagram.latestAnalytics(brand_id);
        if (!result) result = await instagram.fetchAnalytics(brand_id, 30);
        return json(await deriveInsights(brand_id, result.snapshot, result.deltas));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ig_analytics_history",
    {
      title: "Instagram analytics history",
      description:
        "Returns a compact KPI time-series (followers, reach, views, total interactions) from the brand's stored Instagram analytics snapshots, oldest first — for trend lines and sparklines. Pure read of stored snapshots; no Graph API call.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        limit: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Max snapshots to return, newest-bounded (default 30)."),
      },
    },
    async ({ brand_id, limit }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await instagram.analyticsHistory(brand_id, limit ?? 30));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "generate_caption",
    {
      title: "Generate a marketing caption",
      description:
        "Generates a platform-appropriate marketing caption in the brand's voice using the workspace's BYO Claude key. Spends the workspace's Claude credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        prompt: z.string().optional().describe("Topic / what the post is about"),
        platform: z.string().optional().describe("e.g. instagram, tiktok"),
      },
    },
    async ({ brand_id, prompt, platform }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await generateCaption(brand_id, { prompt, platform }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "draft_brand_profile",
    {
      title: "Draft a brand profile",
      description:
        "Drafts a full brand profile (belief, tone, voice, product, audience, visual direction, content pillars) from a one-line description, using the workspace's BYO Claude key. Returns a structured draft to review — it is NOT saved. Spends the workspace's Claude credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        seed: z
          .string()
          .describe("One-line description: what the brand makes and who it's for"),
      },
    },
    async ({ brand_id, seed }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await draftProfile(brand_id, seed));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "draft_brand_profile_from_url",
    {
      title: "Draft a brand profile from a website",
      description:
        "Fetches the given website, extracts its brand signal (title, copy, headings, theme), and drafts a full brand profile from it — same structured shape as draft_brand_profile. Returns a draft to review; it is NOT saved. Uses the workspace's BYO Claude key and spends its credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        url: z.string().describe("The brand's public website URL"),
      },
    },
    async ({ brand_id, url }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const signal = await fetchSiteSignal(url);
        return json(
          await draftProfileFromSource(brand_id, {
            label: "the brand's website",
            content: siteSignalToText(signal),
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "draft_brand_profile_from_instagram",
    {
      title: "Draft a brand profile from Instagram",
      description:
        "Reads the brand's connected Instagram (username, follower count, recent post captions) and drafts a full brand profile from it — same structured shape as draft_brand_profile. Requires a connected Instagram account. Returns a draft to review; it is NOT saved. Uses the workspace's BYO Claude key and spends its credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const signal = await instagram.profileSignal(brand_id);
        const content = [
          `Instagram: @${signal.username} (${signal.followersCount} followers)`,
          signal.captions.length
            ? `Recent post captions:\n- ${signal.captions.join("\n- ")}`
            : "No recent captions available.",
        ].join("\n");
        return json(
          await draftProfileFromSource(brand_id, {
            label: "the brand's Instagram profile and its recent post captions",
            content,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "refine_brand_field",
    {
      title: "Refine a brand profile field",
      description:
        "Rewrites one brand profile field in the brand's voice, anchored to the rest of the profile. Returns the revised text only — it is NOT saved. Spends the workspace's Claude credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        field: z
          .enum(["belief", "voice", "visual", "product", "audience"])
          .describe("Which profile field to refine"),
        current: z
          .string()
          .optional()
          .describe("Current draft text (may be empty to draft fresh)"),
        steer: z
          .string()
          .optional()
          .describe('Optional adjustment, e.g. "bolder", "shorter", "warmer"'),
      },
    },
    async ({ brand_id, field, current, steer }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await refineProfileField(brand_id, { field, current, steer }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "content_plan",
    {
      title: "Generate a content plan",
      description:
        "Drafts a ~2-week Instagram content plan for the brand, grounded in its brand profile and content pillars. Each item includes a content pillar, format (Reel/Carousel/Single/Story), suggested day offset (0–13), optional time, and a one-line hook. Returns a structured plan — nothing is persisted. Uses the workspace's BYO Claude key and spends its credits.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Optional context: upcoming events, launches, or desired cadence (e.g. '3×/week, product launch on day 7')",
          ),
      },
    },
    async ({ brand_id, note }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        return json(await generateContentPlan(brand_id, { note }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_review_queue",
    {
      title: "List posts awaiting review",
      description:
        "Returns posts in the brand's review queue (status in_review or changes_requested). Use approve_post to approve one.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
      },
    },
    async ({ brand_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const posts = await listReviewQueue(brand_id);
        return json({ posts });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "approve_post",
    {
      title: "Approve a post",
      description:
        "Approves a post that is in_review or changes_requested, transitioning it to scheduled so the worker will publish it at scheduled_at.",
      inputSchema: {
        brand_id: z.number().int().describe(BRAND_ID_DESC),
        post_id: z.number().int().describe("Post id to approve"),
      },
    },
    async ({ brand_id, post_id }) => {
      try {
        await assertBrandOwned(userId, brand_id);
        const post = await approvePost(brand_id, post_id);
        return json({ post });
      } catch (e) {
        if ((e as Error).message === "not_found") {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Error: post not found or cannot be approved",
              },
            ],
          };
        }
        return fail(e);
      }
    },
  );

  server.registerTool(
    "harness_info",
    {
      title: "Harness info",
      description: "Lists connectors and their configuration/capability status.",
      inputSchema: {},
    },
    async () =>
      json({
        name: "marketing-harness",
        version: "0.1.0",
        publicBaseUrl: env.publicBaseUrl,
        connectors: [
          {
            id: instagram.id,
            name: instagram.name,
            capabilities: instagram.capabilities,
            configured: instagram.isConfigured(),
          },
        ],
      }),
  );

  return server;
}

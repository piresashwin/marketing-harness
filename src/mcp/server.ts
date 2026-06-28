import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pool } from "../db/index.js";
import { instagram } from "../connectors/instagram/index.js";
import { generateCaption } from "../connectors/anthropic/index.js";
import { env } from "../config/env.js";

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
        "Publishes a single image post. Provide exactly one of url/path/base64. Returns the published media id and permalink.",
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

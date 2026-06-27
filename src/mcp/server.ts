import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { instagram } from "../connectors/instagram/index.js";
import { env } from "../config/env.js";

const USER_KEY_DESC =
  "Logical harness user this account belongs to. Use 'default' for a single-user setup.";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

const mediaShape = {
  url: z.string().url().optional().describe("Already-public media URL (used as-is)"),
  path: z.string().optional().describe("Local file path on the harness host"),
  base64: z.string().optional().describe("Base64-encoded bytes"),
  contentType: z.string().optional().describe("e.g. image/jpeg"),
};

/** Builds a fresh MCP server with all harness tools registered. */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "marketing-harness",
    version: "0.1.0",
  });

  server.registerTool(
    "ig_get_connect_url",
    {
      title: "Get Instagram connect URL",
      description:
        "Returns a URL the user opens in a browser to connect their Instagram Business/Creator account via OAuth.",
      inputSchema: {
        user_key: z.string().default("default").describe(USER_KEY_DESC),
      },
    },
    async ({ user_key }) => {
      try {
        const url = await instagram.getConnectUrl(user_key);
        return json({
          connect_url: url,
          instructions:
            "Open this URL in a browser, authorize, and you'll be redirected back to the harness.",
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "ig_connect_status",
    {
      title: "Instagram connection status",
      description:
        "Reports whether an Instagram account is connected for the given user, with username and token expiry.",
      inputSchema: {
        user_key: z.string().default("default").describe(USER_KEY_DESC),
      },
    },
    async ({ user_key }) => {
      try {
        return json(await instagram.status(user_key));
      } catch (e) {
        return fail((e as Error).message);
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
        user_key: z.string().default("default").describe(USER_KEY_DESC),
        caption: z.string().optional(),
        ...mediaShape,
      },
    },
    async ({ user_key, caption, url, path, base64, contentType }) => {
      try {
        const result = await instagram.publishImage(
          user_key,
          { url, path, base64, contentType },
          caption,
        );
        return json(result);
      } catch (e) {
        return fail((e as Error).message);
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
        user_key: z.string().default("default").describe(USER_KEY_DESC),
        caption: z.string().optional(),
        images: z
          .array(z.object(mediaShape))
          .min(2)
          .max(10)
          .describe("2–10 media items"),
      },
    },
    async ({ user_key, caption, images }) => {
      try {
        const result = await instagram.publishCarousel(user_key, images, caption);
        return json(result);
      } catch (e) {
        return fail((e as Error).message);
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

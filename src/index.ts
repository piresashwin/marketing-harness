import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/index.js";
import { mediaStore } from "./connectors/media/index.js";
import { startScheduler } from "./scheduler/worker.js";
import { createMcpServer } from "./mcp/server.js";
import { oauthRouter } from "./http/oauth.js";
import { oauthConsentRouter } from "./http/oauth-consent.js";
import { oauthProvider } from "./mcp/oauth/provider.js";
import { authRouter } from "./auth/routes.js";
import { apiRouter } from "./api/routes.js";
import { clientPortalRouter } from "./http/clientPortal.js";

async function main() {
  await runMigrations();
  await mediaStore.init();
  startScheduler();

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Auth (magic link), authenticated SPA API, and connector OAuth callbacks.
  app.use(authRouter);
  app.use("/api", apiRouter);
  app.use(oauthRouter);
  // Public client review portal — no auth, no session, token-gated per-post access.
  app.use(clientPortalRouter);

  // ── MCP OAuth 2.1 authorization server (the harness is its own AS) ────
  // Mounts /.well-known/oauth-authorization-server + protected-resource metadata,
  // /authorize, /token, /register, /revoke. The consent route binds the user.
  const mcpResourceUrl = new URL(`${env.publicBaseUrl}/mcp`);
  app.use(oauthConsentRouter);
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(env.publicBaseUrl),
      resourceServerUrl: mcpResourceUrl,
      scopesSupported: ["mcp"],
      resourceName: "inflxr",
    }),
  );

  // Serve local media when MEDIA_STORE=local.
  if (mediaStore.kind === "local") {
    const { LocalMediaStore } = await import("./connectors/media/local.js");
    app.use(
      "/media",
      express.static((mediaStore as InstanceType<typeof LocalMediaStore>).dir),
    );
  }

  // ── MCP over Streamable HTTP (stateless: one server per request) ──────
  // Protected by OAuth 2.1 bearer auth; the verified user id scopes the tools.
  const bearer = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl),
  });
  app.post("/mcp", bearer, async (req, res) => {
    const userId = req.auth!.extra!.userId as number;
    const server = createMcpServer(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp] request error:", e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });
  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless MCP)" },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // ── Serve the built SPA (prod). In dev, use the Vite server on :5173. ──
  const webDist = path.resolve("web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(
      /^(?!\/(api|auth|mcp|connectors|media|healthz|portal)).*/,
      (_req, res) => res.sendFile(path.join(webDist, "index.html")),
    );
  }

  app.listen(env.port, () => {
    console.log(`\n  inflxr listening on ${env.publicBaseUrl}`);
    console.log(`  • Web UI (dev):     ${env.appBaseUrl}`);
    console.log(`  • MCP endpoint:     POST ${env.publicBaseUrl}/mcp`);
    console.log(`  • Media store:      ${mediaStore.kind}`);
    console.log(
      `  • Email:            ${env.email.resendApiKey ? "Resend" : "console (no RESEND_API_KEY)"}`,
    );
    console.log(
      `  • Instagram app:    ${env.instagram.clientId ? "configured" : "NOT configured"}\n`,
    );
  });
}

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});

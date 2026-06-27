import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/index.js";
import { mediaStore } from "./connectors/media/index.js";
import { createMcpServer } from "./mcp/server.js";
import { oauthRouter } from "./http/oauth.js";
import { authRouter } from "./auth/routes.js";
import { apiRouter } from "./api/routes.js";

async function main() {
  await runMigrations();
  await mediaStore.init();

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Auth (magic link), authenticated SPA API, and connector OAuth callbacks.
  app.use(authRouter);
  app.use("/api", apiRouter);
  app.use(oauthRouter);

  // Serve local media when MEDIA_STORE=local.
  if (mediaStore.kind === "local") {
    const { LocalMediaStore } = await import("./connectors/media/local.js");
    app.use(
      "/media",
      express.static((mediaStore as InstanceType<typeof LocalMediaStore>).dir),
    );
  }

  // ── MCP over Streamable HTTP (stateless: one server per request) ──────
  app.post("/mcp", async (req, res) => {
    const server = createMcpServer();
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
      /^(?!\/(api|auth|mcp|connectors|media|healthz)).*/,
      (_req, res) => res.sendFile(path.join(webDist, "index.html")),
    );
  }

  app.listen(env.port, () => {
    console.log(`\n  marketing-harness listening on ${env.publicBaseUrl}`);
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

import { Router } from "express";
import { instagram } from "../connectors/instagram/index.js";

export const oauthRouter = Router();

// Convenience: open this in a browser to start the connect flow directly.
// (The MCP tool ig_get_connect_url returns the same URL for agent-driven use.)
oauthRouter.get("/connectors/instagram/connect", async (req, res) => {
  try {
    const userKey = String(req.query.user_key ?? "default");
    const url = await instagram.getConnectUrl(userKey);
    res.redirect(url);
  } catch (e) {
    res.status(500).send(`Connect error: ${(e as Error).message}`);
  }
});

oauthRouter.get("/connectors/instagram/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<
    string,
    string
  >;
  if (error) {
    res
      .status(400)
      .send(`Instagram authorization failed: ${error_description ?? error}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }
  try {
    const result = await instagram.handleCallback(code, state);
    res.send(
      `<html><body style="font-family:system-ui;padding:2rem">
         <h2>✅ Instagram connected</h2>
         <p>Account <b>@${result.username}</b> (id ${result.igUserId}) is now linked to user
         <code>${result.userKey}</code>. You can close this tab and publish from your MCP client.</p>
       </body></html>`,
    );
  } catch (e) {
    res.status(500).send(`Callback error: ${(e as Error).message}`);
  }
});

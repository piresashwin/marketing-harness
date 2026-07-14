import { Router } from "express";
import { instagram } from "../connectors/instagram/index.js";

export const oauthRouter = Router();

// NOTE: the old public `GET /connectors/instagram/connect?user_key=...` route
// was removed in the brand-scope cutover — it let anyone mint an OAuth state for
// an arbitrary key. The connect URL now comes only from the authenticated,
// ownership-checked `/api/brands/:brandId/connectors/instagram/connect-url`.
//
// The callback stays public (Instagram redirects the browser here) but takes no
// user-controlled identity: it resolves the brand from oauth_states.state alone.
oauthRouter.get("/connectors/instagram/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  if (error) {
    // Map the provider error code to a fixed message — never echo the
    // provider-supplied error_description (token/PII echo + reflected content).
    const msg =
      error === "access_denied"
        ? "Authorization was declined."
        : "Could not connect Instagram.";
    res.status(400).send(msg);
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
         <p>Account <b>@${result.username}</b> (id ${result.igUserId}) is now linked.
         You can close this tab and return to Inflxr.</p>
       </body></html>`,
    );
  } catch (e) {
    // Never surface raw error text (it may contain the token). Log the name only.
    console.error("[ig-callback]", (e as Error).name);
    res.status(500).send("Could not connect Instagram. Please try again.");
  }
});

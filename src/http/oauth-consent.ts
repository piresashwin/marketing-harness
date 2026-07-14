import { Router, urlencoded } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "../db/index.js";
import { loadUser } from "../auth/session.js";
import { sha256, randomToken } from "../mcp/oauth/crypto.js";

// MCP OAuth consent UI. The SDK's authorize handler has no session; it stashes a
// pending request and redirects here. This route binds the LOGGED-IN harness user
// to the grant.
//
// CSRF: the `req` id is NOT secret (the AS hands it to the client in the redirect)
// and SameSite=Lax doesn't block a top-level cross-site form POST. So we issue a
// per-request CSRF token at consent-GET time, bound to the loading session
// (consent_user_id) and stored hash-only. The approving POST must (a) come from
// that same session and (b) present the raw CSRF token — which is rendered only
// into that one page. A blind cross-site POST can satisfy neither.

export const oauthConsentRouter = Router();

const AUTH_CODE_TTL_MS = 2 * 60 * 1000; // 2m

interface PendingRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  state: string | null;
  resource: string | null;
  expires_at: Date;
  csrf_token_hash: string | null;
  consent_user_id: number | null;
}

async function loadPending(id: string): Promise<PendingRow | null> {
  const { rows } = await pool.query<PendingRow>(
    `SELECT id, client_id, redirect_uri, code_challenge, scopes, state, resource,
            expires_at, csrf_token_hash, consent_user_id
       FROM oauth_authorization_requests WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || row.expires_at.getTime() < Date.now()) return null;
  return row;
}

/** Constant-time compare of a presented CSRF token against the stored hash. */
function csrfMatches(presented: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(sha256(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false; // guard before timingSafeEqual
  return timingSafeEqual(a, b);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorize</title></head>
    <body style="font-family:system-ui;max-width:440px;margin:48px auto;padding:0 16px">${body}</body></html>`;
}

oauthConsentRouter.get("/oauth/consent", async (req, res) => {
  const id = String(req.query.req ?? "");
  const pending = id ? await loadPending(id) : null;
  if (!pending) {
    res.status(400).send(page("<h2>This authorization request is invalid or expired.</h2>"));
    return;
  }

  const user = await loadUser(req);
  if (!user) {
    // DEFERRED POLISH: return-after-login. For now, instruct the user to sign in
    // in this browser and retry the client's connect action.
    res
      .status(401)
      .send(
        page(
          `<h2>Sign in required</h2><p>Please sign in to Inflxr in this browser, then retry connecting from your MCP client.</p>`,
        ),
      );
    return;
  }

  // Issue a fresh CSRF token bound to this session + request (hash stored).
  const csrf = randomToken(32);
  await pool.query(
    "UPDATE oauth_authorization_requests SET csrf_token_hash = $1, consent_user_id = $2 WHERE id = $3",
    [sha256(csrf), user.id, pending.id],
  );

  const { rows } = await pool.query<{ client_name: string | null }>(
    "SELECT client_name FROM oauth_clients WHERE client_id = $1",
    [pending.client_id],
  );
  const clientName = rows[0]?.client_name || "An MCP client";
  const scopeList = pending.scopes.length
    ? pending.scopes.map(esc).join(", ")
    : "(none)";
  // Show where the code will be sent so the user can spot a rogue redirect host.
  const redirectHost = new URL(pending.redirect_uri).host;

  res.send(
    page(`
      <h2>Authorize ${esc(clientName)}</h2>
      <p><b>${esc(clientName)}</b> wants to access your Inflxr account
         (signed in as ${esc(user.email)}).</p>
      <p>Scopes: ${scopeList}</p>
      <p>Codes will be sent to: <b>${esc(redirectHost)}</b></p>
      <form method="POST" action="/oauth/consent" style="display:flex;gap:12px;margin-top:24px">
        <input type="hidden" name="req" value="${esc(pending.id)}" />
        <input type="hidden" name="csrf" value="${esc(csrf)}" />
        <button name="decision" value="approve"
          style="background:#4f46e5;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer">Approve</button>
        <button name="decision" value="deny"
          style="background:#e2e8f0;color:#334155;border:0;padding:10px 18px;border-radius:8px;cursor:pointer">Deny</button>
      </form>`),
  );
});

oauthConsentRouter.post("/oauth/consent", urlencoded({ extended: false }), async (req, res) => {
  const user = await loadUser(req);
  if (!user) {
    res.status(401).send(page("<h2>Sign in required.</h2>"));
    return;
  }
  const id = String(req.body?.req ?? "");
  const decision = String(req.body?.decision ?? "");
  const presentedCsrf = String(req.body?.csrf ?? "");
  const pending = id ? await loadPending(id) : null;
  if (!pending) {
    res.status(400).send(page("<h2>This authorization request is invalid or expired.</h2>"));
    return;
  }

  // CSRF + session binding: the approving POST must come from the same session
  // that loaded the consent page AND present that page's unguessable CSRF token.
  if (
    pending.consent_user_id !== user.id ||
    !csrfMatches(presentedCsrf, pending.csrf_token_hash)
  ) {
    res.status(403).send(page("<h2>Authorization request could not be verified.</h2>"));
    return;
  }

  const redirect = new URL(pending.redirect_uri);
  if (pending.state) redirect.searchParams.set("state", pending.state);

  if (decision !== "approve") {
    // Consume the pending request and bounce back with an error.
    await pool.query("DELETE FROM oauth_authorization_requests WHERE id = $1", [id]);
    redirect.searchParams.set("error", "access_denied");
    res.redirect(redirect.toString());
    return;
  }

  // Mint an authorization code bound to this user + the pending PKCE/redirect/scopes.
  const code = randomToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS);
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query(
      `INSERT INTO oauth_auth_codes
         (code_hash, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        sha256(code),
        pending.client_id,
        user.id,
        pending.code_challenge,
        pending.redirect_uri,
        JSON.stringify(pending.scopes),
        pending.resource,
        expiresAt,
      ],
    );
    await conn.query("DELETE FROM oauth_authorization_requests WHERE id = $1", [id]);
    await conn.query("COMMIT");
  } catch {
    await conn.query("ROLLBACK");
    res.status(500).send(page("<h2>Could not complete authorization.</h2>"));
    return;
  } finally {
    conn.release();
  }

  redirect.searchParams.set("code", code);
  res.redirect(redirect.toString());
});

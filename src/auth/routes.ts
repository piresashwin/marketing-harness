import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { env } from "../config/env.js";
import { createMagicToken, consumeMagicToken } from "./magicLink.js";
import { createSession, clearSession } from "./session.js";
import { sendMagicLinkEmail } from "../email/resend.js";

export const authRouter = Router();

const emailSchema = z.object({ email: z.string().email() });

/** Request a magic link. Works for both new and existing emails (no registration). */
authRouter.post("/auth/request", async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  try {
    const token = await createMagicToken(email);
    const link = `${env.publicBaseUrl}/auth/verify?token=${token}`;
    const result = await sendMagicLinkEmail(email, link);
    res.json({ ok: true, delivered: result.delivered, devLink: result.devLink });
  } catch (e) {
    console.error("[auth] request error:", (e as Error).name);
    res.status(500).json({ error: "Couldn't send the sign-in link." });
  }
});

/** Verify a magic link: create-or-find user, start session, redirect into the app. */
authRouter.get("/auth/verify", async (req, res) => {
  const token = String(req.query.token ?? "");
  const email = token ? await consumeMagicToken(token) : undefined;
  if (!email) {
    res.redirect(`${env.appBaseUrl}/login?error=invalid_or_expired`);
    return;
  }
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      id: number;
      onboarding_completed: boolean;
      created: boolean;
    }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, onboarding_completed, (xmax = 0) AS created`,
      [email],
    );
    const user = rows[0];
    await client.query(
      "INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [user.id],
    );

    // New user: provision a workspace + owner membership + active workspace.
    // (No brand here — onboarding creates the first brand.) Existing users keep
    // the workspace they already have from the Phase 1 backfill.
    if (user.created) {
      await client.query("BEGIN");
      try {
        const localPart = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
        const ws = await client.query<{ id: number }>(
          "INSERT INTO workspaces (name, owner_user_id) VALUES ($1, $2) RETURNING id",
          [`${localPart}'s Workspace`, user.id],
        );
        const workspaceId = ws.rows[0].id;
        await client.query(
          "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [workspaceId, user.id],
        );
        await client.query(
          `INSERT INTO user_settings (user_id, active_workspace_id, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now()`,
          [user.id, workspaceId],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    await createSession(res, user.id);
    // The SPA resolves where to land from brand state (0 brands → welcome,
    // otherwise the brand home) — no user-level onboarding gate.
    res.redirect(`${env.appBaseUrl}/`);
  } catch (e) {
    console.error("[auth] verify error:", (e as Error).name);
    res.status(500).send("Sign-in failed.");
  } finally {
    client.release();
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  await clearSession(req, res);
  res.json({ ok: true });
});

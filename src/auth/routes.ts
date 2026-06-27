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
    res.status(500).json({ error: (e as Error).message });
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
  try {
    const { rows } = await pool.query<{
      id: number;
      onboarding_completed: boolean;
    }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, onboarding_completed`,
      [email],
    );
    const user = rows[0];
    await pool.query(
      "INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [user.id],
    );
    await createSession(res, user.id);
    res.redirect(
      `${env.appBaseUrl}${user.onboarding_completed ? "/dashboard" : "/onboarding"}`,
    );
  } catch (e) {
    res.status(500).send(`Sign-in error: ${(e as Error).message}`);
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  await clearSession(req, res);
  res.json({ ok: true });
});

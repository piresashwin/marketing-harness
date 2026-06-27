import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { requireAuth, userKey, type AuthedRequest } from "../auth/session.js";
import { instagram } from "../connectors/instagram/index.js";

export const apiRouter = Router();
apiRouter.use(requireAuth());

/** Current user + onboarding profile. */
apiRouter.get("/me", async (req: AuthedRequest, res) => {
  const user = req.user!;
  const { rows } = await pool.query<{ data: unknown }>(
    "SELECT data FROM profiles WHERE user_id = $1",
    [user.id],
  );
  res.json({
    user: {
      id: user.id,
      email: user.email,
      onboardingCompleted: user.onboarding_completed,
    },
    profile: rows[0]?.data ?? {},
  });
});

const onboardingSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  brandName: z.string().max(120).optional(),
  website: z.string().max(300).optional(),
  industry: z.string().max(120).optional(),
  audience: z.string().max(2000).optional(),
  brandVoice: z.array(z.string()).max(12).optional(),
  goals: z.string().max(2000).optional(),
  platforms: z.array(z.string()).max(12).optional(),
  cadence: z.string().max(60).optional(),
});

/** Save onboarding answers and mark onboarding complete. */
apiRouter.post("/onboarding", async (req: AuthedRequest, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const user = req.user!;
  await pool.query(
    `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [user.id, JSON.stringify(parsed.data)],
  );
  await pool.query(
    "UPDATE users SET onboarding_completed = true WHERE id = $1",
    [user.id],
  );
  res.json({ ok: true });
});

// ── Instagram connector (scoped to the signed-in user) ──────────────────
apiRouter.get("/connectors/instagram/status", async (req: AuthedRequest, res) => {
  try {
    res.json(await instagram.status(userKey(req.user!)));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

apiRouter.get("/connectors/instagram/connect-url", async (req: AuthedRequest, res) => {
  try {
    const url = await instagram.getConnectUrl(userKey(req.user!));
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

const publishSchema = z.object({
  caption: z.string().max(2200).optional(),
  imageBase64: z.string().min(1),
  contentType: z.string().default("image/jpeg"),
});

apiRouter.post("/connectors/instagram/publish", async (req: AuthedRequest, res) => {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "imageBase64 required" });
    return;
  }
  try {
    const result = await instagram.publishImage(
      userKey(req.user!),
      { base64: parsed.data.imageBase64, contentType: parsed.data.contentType },
      parsed.data.caption,
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * AI caption assist — placeholder until the LLM connector (Slice 3) lands.
 * Returns 501 so the UI can surface "connect an AI provider" cleanly.
 */
apiRouter.post("/ai/caption", async (_req, res) => {
  res.status(501).json({
    error: "AI caption assist needs an LLM connector. Coming in the AI slice.",
  });
});

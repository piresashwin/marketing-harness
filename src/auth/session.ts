import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/index.js";
import { env } from "../config/env.js";

const COOKIE = "mh_session";
const TTL_DAYS = 30;

export interface SessionUser {
  id: number;
  email: string;
  onboarding_completed: boolean;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

/** Logical key used by connectors to scope per-user data. */
export function userKey(user: { id: number }): string {
  return `user:${user.id}`;
}

export async function createSession(res: Response, userId: number): Promise<void> {
  const id = randomUUID();
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await pool.query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
    [id, userId, expires],
  );
  res.cookie(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    expires,
  });
}

export async function clearSession(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.cookies?.[COOKIE];
  if (id) await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  res.clearCookie(COOKIE, { path: "/" });
}

export async function loadUser(req: Request): Promise<SessionUser | null> {
  const id = req.cookies?.[COOKIE];
  if (!id) return null;
  const { rows } = await pool.query<SessionUser>(
    `SELECT u.id, u.email, u.onboarding_completed
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  return rows[0] ?? null;
}

export function requireAuth() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = await loadUser(req);
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.user = user;
    next();
  };
}

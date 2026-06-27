import { randomBytes } from "node:crypto";
import { pool } from "../db/index.js";

const TTL_MINUTES = 15;

export async function createMagicToken(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TTL_MINUTES * 60_000);
  await pool.query(
    "INSERT INTO magic_link_tokens (token, email, expires_at) VALUES ($1, $2, $3)",
    [token, email, expires],
  );
  return token;
}

/** Atomically marks a valid token used and returns its email, or undefined. */
export async function consumeMagicToken(
  token: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ email: string }>(
    `UPDATE magic_link_tokens SET used = true
     WHERE token = $1 AND used = false AND expires_at > now()
     RETURNING email`,
    [token],
  );
  return rows[0]?.email;
}

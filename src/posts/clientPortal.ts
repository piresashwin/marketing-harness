/**
 * Public client review portal — token issuance and token-gated data access.
 *
 * Security model:
 *   - Tokens are 32-byte random hex strings. Only the SHA-256 hex hash is stored.
 *   - A token resolves to EXACTLY ONE post + brand — never to a broad scope.
 *   - post_id + brand_id come FROM the token row; never from client input.
 *   - The public view returns only the minimal set of fields needed by the client.
 *   - Client comments carry NO user id and NO email (visibility='client',
 *     author_label='Client', author_user_id=NULL).
 */

import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db/index.js";
import type { PostComment } from "./review.js";

const TOKEN_TTL_DAYS = 14;

function sha256hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Token management ───────────────────────────────────────────────────────

/**
 * Create a review token for a single post.
 * Verifies the post belongs to the brand, then stores only the hash.
 * Returns the RAW token (include in the link URL — never stored).
 */
export async function createReviewToken(
  brandId: number,
  postId: number,
): Promise<string> {
  // Verify post belongs to brand before issuing a token for it.
  const check = await pool.query(
    "SELECT 1 FROM posts WHERE id = $1 AND brand_id = $2",
    [postId, brandId],
  );
  if (!check.rowCount) throw new Error("not_found");

  const raw = randomBytes(32).toString("hex");
  const hash = sha256hex(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);

  await pool.query(
    `INSERT INTO review_tokens (token_hash, post_id, brand_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hash, postId, brandId, expiresAt],
  );

  return raw;
}

/** Result when a valid token is resolved. */
export interface ResolvedToken {
  postId: number;
  brandId: number;
}

/**
 * Resolve a raw review token to its post + brand.
 * Hashes the incoming value and looks up by hash.
 * Returns null for any invalid, expired, or revoked token (uniform 404 surface).
 */
export async function resolveReviewToken(
  rawToken: string,
): Promise<ResolvedToken | null> {
  const hash = sha256hex(rawToken);
  const { rows } = await pool.query<{ post_id: string; brand_id: string }>(
    `SELECT post_id, brand_id
       FROM review_tokens
      WHERE token_hash = $1
        AND revoked = false
        AND expires_at > now()`,
    [hash],
  );
  if (!rows[0]) return null;
  return {
    postId: Number(rows[0].post_id),
    brandId: Number(rows[0].brand_id),
  };
}

// ── Client-scoped data access ──────────────────────────────────────────────

/** The minimal post shape exposed to unauthenticated clients. */
export interface ClientReviewView {
  caption: string | null;
  mediaUrls: string[];
  mediaType: string;
  scheduledAt: string | null;
  status: string;
  comments: ClientComment[];
}

/** A client-visible comment — no author identity, no internal fields. */
export interface ClientComment {
  id: string;
  authorLabel: string;
  body: string;
  createdAt: string;
}

/**
 * Return the client-safe view of a post and its client-visible comments.
 * Both queries carry brand_id + post_id — no cross-tenant leakage.
 * NEVER returns: author_user_id, internal comments, tokens, brand settings.
 */
export async function getClientReviewView(
  brandId: number,
  postId: number,
): Promise<ClientReviewView | null> {
  const [postRes, commentsRes] = await Promise.all([
    pool.query<{
      caption: string | null;
      media_urls: string[];
      media_type: string;
      scheduled_at: Date | null;
      status: string;
    }>(
      `SELECT caption, media_urls, media_type, scheduled_at, status
         FROM posts
        WHERE id = $1 AND brand_id = $2`,
      [postId, brandId],
    ),
    pool.query<{
      id: unknown;
      author_label: string;
      body: string;
      created_at: Date;
    }>(
      `SELECT id, author_label, body, created_at
         FROM post_comments
        WHERE post_id = $1
          AND brand_id = $2
          AND visibility = 'client'
        ORDER BY created_at ASC, id ASC`,
      [postId, brandId],
    ),
  ]);

  if (!postRes.rows[0]) return null;
  const p = postRes.rows[0];

  return {
    caption: p.caption,
    mediaUrls: p.media_urls,
    mediaType: p.media_type,
    scheduledAt: p.scheduled_at?.toISOString() ?? null,
    status: p.status,
    comments: commentsRes.rows.map((c) => ({
      id: String(c.id),
      authorLabel: c.author_label,
      body: c.body,
      createdAt: c.created_at.toISOString(),
    })),
  };
}

// ── Re-export review service functions for use in the public router ────────
// We import from review.ts so all status guards live in one place.
export { approvePost, requestChanges, addComment } from "./review.js";
export type { PostComment };

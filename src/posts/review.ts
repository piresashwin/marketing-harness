/**
 * Approval workflow for scheduled posts.
 *
 * Status machine (plain text, no DB enum):
 *   pending / changes_requested / in_review  →  not publishable by the worker
 *   scheduled                               →  worker picks it up at scheduled_at
 *   publishing / published / failed         →  terminal / in-flight
 *
 * Every function carries brand_id + post_id in its WHERE clause — never trusts
 * a bare post id. Throws safe enumerated strings that callers map to HTTP status.
 */

import { pool } from "../db/index.js";

// ── Shared shapes ──────────────────────────────────────────────────────────

export interface ReviewPost {
  id: string;
  caption: string | null;
  mediaUrls: string[];
  mediaType: string;
  scheduledAt: string | null;
  status: string;
  createdAt: string;
}

export interface PostComment {
  id: string;
  postId: string;
  authorUserId: string | null;
  authorLabel: string;
  visibility: string;
  body: string;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mapPost(r: {
  id: unknown;
  caption: string | null;
  media_urls: string[];
  media_type: string;
  scheduled_at: Date | null;
  status: string;
  created_at: Date;
}): ReviewPost {
  return {
    id: String(r.id),
    caption: r.caption,
    mediaUrls: r.media_urls,
    mediaType: r.media_type,
    scheduledAt: r.scheduled_at?.toISOString() ?? null,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function mapComment(r: {
  id: unknown;
  post_id: unknown;
  author_user_id: unknown | null;
  author_label: string;
  visibility: string;
  body: string;
  created_at: Date;
}): PostComment {
  return {
    id: String(r.id),
    postId: String(r.post_id),
    authorUserId: r.author_user_id != null ? String(r.author_user_id) : null,
    authorLabel: r.author_label,
    visibility: r.visibility,
    body: r.body,
    createdAt: r.created_at.toISOString(),
  };
}

// ── Service functions ──────────────────────────────────────────────────────

/**
 * Submit a post for internal review.
 * Valid source statuses: 'scheduled' | 'changes_requested'
 * Throws "not_found" when the post doesn't exist or is already in a
 * non-submittable state (published, publishing, in_review, failed).
 */
export async function submitForReview(
  brandId: number,
  postId: number,
): Promise<ReviewPost> {
  const { rows } = await pool.query<{
    id: unknown;
    caption: string | null;
    media_urls: string[];
    media_type: string;
    scheduled_at: Date | null;
    status: string;
    created_at: Date;
  }>(
    `UPDATE posts
        SET status = 'in_review'
      WHERE id = $1
        AND brand_id = $2
        AND status IN ('scheduled', 'changes_requested')
      RETURNING id, caption, media_urls, media_type, scheduled_at, status, created_at`,
    [postId, brandId],
  );
  if (!rows[0]) throw new Error("not_found");
  return mapPost(rows[0]);
}

/**
 * Approve a post — transitions it to 'scheduled' so the worker can pick it up.
 * Valid source statuses: 'in_review' | 'changes_requested'
 */
export async function approvePost(
  brandId: number,
  postId: number,
): Promise<ReviewPost> {
  const { rows } = await pool.query<{
    id: unknown;
    caption: string | null;
    media_urls: string[];
    media_type: string;
    scheduled_at: Date | null;
    status: string;
    created_at: Date;
  }>(
    `UPDATE posts
        SET status = 'scheduled'
      WHERE id = $1
        AND brand_id = $2
        AND status IN ('in_review', 'changes_requested')
      RETURNING id, caption, media_urls, media_type, scheduled_at, status, created_at`,
    [postId, brandId],
  );
  if (!rows[0]) throw new Error("not_found");
  return mapPost(rows[0]);
}

/**
 * Request changes on a post — sets status to 'changes_requested' AND inserts
 * a comment in one logical operation.
 * Valid source statuses: 'in_review' | 'changes_requested'
 *
 * visibility defaults to 'internal'; pass 'client' for the public portal.
 */
export async function requestChanges(
  brandId: number,
  postId: number,
  comment: {
    authorUserId: number | null;
    authorLabel: string;
    body: string;
    visibility?: "internal" | "client";
  },
): Promise<{ post: ReviewPost; comment: PostComment }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const postRes = await client.query<{
      id: unknown;
      caption: string | null;
      media_urls: string[];
      media_type: string;
      scheduled_at: Date | null;
      status: string;
      created_at: Date;
    }>(
      `UPDATE posts
          SET status = 'changes_requested'
        WHERE id = $1
          AND brand_id = $2
          AND status IN ('in_review', 'changes_requested')
        RETURNING id, caption, media_urls, media_type, scheduled_at, status, created_at`,
      [postId, brandId],
    );
    if (!postRes.rows[0]) {
      await client.query("ROLLBACK");
      throw new Error("not_found");
    }

    const commentRes = await client.query<{
      id: unknown;
      post_id: unknown;
      author_user_id: unknown | null;
      author_label: string;
      visibility: string;
      body: string;
      created_at: Date;
    }>(
      `INSERT INTO post_comments (post_id, brand_id, author_user_id, author_label, visibility, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, post_id, author_user_id, author_label, visibility, body, created_at`,
      [postId, brandId, comment.authorUserId, comment.authorLabel, comment.visibility ?? "internal", comment.body],
    );

    await client.query("COMMIT");
    return {
      post: mapPost(postRes.rows[0]),
      comment: mapComment(commentRes.rows[0]),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Add a standalone comment to a post.
 * visibility defaults to 'internal'; pass 'client' for the public portal.
 * The post must belong to the brand.
 */
export async function addComment(
  brandId: number,
  postId: number,
  comment: {
    authorUserId: number | null;
    authorLabel: string;
    body: string;
    visibility?: "internal" | "client";
  },
): Promise<PostComment> {
  const vis = comment.visibility ?? "internal";
  const { rows } = await pool.query<{
    id: unknown;
    post_id: unknown;
    author_user_id: unknown | null;
    author_label: string;
    visibility: string;
    body: string;
    created_at: Date;
  }>(
    `INSERT INTO post_comments (post_id, brand_id, author_user_id, author_label, visibility, body)
     SELECT $1, $2, $3, $4, $5, $6
      WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1 AND brand_id = $2)
     RETURNING id, post_id, author_user_id, author_label, visibility, body, created_at`,
    [postId, brandId, comment.authorUserId ?? null, comment.authorLabel, vis, comment.body],
  );
  if (!rows[0]) throw new Error("not_found");
  return mapComment(rows[0]);
}

/**
 * List comments for a post, oldest first.
 * The post must belong to this brand.
 */
export async function listComments(
  brandId: number,
  postId: number,
): Promise<PostComment[]> {
  // Verify post belongs to brand.
  const check = await pool.query(
    "SELECT 1 FROM posts WHERE id = $1 AND brand_id = $2",
    [postId, brandId],
  );
  if (!check.rowCount) throw new Error("not_found");

  const { rows } = await pool.query<{
    id: unknown;
    post_id: unknown;
    author_user_id: unknown | null;
    author_label: string;
    visibility: string;
    body: string;
    created_at: Date;
  }>(
    `SELECT id, post_id, author_user_id, author_label, visibility, body, created_at
       FROM post_comments
      WHERE post_id = $1 AND brand_id = $2
      ORDER BY created_at ASC, id ASC`,
    [postId, brandId],
  );
  return rows.map(mapComment);
}

/**
 * List all posts in the review queue for a brand (in_review or changes_requested),
 * ordered by scheduled_at asc nulls last.
 */
export async function listReviewQueue(brandId: number): Promise<ReviewPost[]> {
  const { rows } = await pool.query<{
    id: unknown;
    caption: string | null;
    media_urls: string[];
    media_type: string;
    scheduled_at: Date | null;
    status: string;
    created_at: Date;
  }>(
    `SELECT id, caption, media_urls, media_type, scheduled_at, status, created_at
       FROM posts
      WHERE brand_id = $1
        AND status IN ('in_review', 'changes_requested')
      ORDER BY scheduled_at ASC NULLS LAST, id ASC`,
    [brandId],
  );
  return rows.map(mapPost);
}

/**
 * Public client review portal router.
 *
 * Mounted at the app root (NOT under /api) so it does NOT inherit requireAuth.
 * Creates NO session and sets NO auth cookie.
 * All actions are gated solely on a valid review token — the token resolves
 * post_id + brand_id server-side; those values never come from the client body.
 */

import { Router } from "express";
import { z } from "zod";
import {
  resolveReviewToken,
  getClientReviewView,
  approvePost,
  requestChanges,
  addComment,
} from "../posts/clientPortal.js";

export const clientPortalRouter = Router();

// Shared Zod schemas for public write actions.
const bodySchema = z.object({ body: z.string().min(1).max(5000) });

/**
 * Resolve the token from the URL param and attach the resolved ids to the
 * request. Returns 404 (uniform) for any invalid/expired/revoked token.
 * Never echoes the token value in any response.
 */
async function resolveToken(
  req: import("express").Request,
  res: import("express").Response,
): Promise<{ postId: number; brandId: number } | null> {
  const raw = req.params.token ?? "";
  if (!raw) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  const resolved = await resolveReviewToken(raw);
  if (!resolved) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return resolved;
}

// GET /portal/review/:token — minimal client-safe post view
clientPortalRouter.get("/portal/review/:token", async (req, res) => {
  const ids = await resolveToken(req, res);
  if (!ids) return;

  const view = await getClientReviewView(ids.brandId, ids.postId);
  if (!view) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(view);
});

// POST /portal/review/:token/approve — approve the post
clientPortalRouter.post("/portal/review/:token/approve", async (req, res) => {
  const ids = await resolveToken(req, res);
  if (!ids) return;

  try {
    const post = await approvePost(ids.brandId, ids.postId);
    res.json({ status: post.status });
  } catch (e) {
    if ((e as Error).message === "not_found") {
      res.status(409).json({ error: "post_not_actionable" });
      return;
    }
    res.status(500).json({ error: "could not approve post" });
  }
});

// POST /portal/review/:token/request-changes — flag changes with a client comment
clientPortalRouter.post(
  "/portal/review/:token/request-changes",
  async (req, res) => {
    const ids = await resolveToken(req, res);
    if (!ids) return;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "body is required (max 5000 chars)" });
      return;
    }

    try {
      const result = await requestChanges(ids.brandId, ids.postId, {
        authorUserId: null,
        authorLabel: "Client",
        body: parsed.data.body,
        visibility: "client",
      });
      res.json({ status: result.post.status });
    } catch (e) {
      if ((e as Error).message === "not_found") {
        res.status(409).json({ error: "post_not_actionable" });
        return;
      }
      res.status(500).json({ error: "could not request changes" });
    }
  },
);

// POST /portal/review/:token/comment — add a client-visible comment
clientPortalRouter.post("/portal/review/:token/comment", async (req, res) => {
  const ids = await resolveToken(req, res);
  if (!ids) return;

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "body is required (max 5000 chars)" });
    return;
  }

  try {
    const comment = await addComment(ids.brandId, ids.postId, {
      authorUserId: null,
      authorLabel: "Client",
      body: parsed.data.body,
      visibility: "client",
    });
    res.status(201).json({
      comment: {
        id: comment.id,
        authorLabel: comment.authorLabel,
        body: comment.body,
        createdAt: comment.createdAt,
      },
    });
  } catch (e) {
    if ((e as Error).message === "not_found") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(500).json({ error: "could not add comment" });
  }
});

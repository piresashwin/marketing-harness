// Internal review surface for a single post.
// Route: /posts/:postId/review?brandId=<id>  (behind requireApp)
//
// Shows:
//   - Status stepper (In Review → Changes Requested → Scheduled/Published)
//   - Post preview card
//   - Internal comment thread
//   - Approve / Request-changes actions

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  ClipboardCheck,
  Copy,
  ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  XCircle,
} from "lucide-react";
import { api, type PostComment, type ReviewPost } from "../api";
import { AppShell } from "../components/AppShell";
import { Button, Card, Textarea } from "../components/ui";

// ── Status stepper ────────────────────────────────────────────────────────

const STEPS = [
  { key: "pending", label: "Draft" },
  { key: "in_review", label: "In Review" },
  { key: "changes_requested", label: "Changes" },
  { key: "scheduled", label: "Approved" },
  { key: "published", label: "Published" },
] as const;

function stepIndex(status: string): number {
  // Map the status to where it sits in the linear visual flow. For statuses
  // not on the happy path (e.g. 'failed') fall back to -1 so none is filled.
  const map: Record<string, number> = {
    pending: 0,
    in_review: 1,
    changes_requested: 2,
    scheduled: 3,
    publishing: 3,
    published: 4,
  };
  return map[status] ?? -1;
}

function StatusStepper({ status }: { status: string }) {
  const active = stepIndex(status);
  return (
    <nav aria-label="Post status" className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        const isChanges = step.key === "changes_requested";
        // Show the changes step only if it is active, otherwise suppress it
        // to keep the happy-path stepper tidy.
        if (isChanges && status !== "changes_requested") return null;
        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <div
                className={`h-px w-8 ${done || current ? "bg-brand-600" : "bg-line"}`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ${
                  done
                    ? "bg-brand-600 text-white"
                    : current
                      ? "border-2 border-brand-600 bg-surface text-brand-600"
                      : "border border-line bg-hover text-faint"
                }`}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  String(i + 1)
                )}
              </span>
              <span
                className={`text-xs ${current ? "font-semibold text-ink" : "text-faint"}`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// ── Post preview ──────────────────────────────────────────────────────────

function PostPreview({ post }: { post: ReviewPost }) {
  const thumb = post.mediaUrls[0];
  return (
    <Card className="overflow-hidden">
      {/* Mock phone chrome */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-hover">
          <ImageIcon className="h-4 w-4 text-faint" aria-hidden />
        </div>
        <span className="text-xs font-semibold text-ink">Instagram preview</span>
      </div>
      {/* Image */}
      <div className="aspect-square max-h-80 w-full overflow-hidden bg-hover">
        {thumb ? (
          <img
            src={thumb}
            alt="Post media"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-12 w-12 text-faint" aria-hidden />
          </div>
        )}
      </div>
      {/* Caption */}
      {post.caption && (
        <div className="border-t border-line px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-ink">{post.caption}</p>
        </div>
      )}
      {/* Meta */}
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3 text-xs text-faint">
        <span>{post.mediaType}</span>
        {post.scheduledAt && (
          <span>
            Scheduled{" "}
            {new Date(post.scheduledAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </Card>
  );
}

// ── Comment thread ─────────────────────────────────────────────────────────

function CommentThread({
  comments,
  loading,
}: {
  comments: PostComment[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-faint">
        <Loader2
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      </div>
    );
  }
  if (comments.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-faint">No comments yet.</p>
    );
  }
  return (
    <ul className="space-y-3">
      {comments.map((c) => (
        <li key={c.id} className="rounded-xl border border-line bg-elevated p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-ink">
              {c.authorLabel}
            </span>
            <span className="text-xs text-faint">
              {new Date(c.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-ink">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function Review() {
  const { postId } = useParams<{ postId: string }>();
  const [searchParams] = useSearchParams();
  const brandId = searchParams.get("brandId") ?? "";
  const navigate = useNavigate();

  const [post, setPost] = useState<ReviewPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loadingPost, setLoadingPost] = useState(true);
  const [loadingComments, setLoadingComments] = useState(true);
  const [postError, setPostError] = useState(false);

  const [commentBody, setCommentBody] = useState("");
  const [changesBody, setChangesBody] = useState("");
  const [showChangesInput, setShowChangesInput] = useState(false);

  const [actionBusy, setActionBusy] = useState<
    "approve" | "changes" | "comment" | "link" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const commentEndRef = useRef<HTMLDivElement>(null);

  const loadPost = useCallback(async () => {
    if (!postId || !brandId) return;
    setLoadingPost(true);
    setPostError(false);
    try {
      // Fetch via listReviewQueue — we need the full ReviewPost shape and we
      // know it must be in the review queue for this page to be meaningful.
      // Fall back to a generic posts fetch is intentionally avoided: if the
      // post is already published it will not be in the queue and we redirect.
      const queue = await api.listReviewQueue(brandId);
      const found = queue.find((p) => p.id === postId) ?? null;
      setPost(found);
    } catch {
      setPostError(true);
    } finally {
      setLoadingPost(false);
    }
  }, [postId, brandId]);

  const loadComments = useCallback(async () => {
    if (!postId || !brandId) return;
    setLoadingComments(true);
    try {
      const data = await api.listComments(brandId, postId);
      setComments(data);
    } catch {
      // Non-fatal — comments are supplementary.
    } finally {
      setLoadingComments(false);
    }
  }, [postId, brandId]);

  useEffect(() => {
    void loadPost();
    void loadComments();
  }, [loadPost, loadComments]);

  // Scroll to bottom when new comments arrive.
  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const handleApprove = async () => {
    if (!postId || !brandId) return;
    setActionBusy("approve");
    setActionError(null);
    try {
      await api.approvePost(brandId, postId);
      navigate("/calendar");
    } catch {
      setActionError("Could not approve — try again.");
      setActionBusy(null);
    }
  };

  const handleRequestChanges = async () => {
    if (!postId || !brandId || !changesBody.trim()) return;
    setActionBusy("changes");
    setActionError(null);
    try {
      const result = await api.requestChanges(brandId, postId, changesBody.trim());
      setPost(result.post);
      setComments((prev) => [...prev, result.comment]);
      setChangesBody("");
      setShowChangesInput(false);
    } catch {
      setActionError("Could not request changes — try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleGetClientLink = async () => {
    if (!postId || !brandId) return;
    setActionBusy("link");
    setActionError(null);
    try {
      const { url } = await api.createReviewLink(brandId, postId);
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      setActionError("Could not generate the client link — try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAddComment = async () => {
    if (!postId || !brandId || !commentBody.trim()) return;
    setActionBusy("comment");
    try {
      const comment = await api.addComment(brandId, postId, commentBody.trim());
      setComments((prev) => [...prev, comment]);
      setCommentBody("");
    } catch {
      // Silently fail; comment stays in the input.
    } finally {
      setActionBusy(null);
    }
  };

  const isTerminal =
    post?.status === "scheduled" ||
    post?.status === "publishing" ||
    post?.status === "published" ||
    post?.status === "failed";

  return (
    <AppShell title="Review post">
      {loadingPost ? (
        <div className="flex items-center justify-center py-24 text-faint">
          <Loader2
            className="h-6 w-6 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        </div>
      ) : postError ? (
        <Card className="p-8 text-center text-sm text-red-600 dark:text-red-400">
          Could not load the post. Try refreshing.
        </Card>
      ) : !post ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <ClipboardCheck className="h-10 w-10 text-faint" aria-hidden />
          <p className="text-sm font-medium text-muted">Post not found</p>
          <p className="max-w-xs text-xs text-faint">
            It may have been approved or cancelled.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1"
            onClick={() => navigate("/calendar")}
          >
            Back to Calendar
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Left column: stepper + preview */}
          <div className="space-y-6">
            {/* Status stepper */}
            <Card className="p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">
                Status
              </p>
              <StatusStepper status={post.status} />
            </Card>

            {/* Post preview */}
            <PostPreview post={post} />
          </div>

          {/* Right column: actions + comment thread */}
          <div className="flex flex-col gap-6">
            {/* Action bar */}
            {!isTerminal && (
              <Card className="p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">
                  Actions
                </p>
                {actionError && (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
                    {actionError}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => void handleApprove()}
                    disabled={actionBusy !== null}
                    size="sm"
                  >
                    {actionBusy === "approve" ? (
                      <Loader2
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden />
                    )}
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={actionBusy !== null}
                    onClick={() => setShowChangesInput((v) => !v)}
                  >
                    <XCircle className="h-4 w-4" aria-hidden />
                    Request changes
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionBusy !== null}
                    onClick={() => void handleGetClientLink()}
                    title="Copy a shareable review link for the client"
                  >
                    {actionBusy === "link" ? (
                      <Loader2
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : linkCopied ? (
                      <Copy className="h-4 w-4" aria-hidden />
                    ) : (
                      <Link2 className="h-4 w-4" aria-hidden />
                    )}
                    {linkCopied ? "Copied!" : "Get client link"}
                  </Button>
                </div>

                {showChangesInput && (
                  <div className="mt-4 space-y-2">
                    <Textarea
                      placeholder="Describe what needs to change..."
                      value={changesBody}
                      onChange={(e) => setChangesBody(e.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={
                          !changesBody.trim() || actionBusy !== null
                        }
                        onClick={() => void handleRequestChanges()}
                      >
                        {actionBusy === "changes" ? (
                          <Loader2
                            className="h-4 w-4 animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                        ) : (
                          <Send className="h-4 w-4" aria-hidden />
                        )}
                        Send
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowChangesInput(false);
                          setChangesBody("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Comment thread */}
            <Card className="flex flex-col p-5">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-wider text-faint">
                  Internal notes
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                <CommentThread
                  comments={comments}
                  loading={loadingComments}
                />
                <div ref={commentEndRef} />
              </div>

              {/* Add comment */}
              <div className="mt-4 flex gap-2 border-t border-line pt-4">
                <Textarea
                  placeholder="Add an internal note..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleAddComment();
                    }
                  }}
                />
                <button
                  onClick={() => void handleAddComment()}
                  disabled={!commentBody.trim() || actionBusy === "comment"}
                  aria-label="Send comment"
                  className="shrink-0 self-end rounded-lg p-2 text-brand-600 transition hover:bg-accent-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-100 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {actionBusy === "comment" ? (
                    <Loader2
                      className="h-5 w-5 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : (
                    <Send className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

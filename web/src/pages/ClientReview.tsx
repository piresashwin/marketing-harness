// Public client review portal — NO AppShell, NO useAuth, NO session required.
// Accessible by unauthenticated visitors via /review/:token.
//
// Shows: post preview (image, caption, scheduled time), client comment thread,
// and Approve / Request-changes / Add-comment actions.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Check,
  ImageIcon,
  Loader2,
  MessageSquare,
  Send,
  XCircle,
} from "lucide-react";
import { api, type ClientComment, type ClientReviewView } from "../api";
import { Button, Card, Textarea } from "../components/ui";

// ── Post preview ──────────────────────────────────────────────────────────

function PostPreview({ view }: { view: ClientReviewView }) {
  const thumb = view.mediaUrls[0];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-hover">
          <ImageIcon className="h-4 w-4 text-faint" aria-hidden />
        </div>
        <span className="text-xs font-semibold text-ink">Post preview</span>
      </div>
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
      {view.caption && (
        <div className="border-t border-line px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-ink">{view.caption}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3 text-xs text-faint">
        <span>{view.mediaType}</span>
        {view.scheduledAt && (
          <span>
            Scheduled{" "}
            {new Date(view.scheduledAt).toLocaleString(undefined, {
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

// ── Client comment thread ─────────────────────────────────────────────────

function CommentThread({ comments }: { comments: ClientComment[] }) {
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

// ── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    in_review: { label: "In Review", cls: "bg-accent-soft text-accent-soft-fg" },
    changes_requested: {
      label: "Changes Requested",
      cls: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
    },
    scheduled: { label: "Approved", cls: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" },
    publishing: { label: "Publishing", cls: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" },
    published: { label: "Published", cls: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" },
  };
  const badge = map[status] ?? { label: status, cls: "bg-hover text-muted" };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ClientReview() {
  const { token } = useParams<{ token: string }>();

  const [view, setView] = useState<ClientReviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [commentBody, setCommentBody] = useState("");
  const [changesBody, setChangesBody] = useState("");
  const [showChangesInput, setShowChangesInput] = useState(false);

  const [actionBusy, setActionBusy] = useState<
    "approve" | "changes" | "comment" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const commentEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setInvalid(false);
    try {
      const data = await api.getClientReview(token);
      setView(data);
    } catch (e) {
      // 404 or any error → invalid token surface
      setInvalid(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [view?.comments]);

  const handleApprove = async () => {
    if (!token) return;
    setActionBusy("approve");
    setActionError(null);
    try {
      const result = await api.clientApprove(token);
      setView((prev) => prev ? { ...prev, status: result.status } : prev);
    } catch {
      setActionError("Could not approve — try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRequestChanges = async () => {
    if (!token || !changesBody.trim()) return;
    setActionBusy("changes");
    setActionError(null);
    try {
      const result = await api.clientRequestChanges(token, changesBody.trim());
      setView((prev) =>
        prev
          ? {
              ...prev,
              status: result.status,
              comments: [
                ...prev.comments,
                {
                  id: Date.now().toString(),
                  authorLabel: "Client",
                  body: changesBody.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : prev,
      );
      setChangesBody("");
      setShowChangesInput(false);
    } catch {
      setActionError("Could not request changes — try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAddComment = async () => {
    if (!token || !commentBody.trim()) return;
    setActionBusy("comment");
    try {
      const { comment } = await api.clientComment(token, commentBody.trim());
      setView((prev) =>
        prev ? { ...prev, comments: [...prev.comments, comment] } : prev,
      );
      setCommentBody("");
    } catch {
      // Non-fatal — body stays in the input.
    } finally {
      setActionBusy(null);
    }
  };

  const isTerminal =
    view?.status === "scheduled" ||
    view?.status === "publishing" ||
    view?.status === "published" ||
    view?.status === "failed";

  return (
    <div className="min-h-screen bg-canvas">
      {/* Minimal header — no nav, no session */}
      <header className="border-b border-line bg-surface px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="text-sm font-semibold text-ink">
            Content Review
          </span>
          {view && <StatusBadge status={view.status} />}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-faint">
            <Loader2
              className="h-6 w-6 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          </div>
        ) : invalid ? (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <XCircle className="h-12 w-12 text-faint" aria-hidden />
            <p className="text-base font-semibold text-ink">
              This review link is no longer valid.
            </p>
            <p className="max-w-xs text-sm text-muted">
              The link may have expired, been revoked, or already used. Ask
              the sender for a new link.
            </p>
          </div>
        ) : view ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Left: post preview */}
            <div>
              <PostPreview view={view} />
            </div>

            {/* Right: actions + comments */}
            <div className="flex flex-col gap-6">
              {/* Actions */}
              {!isTerminal && (
                <Card className="p-5">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">
                    Your decision
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

              {/* Approved / published / failed confirmation */}
              {isTerminal && (
                <Card className="flex items-center gap-3 p-5">
                  {view.status === "failed" ? (
                    <XCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                  ) : (
                    <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                  )}
                  <p className="text-sm text-ink">
                    {view.status === "published"
                      ? "This post has been published."
                      : view.status === "failed"
                        ? "This post could not be published — contact the sender."
                        : "This post has been approved and is scheduled."}
                  </p>
                </Card>
              )}

              {/* Comment thread */}
              <Card className="flex flex-col p-5">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare
                    className="h-4 w-4 text-muted"
                    aria-hidden
                  />
                  <p className="text-xs font-semibold uppercase tracking-wider text-faint">
                    Comments
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <CommentThread comments={view.comments} />
                  <div ref={commentEndRef} />
                </div>

                {/* Add comment input */}
                <div className="mt-4 flex gap-2 border-t border-line pt-4">
                  <Textarea
                    placeholder="Add a comment..."
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
                    disabled={
                      !commentBody.trim() || actionBusy === "comment"
                    }
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
        ) : null}
      </main>
    </div>
  );
}

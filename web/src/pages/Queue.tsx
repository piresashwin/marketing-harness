// Queue page — shows scheduled Instagram posts grouped by day, plus the
// internal review queue (in_review / changes_requested).

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  ClipboardCheck,
  FileEdit,
  ImageIcon,
  Loader2,
  Trash2,
} from "lucide-react";
import { api, type DraftPost, type ReviewPost, type ScheduledPost } from "../api";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { Button, Card } from "../components/ui";

/** Format a Date to a readable local day label. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Format to HH:MM local time. */
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Group posts by calendar day (local). Sorted oldest → newest. */
function groupByDay(
  posts: ScheduledPost[],
): { label: string; posts: ScheduledPost[] }[] {
  const map = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const key = new Date(p.scheduledAt).toDateString();
    const bucket = map.get(key) ?? [];
    bucket.push(p);
    map.set(key, bucket);
  }
  return Array.from(map.entries()).map(([, ps]) => ({
    label: dayLabel(ps[0].scheduledAt!),
    posts: ps,
  }));
}

const STATUS_STYLES: Record<string, string> = {
  scheduled:
    "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  publishing:
    "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  published:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  in_review:
    "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  changes_requested:
    "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-hover text-muted";
  const label =
    status === "in_review"
      ? "In review"
      : status === "changes_requested"
        ? "Changes requested"
        : status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function Queue() {
  const { activeBrandId, activeBrand } = useBrand();
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewPost[]>([]);
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    setError(false);
    try {
      const [sched, review, goals] = await Promise.all([
        api.listQueue(activeBrandId),
        api.listReviewQueue(activeBrandId),
        api.listGoals(activeBrandId),
      ]);
      setScheduled(sched);
      setReviewQueue(review);
      setDrafts(goals.drafts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (postId: string) => {
    if (!activeBrandId) return;
    try {
      await api.cancelScheduled(activeBrandId, postId);
      setScheduled((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      void load();
    }
  };

  const deleteDraft = async (postId: string) => {
    if (!activeBrandId) return;
    try {
      await api.deleteDraft(activeBrandId, postId);
      setDrafts((prev) => prev.filter((d) => d.id !== postId));
    } catch {
      void load();
    }
  };

  const groups = groupByDay(scheduled);

  return (
    <AppShell
      title="Calendar"
      subtitle={activeBrand ? activeBrand.name : undefined}
      actions={
        <Link to="/compose">
          <Button size="sm" variant="secondary">
            <CalendarClock className="h-4 w-4" aria-hidden />
            Schedule post
          </Button>
        </Link>
      }
    >
      {!activeBrandId ? (
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one to start scheduling.
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-faint">
          <Loader2
            className="h-5 w-5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        </div>
      ) : error ? (
        <Card className="p-8 text-center text-sm text-red-600 dark:text-red-400">
          Could not load the queue. Try refreshing.
        </Card>
      ) : (
        <div className="space-y-10">
          {/* ── Review queue ────────────────────────────────────── */}
          {reviewQueue.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <ClipboardCheck className="h-4 w-4 text-violet-500" aria-hidden />
                Needs review
                <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  {reviewQueue.length}
                </span>
              </h2>
              <div className="space-y-3">
                {reviewQueue.map((post) => (
                  <ReviewRow key={post.id} post={post} brandId={activeBrandId} />
                ))}
              </div>
            </section>
          )}

          {/* ── Drafts (from goal plans, awaiting media) ────────── */}
          {drafts.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <FileEdit className="h-4 w-4 text-accent" aria-hidden />
                Drafts
                <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-soft-fg">
                  {drafts.length}
                </span>
              </h2>
              <div className="space-y-3">
                {drafts.map((draft) => (
                  <DraftRow key={draft.id} draft={draft} onDelete={deleteDraft} />
                ))}
              </div>
            </section>
          )}

          {/* ── Scheduled queue ─────────────────────────────────── */}
          {groups.length === 0 && reviewQueue.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-12 text-center">
              <CalendarClock className="h-10 w-10 text-faint" aria-hidden />
              <p className="text-sm font-medium text-muted">
                No scheduled posts
              </p>
              <p className="max-w-xs text-xs text-faint">
                Go to Compose, pick an image and a time, then hit "Add to
                queue."
              </p>
              <Link to="/compose">
                <Button size="sm" className="mt-1">
                  Schedule a post
                </Button>
              </Link>
            </Card>
          ) : (
            groups.map((group) => (
              <section key={group.label}>
                <h2 className="mb-3 text-sm font-semibold text-muted">
                  {group.label}
                </h2>
                <div className="space-y-3">
                  {group.posts.map((post) => (
                    <QueueRow key={post.id} post={post} onCancel={cancel} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </AppShell>
  );
}

// ── Review row ────────────────────────────────────────────────────────────

function ReviewRow({
  post,
  brandId,
}: {
  post: ReviewPost;
  brandId: string;
}) {
  const thumb = post.mediaUrls[0];

  return (
    <Card className="flex items-center gap-4 p-4">
      {/* Thumbnail */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-hover">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-faint" aria-hidden />
        )}
      </div>

      {/* Caption + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {post.caption ?? (
            <span className="italic text-faint">No caption</span>
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {post.scheduledAt && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarClock className="h-3 w-3" aria-hidden />
              {timeLabel(post.scheduledAt)}
            </span>
          )}
          <StatusBadge status={post.status} />
          <span className="text-xs text-faint">
            Instagram · {post.mediaType}
          </span>
        </div>
      </div>

      {/* Review link */}
      <Link
        to={`/posts/${post.id}/review?brandId=${brandId}`}
        className="shrink-0"
      >
        <Button size="sm" variant="secondary">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          Review
        </Button>
      </Link>
    </Card>
  );
}

// ── Draft row (caption-only post awaiting media, from a goal plan) ────────

function DraftRow({
  draft,
  onDelete,
}: {
  draft: DraftPost;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(draft.id);
    setDeleting(false);
  };

  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-hover">
        <FileEdit className="h-6 w-6 text-faint" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {draft.caption ?? <span className="italic text-faint">No caption</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {draft.scheduledAt && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarClock className="h-3 w-3" aria-hidden />
              {dayLabel(draft.scheduledAt)} · {timeLabel(draft.scheduledAt)}
            </span>
          )}
          <span className="rounded-full bg-hover px-2 py-0.5 text-xs font-medium text-muted">
            Draft
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link to="/compose" state={{ draftId: draft.id }}>
          <Button size="sm" variant="secondary">
            Finish in Compose
          </Button>
        </Link>
        <button
          onClick={() => void handleDelete()}
          disabled={deleting}
          aria-label="Delete draft"
          className="rounded-lg p-2 text-faint transition hover:bg-hover hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </Card>
  );
}

// ── Scheduled queue row ───────────────────────────────────────────────────

function QueueRow({
  post,
  onCancel,
}: {
  post: ScheduledPost;
  onCancel: (id: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel(post.id);
    setCancelling(false);
  };

  const thumb = post.mediaUrls[0];

  return (
    <Card className="flex items-center gap-4 p-4">
      {/* Thumbnail */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-hover">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-faint" aria-hidden />
        )}
      </div>

      {/* Caption + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {post.caption ?? (
            <span className="italic text-faint">No caption</span>
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {post.scheduledAt && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarClock className="h-3 w-3" aria-hidden />
              {timeLabel(post.scheduledAt)}
            </span>
          )}
          <StatusBadge status={post.status} />
          <span className="text-xs text-faint">
            Instagram · {post.mediaType}
          </span>
        </div>
      </div>

      {/* Cancel */}
      {post.status === "scheduled" && (
        <button
          onClick={() => void handleCancel()}
          disabled={cancelling}
          aria-label="Cancel scheduled post"
          className="shrink-0 rounded-lg p-2 text-faint transition hover:bg-hover hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
        >
          {cancelling ? (
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
    </Card>
  );
}

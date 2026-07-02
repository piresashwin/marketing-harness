import { pool } from "../db/index.js";
import { env } from "../config/env.js";
import { instagram } from "../connectors/instagram/index.js";

// Claimed row returned by the atomic UPDATE. NOTE: `caption` and `media_urls`
// are content — never log the whole post object; log `id` (+ Error.name) only.
interface ClaimedPost {
  id: number;
  brand_id: number;
  media_type: string;
  caption: string | null;
  media_urls: string[];
}

// Guard against overlapping ticks: if a pass is already running, skip the
// next timer fire rather than stacking concurrent workers.
let isRunning = false;

/**
 * Atomically claims all due scheduled posts in a single UPDATE … RETURNING,
 * then publishes each. Claiming is atomic — any concurrent worker on the same
 * DB will not see status='scheduled' again, so each post is sent exactly once.
 * One bad post does not abort the batch.
 */
export async function publishDuePosts(): Promise<void> {
  // Claim all posts that are due: flip scheduled → publishing in one statement.
  // media_urls is stored as jsonb (string[]); pg parses it for us.
  const { rows } = await pool.query<ClaimedPost>(
    `UPDATE posts
        SET status = 'publishing'
      WHERE status = 'scheduled'
        AND scheduled_at <= now()
      RETURNING id, brand_id, media_type, caption, media_urls`,
  );

  if (rows.length === 0) return;

  console.log(`[scheduler] claimed ${rows.length} post(s) for publishing`);

  for (const post of rows) {
    try {
      await instagram.publishExistingPost(
        post.id,
        post.brand_id,
        post.media_urls,
        post.media_type,
        post.caption,
      );
      // publishExistingPost calls markPublished on success — log id only.
      console.log(`[scheduler] published post ${post.id}`);
    } catch (e) {
      // Store only the Error.name — never the message, which can include tokens
      // or provider error text (pii-auditor note N1).
      const reason = (e as Error).name ?? "UnknownError";
      console.error(`[scheduler] post ${post.id} failed:`, reason);
      try {
        await instagram.markScheduledFailed(post.id, post.brand_id, reason);
      } catch {
        // markFailed is best-effort — don't let a DB hiccup bubble up.
        console.error(`[scheduler] could not mark post ${post.id} as failed`);
      }
    }
  }
}

/**
 * Recover rows orphaned in 'publishing' by a crash/restart between the atomic
 * claim and the published/failed mark. At boot no worker is in flight, so any
 * 'publishing' row is necessarily orphaned. We mark them 'failed' (not requeue)
 * because the process may have died AFTER the post went live — requeuing would
 * risk a double-post to a real account. The user can re-schedule from the queue.
 */
async function recoverOrphanedClaims(): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE posts
        SET status = 'failed', error = 'InterruptedAtPublish'
      WHERE status = 'publishing'`,
  );
  if (rowCount) {
    console.warn(`[scheduler] recovered ${rowCount} orphaned post(s) → failed`);
  }
}

/**
 * Starts the polling scheduler. Respects SCHEDULER_ENABLED and
 * SCHEDULER_INTERVAL_MS (default 60 s). Guards against overlapping runs.
 */
export function startScheduler(): void {
  if (!env.scheduler.enabled) {
    console.log("[scheduler] disabled (SCHEDULER_ENABLED=false)");
    return;
  }

  // One-time recovery of interrupted publishes before the first tick.
  recoverOrphanedClaims().catch((e) =>
    console.error("[scheduler] orphan recovery failed:", (e as Error).name),
  );

  const intervalMs = env.scheduler.intervalMs;
  console.log(`[scheduler] started, polling every ${intervalMs} ms`);

  setInterval(() => {
    if (isRunning) {
      console.log("[scheduler] skipping tick — previous pass still running");
      return;
    }
    isRunning = true;
    publishDuePosts()
      .catch((e) => {
        // Log the error name only — never the full error (token/PII risk).
        console.error("[scheduler] pass error:", (e as Error).name);
      })
      .finally(() => {
        isRunning = false;
      });
  }, intervalMs);
}

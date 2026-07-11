/**
 * Goal-driven mode — the user states an outcome, an AI proposes an approvable
 * plan (an "Intent Preview"), and on approval the plan is materialized as
 * status='draft' posts in the brand's queue. Shared by REST + MCP (no forked
 * logic).
 *
 * Status machine (plain text, no DB enum):
 *   proposed → approved   (approveGoal creates draft posts)
 *   proposed → discarded  (discardGoal, no posts created)
 *
 * Draft posts (status='draft') are captions-without-media awaiting completion
 * in Compose; the scheduler worker only ever touches status='scheduled', so a
 * draft never gets auto-published. goal_run_id ties a draft post back to the
 * run that created it, so discard can clean up only its own still-draft posts.
 *
 * Every query carries brand_id; throws are safe enumerated strings the
 * REST/MCP layers map to client-facing errors.
 */

import { pool } from "../db/index.js";
import { generateGoalPlan, type GoalPlan } from "../connectors/anthropic/index.js";

const DEFAULT_TIME = "09:00";

export interface GoalRun {
  id: string;
  goal: string;
  status: string;
  plan: GoalPlan;
  createdAt: string;
}

export interface GoalRunSummary {
  id: string;
  goal: string;
  status: string;
  stepCount: number;
  createdAt: string;
}

export interface DraftPost {
  id: string;
  caption: string | null;
  scheduledAt: string | null;
  goalRunId: string | null;
}

interface RunRow {
  id: unknown;
  goal: string;
  status: string;
  plan: GoalPlan;
  created_at: Date;
}

function mapRun(r: RunRow): GoalRun {
  return {
    id: String(r.id),
    goal: r.goal,
    status: r.status,
    plan: r.plan,
    createdAt: r.created_at.toISOString(),
  };
}

/** Resolve a step's dayOffset + optional time into a concrete future timestamp. */
function stepTimestamp(dayOffset: number, time: string | null): Date {
  const [h, m] = (time ?? DEFAULT_TIME).split(":").map(Number);
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Generate an Intent Preview for a stated goal and persist it as a 'proposed'
 * run. Nothing is added to the queue yet — that happens on approveGoal.
 */
export async function proposeGoal(brandId: number, goal: string): Promise<GoalRun> {
  const plan = await generateGoalPlan(brandId, { goal });
  const { rows } = await pool.query<RunRow>(
    `INSERT INTO goal_runs (brand_id, goal, status, plan)
     VALUES ($1, $2, 'proposed', $3::jsonb)
     RETURNING id, goal, status, plan, created_at`,
    [brandId, goal, JSON.stringify(plan)],
  );
  return mapRun(rows[0]);
}

/**
 * Approve a proposed run: materialize each plan step as a status='draft' post
 * (caption-only, no media) and mark the run 'approved'. Only valid from
 * status='proposed'. Returns the updated run plus the new draft post ids.
 */
export async function approveGoal(
  brandId: number,
  runId: number,
): Promise<{ run: GoalRun; createdDraftIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const runRes = await client.query<RunRow>(
      `SELECT id, goal, status, plan, created_at FROM goal_runs
        WHERE id = $1 AND brand_id = $2`,
      [runId, brandId],
    );
    const runRow = runRes.rows[0];
    if (!runRow) {
      await client.query("ROLLBACK");
      throw new Error("not_found");
    }
    if (runRow.status !== "proposed") {
      await client.query("ROLLBACK");
      throw new Error("not_found");
    }

    const createdDraftIds: string[] = [];
    for (const step of runRow.plan.steps) {
      const scheduledAt = stepTimestamp(step.dayOffset, step.time);
      const postRes = await client.query<{ id: number }>(
        `INSERT INTO posts
           (user_key, brand_id, media_type, caption, media_urls, status, scheduled_at, goal_run_id)
         VALUES ($1, $2, 'IMAGE', $3, '[]'::jsonb, 'draft', $4, $5)
         RETURNING id`,
        [`brand:${brandId}`, brandId, step.hook, scheduledAt, runId],
      );
      createdDraftIds.push(String(postRes.rows[0].id));
    }

    const updatedRes = await client.query<RunRow>(
      `UPDATE goal_runs SET status = 'approved', updated_at = now()
        WHERE id = $1 AND brand_id = $2
        RETURNING id, goal, status, plan, created_at`,
      [runId, brandId],
    );

    await client.query("COMMIT");
    return { run: mapRun(updatedRes.rows[0]), createdDraftIds };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Discard a proposed or approved run: mark it 'discarded' and delete its
 * still-draft posts (a draft the user already finished in Compose has moved
 * to 'scheduled' and is untouched).
 */
export async function discardGoal(brandId: number, runId: number): Promise<GoalRun> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const runRes = await client.query<RunRow>(
      `UPDATE goal_runs SET status = 'discarded', updated_at = now()
        WHERE id = $1 AND brand_id = $2 AND status IN ('proposed', 'approved')
        RETURNING id, goal, status, plan, created_at`,
      [runId, brandId],
    );
    if (!runRes.rows[0]) {
      await client.query("ROLLBACK");
      throw new Error("not_found");
    }

    await client.query(
      `DELETE FROM posts WHERE goal_run_id = $1 AND brand_id = $2 AND status = 'draft'`,
      [runId, brandId],
    );

    await client.query("COMMIT");
    return mapRun(runRes.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Recent goal runs for the action log, most recent first. */
export async function listGoals(brandId: number): Promise<GoalRunSummary[]> {
  const { rows } = await pool.query<RunRow>(
    `SELECT id, goal, status, plan, created_at FROM goal_runs
      WHERE brand_id = $1
      ORDER BY id DESC
      LIMIT 50`,
    [brandId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    goal: r.goal,
    status: r.status,
    stepCount: Array.isArray(r.plan?.steps) ? r.plan.steps.length : 0,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Draft posts (status='draft') awaiting completion in Compose. */
export async function listDrafts(brandId: number): Promise<DraftPost[]> {
  const { rows } = await pool.query<{
    id: unknown;
    caption: string | null;
    scheduled_at: Date | null;
    goal_run_id: unknown | null;
  }>(
    `SELECT id, caption, scheduled_at, goal_run_id FROM posts
      WHERE brand_id = $1 AND status = 'draft'
      ORDER BY scheduled_at ASC NULLS LAST, id ASC`,
    [brandId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    caption: r.caption,
    scheduledAt: r.scheduled_at?.toISOString() ?? null,
    goalRunId: r.goal_run_id != null ? String(r.goal_run_id) : null,
  }));
}

/** A single draft post, for Compose to prefill. Must belong to the brand. */
export async function getDraft(brandId: number, postId: number): Promise<DraftPost> {
  const { rows } = await pool.query<{
    id: unknown;
    caption: string | null;
    scheduled_at: Date | null;
    goal_run_id: unknown | null;
  }>(
    `SELECT id, caption, scheduled_at, goal_run_id FROM posts
      WHERE id = $1 AND brand_id = $2 AND status = 'draft'`,
    [postId, brandId],
  );
  if (!rows[0]) throw new Error("not_found");
  const r = rows[0];
  return {
    id: String(r.id),
    caption: r.caption,
    scheduledAt: r.scheduled_at?.toISOString() ?? null,
    goalRunId: r.goal_run_id != null ? String(r.goal_run_id) : null,
  };
}

/** Delete a draft post outright (the "Delete" action in the Queue drafts list). */
export async function deleteDraft(brandId: number, postId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `DELETE FROM posts WHERE id = $1 AND brand_id = $2 AND status = 'draft'`,
    [postId, brandId],
  );
  if (!rowCount) throw new Error("not_found");
}

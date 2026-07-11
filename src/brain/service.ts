/**
 * Brand Brain — persisted items derived from a brand's Instagram analytics.
 * Shared by the REST routes and the MCP tools (no forked logic).
 *
 * Applying an item is a REVERSIBLE status flip, never a destructive profile
 * mutation: patterns/suggestions start 'active' and move to 'applied' when the
 * user approves them; examples are created 'applied' (endorsed by default) by
 * relearn(). The anthropic connector's `loadBrandContext` reads status='applied'
 * rows and injects them into generation prompts — that's the whole loop.
 *
 * Every query carries brand_id; throws are safe enumerated strings the API/MCP
 * layers map to client-facing errors.
 */

import { pool } from "../db/index.js";
import { instagram } from "../connectors/instagram/index.js";
import { deriveBrandBrain } from "../connectors/anthropic/index.js";
import type { AnalyticsPost } from "../connectors/instagram/index.js";

export type BrainItemKind = "pattern" | "suggestion" | "example";
export type BrainItemStatus = "active" | "applied" | "dismissed";

export interface BrainPattern {
  id: string;
  title: string;
  evidence: string;
  impact: "High" | "Medium" | "Low";
  status: BrainItemStatus;
}

export interface BrainSuggestion {
  id: string;
  title: string;
  description: string;
  status: BrainItemStatus;
}

export interface BrainExample {
  id: string;
  caption: string;
  metric: string;
  annotation: string;
  status: BrainItemStatus;
}

export interface BrainCandidate {
  caption: string;
  metric: string;
}

export interface Brain {
  patterns: BrainPattern[];
  suggestions: BrainSuggestion[];
  examples: BrainExample[];
  strength: number;
  lastLearnedAt: string | null;
  hasAnalytics: boolean;
  candidates: BrainCandidate[];
}

interface ItemRow {
  id: unknown;
  kind: string;
  data: Record<string, unknown>;
  status: string;
  created_at: Date;
}

const FIELD_MAX = 600;

function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Normalized, bounded dedup key — used for idempotent relearn upserts. */
function dedupKey(text: string): string {
  return clip(text, FIELD_MAX).toLowerCase().replace(/\s+/g, " ");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? clip(v, max) : "";
}

function mapPattern(r: ItemRow): BrainPattern {
  const impact = String(r.data.impact ?? "Medium");
  return {
    id: String(r.id),
    title: str(r.data.title, 140),
    evidence: str(r.data.evidence, 400),
    impact: impact === "High" || impact === "Medium" || impact === "Low" ? impact : "Medium",
    status: r.status as BrainItemStatus,
  };
}

function mapSuggestion(r: ItemRow): BrainSuggestion {
  return {
    id: String(r.id),
    title: str(r.data.title, 140),
    description: str(r.data.description, 300),
    status: r.status as BrainItemStatus,
  };
}

function mapExample(r: ItemRow): BrainExample {
  return {
    id: String(r.id),
    caption: str(r.data.caption, FIELD_MAX),
    metric: str(r.data.metric, 100),
    annotation: str(r.data.annotation, 240),
    status: r.status as BrainItemStatus,
  };
}

function postEngagement(p: AnalyticsPost): number {
  return p.totalInteractions ?? p.likeCount + p.commentsCount;
}

function formatMetric(p: AnalyticsPost): string {
  const parts: string[] = [];
  if (typeof p.saved === "number") parts.push(`${p.saved} saves`);
  if (typeof p.reach === "number") parts.push(`reach ${p.reach}`);
  if (!parts.length) parts.push(`${postEngagement(p)} engagements`);
  return parts.join(" · ");
}

async function loadItems(brandId: number): Promise<ItemRow[]> {
  const { rows } = await pool.query<ItemRow>(
    "SELECT id, kind, data, status, created_at FROM brand_brain_items WHERE brand_id = $1 ORDER BY id",
    [brandId],
  );
  return rows;
}

/**
 * Read the brand's current Brain: persisted items, learning strength, when it
 * was last learned, whether analytics exist yet, and candidate top posts (not
 * already promoted to an example) for "add example".
 */
export async function getBrain(brandId: number): Promise<Brain> {
  const rows = await loadItems(brandId);
  const patterns = rows.filter((r) => r.kind === "pattern").map(mapPattern);
  const suggestions = rows.filter((r) => r.kind === "suggestion").map(mapSuggestion);
  const examples = rows.filter((r) => r.kind === "example").map(mapExample);

  const latest = await instagram.latestAnalytics(brandId);
  const hasAnalytics = latest !== null;

  let candidates: BrainCandidate[] = [];
  if (latest) {
    const existing = new Set(examples.map((e) => dedupKey(e.caption)));
    candidates = [...latest.snapshot.posts]
      .filter((p): p is AnalyticsPost & { caption: string } => Boolean(p.caption?.trim()))
      .sort((a, b) => postEngagement(b) - postEngagement(a))
      .slice(0, 8)
      .filter((p) => !existing.has(dedupKey(p.caption)))
      .map((p) => ({ caption: clip(p.caption.replace(/\s+/g, " "), FIELD_MAX), metric: formatMetric(p) }));
  }

  const appliedCount =
    patterns.filter((p) => p.status === "applied").length +
    suggestions.filter((s) => s.status === "applied").length;
  const strength = Math.min(100, Math.round(((appliedCount + examples.length) / 10) * 100));

  const lastLearnedAt = rows.length
    ? new Date(Math.max(...rows.map((r) => r.created_at.getTime()))).toISOString()
    : null;

  return { patterns, suggestions, examples, strength, lastLearnedAt, hasAnalytics, candidates };
}

/**
 * Derive fresh Brain items from the brand's latest analytics and upsert them.
 * ON CONFLICT DO NOTHING preserves prior user decisions (an item the user
 * dismissed stays dismissed; one they applied stays applied) — relearn never
 * resurrects a dismissed item. Throws "no_analytics" if no snapshot exists yet.
 */
export async function relearn(brandId: number): Promise<Brain> {
  const draft = await deriveBrandBrain(brandId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of draft.patterns) {
      await client.query(
        `INSERT INTO brand_brain_items (brand_id, kind, data, status, dedup_key)
         VALUES ($1, 'pattern', $2::jsonb, 'active', $3)
         ON CONFLICT (brand_id, kind, dedup_key) DO NOTHING`,
        [brandId, JSON.stringify(p), dedupKey(p.title)],
      );
    }
    for (const s of draft.suggestions) {
      await client.query(
        `INSERT INTO brand_brain_items (brand_id, kind, data, status, dedup_key)
         VALUES ($1, 'suggestion', $2::jsonb, 'active', $3)
         ON CONFLICT (brand_id, kind, dedup_key) DO NOTHING`,
        [brandId, JSON.stringify(s), dedupKey(s.title)],
      );
    }
    for (const e of draft.examples) {
      await client.query(
        `INSERT INTO brand_brain_items (brand_id, kind, data, status, dedup_key)
         VALUES ($1, 'example', $2::jsonb, 'applied', $3)
         ON CONFLICT (brand_id, kind, dedup_key) DO NOTHING`,
        [brandId, JSON.stringify(e), dedupKey(e.caption)],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getBrain(brandId);
}

async function setStatus(
  brandId: number,
  itemId: number,
  status: BrainItemStatus,
): Promise<Brain> {
  const { rowCount } = await pool.query(
    "UPDATE brand_brain_items SET status = $1, updated_at = now() WHERE id = $2 AND brand_id = $3",
    [status, itemId, brandId],
  );
  if (!rowCount) throw new Error("not_found");
  return getBrain(brandId);
}

/** Apply a pattern or suggestion — feeds it into generation via loadBrandContext. */
export async function applyItem(brandId: number, itemId: number): Promise<Brain> {
  return setStatus(brandId, itemId, "applied");
}

/** Dismiss any item (pattern, suggestion, or example — "remove" for examples). */
export async function dismissItem(brandId: number, itemId: number): Promise<Brain> {
  return setStatus(brandId, itemId, "dismissed");
}

/** Reverse a prior apply/dismiss. Examples revert to 'applied' (their default), not 'active'. */
export async function undoItem(brandId: number, itemId: number): Promise<Brain> {
  const { rows } = await pool.query<{ kind: string }>(
    "SELECT kind FROM brand_brain_items WHERE id = $1 AND brand_id = $2",
    [itemId, brandId],
  );
  if (!rows[0]) throw new Error("not_found");
  return setStatus(brandId, itemId, rows[0].kind === "example" ? "applied" : "active");
}

/** Edit an example's "why this works" annotation. Only valid for kind='example'. */
export async function updateExampleAnnotation(
  brandId: number,
  itemId: number,
  annotation: string,
): Promise<Brain> {
  const { rowCount } = await pool.query(
    `UPDATE brand_brain_items
        SET data = jsonb_set(data, '{annotation}', $1::jsonb), updated_at = now()
      WHERE id = $2 AND brand_id = $3 AND kind = 'example'`,
    [JSON.stringify(clip(annotation, 240)), itemId, brandId],
  );
  if (!rowCount) throw new Error("not_found");
  return getBrain(brandId);
}

/** Promote a candidate top post to a voice example, applied by default. */
export async function addExampleFromCandidate(
  brandId: number,
  input: { caption: string; metric: string; annotation: string },
): Promise<Brain> {
  const caption = clip(input.caption, FIELD_MAX);
  if (!caption) throw new Error("invalid_example");
  const data = {
    caption,
    metric: clip(input.metric, 100),
    annotation: clip(input.annotation, 240),
  };
  await pool.query(
    `INSERT INTO brand_brain_items (brand_id, kind, data, status, dedup_key)
     VALUES ($1, 'example', $2::jsonb, 'applied', $3)
     ON CONFLICT (brand_id, kind, dedup_key) DO UPDATE SET status = 'applied', updated_at = now()`,
    [brandId, JSON.stringify(data), dedupKey(caption)],
  );
  return getBrain(brandId);
}

/** Permanently remove an item (distinct from dismiss, which is reversible). */
export async function deleteItem(brandId: number, itemId: number): Promise<Brain> {
  const { rowCount } = await pool.query(
    "DELETE FROM brand_brain_items WHERE id = $1 AND brand_id = $2",
    [itemId, brandId],
  );
  if (!rowCount) throw new Error("not_found");
  return getBrain(brandId);
}

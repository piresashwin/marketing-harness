import { pool } from "../db/index.js";
import {
  getConnectorApiKey,
  getGenerationDefaults,
  listConnectors,
  type WorkspaceProvider,
} from "./workspace.js";
import * as fal from "./fal/index.js";
import * as elevenlabs from "./elevenlabs/index.js";
import { rehostToStore, resolveToPublicUrl } from "./media/index.js";
import type {
  GenerationCapability,
  ImageGenResult,
  ImageSize,
  VideoAspect,
} from "./types.js";

// Generation routing — the single choke point for media generation (REST +
// MCP parity, invariant #4). Which provider runs a request resolves as:
//   1. explicit `provider` in the request (must be configured)
//   2. the workspace's stored default for the capability (workspace_settings)
//   3. the only configured provider with the capability
//   4. enumerated error: "no_provider_configured"
// No provider is special-cased past the dispatch switch (invariant #3).

export const CAPABILITY_PROVIDERS: Record<
  GenerationCapability,
  WorkspaceProvider[]
> = {
  image: ["fal"],
  video: ["fal"],
  voice: ["elevenlabs"],
};

interface ResolvedProvider {
  provider: WorkspaceProvider;
  apiKey: string;
  /** Model from the workspace default, when the default chose the provider. */
  defaultModel?: string;
}

async function resolveProvider(
  workspaceId: number,
  capability: GenerationCapability,
  explicit?: WorkspaceProvider,
): Promise<ResolvedProvider> {
  const candidates = CAPABILITY_PROVIDERS[capability];

  if (explicit) {
    if (!candidates.includes(explicit)) {
      throw new Error("provider_not_configured");
    }
    const apiKey = await getConnectorApiKey(workspaceId, explicit);
    if (!apiKey) throw new Error("provider_not_configured");
    return { provider: explicit, apiKey };
  }

  const defaults = await getGenerationDefaults(workspaceId);
  const stored = defaults[capability];
  if (stored && candidates.includes(stored.provider)) {
    const apiKey = await getConnectorApiKey(workspaceId, stored.provider);
    if (apiKey) {
      return { provider: stored.provider, apiKey, defaultModel: stored.model };
    }
    // Stored default points at a since-removed connector — fall through.
  }

  const connected = (await listConnectors(workspaceId))
    .filter((c) => c.status === "connected")
    .map((c) => c.provider)
    .filter((p) => candidates.includes(p));
  if (connected.length === 1) {
    const apiKey = await getConnectorApiKey(workspaceId, connected[0]);
    if (apiKey) return { provider: connected[0], apiKey };
  }

  throw new Error("no_provider_configured");
}

async function workspaceIdForBrand(brandId: number): Promise<number> {
  const { rows } = await pool.query<{ workspace_id: number }>(
    "SELECT workspace_id FROM brands WHERE id = $1",
    [brandId],
  );
  if (!rows[0]) throw new Error("brand not found");
  return rows[0].workspace_id;
}

/**
 * Generate an image for a brand with its workspace's BYO key, re-host it to
 * the MediaStore (stable public URL under `brands/<brandId>/...`), and return
 * the stored URL. Never logs the prompt or the key.
 */
export async function generateImage(
  brandId: number,
  opts: {
    prompt: string;
    provider?: WorkspaceProvider;
    model?: string;
    size?: ImageSize;
  },
): Promise<ImageGenResult> {
  const workspaceId = await workspaceIdForBrand(brandId);
  const resolved = await resolveProvider(workspaceId, "image", opts.provider);

  // Explicit request model wins over the workspace default's model; the
  // connector enforces its own model allowlist.
  const model = opts.model ?? resolved.defaultModel;

  let output;
  switch (resolved.provider) {
    case "fal":
      output = await fal.generateImage(resolved.apiKey, {
        prompt: opts.prompt,
        model,
        size: opts.size,
      });
      break;
    default:
      throw new Error("provider_not_configured");
  }

  // Provider CDN URLs can expire — re-host for a stable, IG-fetchable URL.
  const url = await rehostToStore({ url: output.url }, brandId);
  return { url, provider: resolved.provider, model: output.model };
}

// ── Video (async job) ──────────────────────────────────────────────────
// Submit returns a job id immediately; readGenerationJob polls the provider on
// demand and re-hosts the clip when it completes. No background worker.

export interface GenerationJob {
  id: string;
  capability: GenerationCapability;
  provider: string;
  model: string;
  status: "pending" | "completed" | "failed";
  url: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  capability: GenerationCapability;
  provider: WorkspaceProvider;
  model: string;
  status: "pending" | "completed" | "failed";
  meta: { statusUrl?: string; responseUrl?: string };
  result_url: string | null;
  created_at: Date;
}

function toJob(r: JobRow): GenerationJob {
  return {
    id: String(r.id),
    capability: r.capability,
    provider: r.provider,
    model: r.model,
    status: r.status,
    url: r.result_url,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Submit a text-to-video generation for a brand. Returns the pending job; the
 * caller polls readGenerationJob until it completes. Never logs the prompt.
 */
export async function generateVideo(
  brandId: number,
  opts: {
    prompt: string;
    provider?: WorkspaceProvider;
    model?: string;
    aspect?: VideoAspect;
    durationSeconds?: 5 | 10;
  },
): Promise<GenerationJob> {
  const workspaceId = await workspaceIdForBrand(brandId);
  const resolved = await resolveProvider(workspaceId, "video", opts.provider);
  const model = opts.model ?? resolved.defaultModel;

  let submission;
  switch (resolved.provider) {
    case "fal":
      submission = await fal.submitVideo(resolved.apiKey, {
        prompt: opts.prompt,
        model,
        aspect: opts.aspect,
        durationSeconds: opts.durationSeconds,
      });
      break;
    default:
      throw new Error("provider_not_configured");
  }

  const { rows } = await pool.query<JobRow>(
    `INSERT INTO generation_jobs (brand_id, capability, provider, model, status, meta)
     VALUES ($1, 'video', $2, $3, 'pending', $4::jsonb)
     RETURNING id, capability, provider, model, status, meta, result_url, created_at`,
    [
      brandId,
      resolved.provider,
      submission.model,
      JSON.stringify({
        requestId: submission.providerRequestId,
        statusUrl: submission.statusUrl,
        responseUrl: submission.responseUrl,
      }),
    ],
  );
  return toJob(rows[0]);
}

/**
 * Read a generation job (brand-scoped). Pending jobs poll the provider live:
 * on completion the clip is re-hosted to the MediaStore and the row updated,
 * so the returned URL is always the stable stored one.
 */
export async function readGenerationJob(
  brandId: number,
  jobId: number,
): Promise<GenerationJob> {
  const { rows } = await pool.query<JobRow>(
    `SELECT id, capability, provider, model, status, meta, result_url, created_at
       FROM generation_jobs WHERE id = $1 AND brand_id = $2`,
    [jobId, brandId],
  );
  const row = rows[0];
  if (!row) throw new Error("job not found");
  if (row.status !== "pending") return toJob(row);
  if (!row.meta.statusUrl || !row.meta.responseUrl) {
    return toJob(row);
  }

  const workspaceId = await workspaceIdForBrand(brandId);
  const apiKey = await getConnectorApiKey(workspaceId, row.provider);
  if (!apiKey) throw new Error("no_provider_configured");

  const poll = await fal.pollVideo(apiKey, {
    statusUrl: row.meta.statusUrl,
    responseUrl: row.meta.responseUrl,
  });
  if (poll.status === "pending") return toJob(row);

  if (poll.status === "failed" || !poll.url) {
    await pool.query(
      `UPDATE generation_jobs SET status = 'failed', error = 'provider_failed', updated_at = now()
        WHERE id = $1 AND brand_id = $2`,
      [jobId, brandId],
    );
    return toJob({ ...row, status: "failed" });
  }

  const url = await rehostToStore({ url: poll.url }, brandId, "video");
  await pool.query(
    `UPDATE generation_jobs SET status = 'completed', result_url = $3, updated_at = now()
      WHERE id = $1 AND brand_id = $2`,
    [jobId, brandId, url],
  );
  return toJob({ ...row, status: "completed", result_url: url });
}

// ── Voice (synchronous) ────────────────────────────────────────────────

/**
 * Generate speech for a brand and store the MP3 in the MediaStore. Voice is an
 * input asset (voiceover) — not directly publishable to Instagram. Never logs
 * the text or the key.
 */
export async function generateVoice(
  brandId: number,
  opts: {
    text: string;
    provider?: WorkspaceProvider;
    voiceId?: string;
    model?: string;
  },
): Promise<{ url: string; provider: string; model: string; voiceId: string }> {
  const workspaceId = await workspaceIdForBrand(brandId);
  const resolved = await resolveProvider(workspaceId, "voice", opts.provider);
  const model = opts.model ?? resolved.defaultModel;

  let output;
  switch (resolved.provider) {
    case "elevenlabs":
      output = await elevenlabs.generateSpeech(resolved.apiKey, {
        text: opts.text,
        voiceId: opts.voiceId,
        model,
      });
      break;
    default:
      throw new Error("provider_not_configured");
  }

  const url = await resolveToPublicUrl(
    { base64: output.base64, contentType: output.contentType },
    brandId,
  );
  return {
    url,
    provider: resolved.provider,
    model: output.model,
    voiceId: output.voiceId,
  };
}

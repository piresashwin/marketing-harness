import type {
  ImageGenOptions,
  ImageGenOutput,
  ImageSize,
  VideoGenOptions,
  VideoGenSubmission,
} from "../types.js";

// fal.ai connector — BYOK image generation over the synchronous fal.run REST
// endpoint (POST https://fal.run/<model> with `Authorization: Key <apiKey>`).
//
// Like higgsfield, the key is store-only at save time (fal has no token-free
// validation ping); a bad key surfaces as an enumerated auth error on the first
// generation. Never logs the prompt, the key, or provider error bodies.
//
// Models are an explicit allowlist: the model id becomes the request PATH on
// fal.run, so a free-form string from the client would be URL injection.
export const FAL_IMAGE_MODELS = [
  // Default: best quality/cost balance for marketing assets.
  "fal-ai/flux/dev",
  // Fast + cheap drafts.
  "fal-ai/flux/schnell",
  // Premium quality, opt-in.
  "fal-ai/flux-pro/v1.1",
] as const;

const DEFAULT_MODEL: (typeof FAL_IMAGE_MODELS)[number] = "fal-ai/flux/dev";

// Coarse harness sizes → fal image_size presets (IG-friendly ratios).
const SIZE_MAP: Record<ImageSize, string> = {
  square: "square_hd", // 1:1, 1024px
  portrait: "portrait_4_3", // 3:4 — closest preset to IG's 4:5 feed ratio
  landscape: "landscape_16_9",
};

// flux/dev typically returns in 10–30s; leave generous headroom.
const GENERATE_TIMEOUT_MS = 90_000;

export function isAllowedImageModel(model: string): boolean {
  return (FAL_IMAGE_MODELS as readonly string[]).includes(model);
}

/**
 * Generate one image and return the provider-hosted URL (fal.media CDN).
 * The caller re-hosts it to the MediaStore — this stays storage-agnostic.
 * Throws enumerated errors only; never echoes provider response bodies.
 */
export async function generateImage(
  apiKey: string,
  opts: ImageGenOptions,
): Promise<ImageGenOutput> {
  const model = opts.model ?? DEFAULT_MODEL;
  if (!isAllowedImageModel(model)) {
    throw new Error("unsupported model");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: opts.prompt,
        image_size: SIZE_MAP[opts.size ?? "square"],
        num_images: 1,
      }),
    });
  } catch {
    // Network error or timeout — never echo the underlying error.
    throw new Error("image generation failed");
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("image provider key is invalid");
  }
  if (resp.status === 422) {
    // Rejected input (incl. content policy) — enumerated, no provider text.
    throw new Error("image generation was declined");
  }
  if (!resp.ok) {
    console.error("[fal] generation failed with status", resp.status);
    throw new Error("image generation failed");
  }

  let data: { images?: { url?: string }[] };
  try {
    data = (await resp.json()) as typeof data;
  } catch {
    throw new Error("image generation failed");
  }
  const url = data.images?.[0]?.url;
  if (!url) {
    throw new Error("image generation failed");
  }
  return { url, model };
}

// ── Video (async, via the fal queue API) ──────────────────────────────
// Video runs 1–6 min, so it goes through queue.fal.run: submit returns a
// request id + polling URLs; the generation service persists those in a
// generation_jobs row and polls on demand. Same allowlist rationale as images.
export const FAL_VIDEO_MODELS = [
  // Default: best price/perf for marketing clips (~$/s), 5s or 10s.
  "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  // Newer tier, higher quality.
  "fal-ai/kling-video/v3/standard/text-to-video",
] as const;

const DEFAULT_VIDEO_MODEL: (typeof FAL_VIDEO_MODELS)[number] =
  "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 30_000;

export function isAllowedVideoModel(model: string): boolean {
  return (FAL_VIDEO_MODELS as readonly string[]).includes(model);
}

/** Only ever fetch polling URLs on fal's queue host — the DB row is not trusted. */
function assertQueueUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("video generation failed");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "queue.fal.run") {
    throw new Error("video generation failed");
  }
}

/**
 * Submit a text-to-video job to the fal queue. Returns the request id and the
 * provider-issued polling URLs (validated to live on queue.fal.run).
 */
export async function submitVideo(
  apiKey: string,
  opts: VideoGenOptions,
): Promise<VideoGenSubmission> {
  const model = opts.model ?? DEFAULT_VIDEO_MODEL;
  if (!isAllowedVideoModel(model)) {
    throw new Error("unsupported model");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: opts.prompt,
        // Kling takes duration as a string enum; default short — it bills per second.
        duration: String(opts.durationSeconds ?? 5),
        aspect_ratio: opts.aspect ?? "9:16",
      }),
    });
  } catch {
    throw new Error("video generation failed");
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("video provider key is invalid");
  }
  if (resp.status === 422) {
    throw new Error("video generation was declined");
  }
  if (!resp.ok) {
    console.error("[fal] video submit failed with status", resp.status);
    throw new Error("video generation failed");
  }

  let data: { request_id?: string; status_url?: string; response_url?: string };
  try {
    data = (await resp.json()) as typeof data;
  } catch {
    throw new Error("video generation failed");
  }
  if (!data.request_id || !data.status_url || !data.response_url) {
    throw new Error("video generation failed");
  }
  assertQueueUrl(data.status_url);
  assertQueueUrl(data.response_url);
  return {
    providerRequestId: data.request_id,
    statusUrl: data.status_url,
    responseUrl: data.response_url,
    model,
  };
}

export interface VideoPollResult {
  status: "pending" | "completed" | "failed";
  /** Provider-hosted video URL when completed. */
  url?: string;
}

/**
 * Poll a submitted video job. When the queue reports COMPLETED, fetches the
 * response payload and returns the provider-hosted video URL.
 */
export async function pollVideo(
  apiKey: string,
  job: { statusUrl: string; responseUrl: string },
): Promise<VideoPollResult> {
  assertQueueUrl(job.statusUrl);
  assertQueueUrl(job.responseUrl);
  const headers = { Authorization: `Key ${apiKey}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const statusResp = await fetch(job.statusUrl, { signal: controller.signal, headers });
    if (statusResp.status === 401 || statusResp.status === 403) {
      throw new Error("video provider key is invalid");
    }
    if (!statusResp.ok) {
      console.error("[fal] video status failed with status", statusResp.status);
      throw new Error("video generation failed");
    }
    const status = ((await statusResp.json()) as { status?: string }).status;
    if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
      return { status: "pending" };
    }
    if (status !== "COMPLETED") {
      return { status: "failed" };
    }

    const resultResp = await fetch(job.responseUrl, { signal: controller.signal, headers });
    if (!resultResp.ok) {
      console.error("[fal] video result failed with status", resultResp.status);
      throw new Error("video generation failed");
    }
    const payload = (await resultResp.json()) as { video?: { url?: string } };
    if (!payload.video?.url) {
      return { status: "failed" };
    }
    return { status: "completed", url: payload.video.url };
  } catch (e) {
    // Re-throw our enumerated errors; wrap anything else (network/timeout).
    const msg = (e as Error).message;
    if (msg === "video provider key is invalid" || msg === "video generation failed") {
      throw e;
    }
    throw new Error("video generation failed");
  } finally {
    clearTimeout(timer);
  }
}

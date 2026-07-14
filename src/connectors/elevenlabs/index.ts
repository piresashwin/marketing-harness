import type { VoiceGenOptions, VoiceGenOutput } from "../types.js";

// ElevenLabs connector — BYOK text-to-speech. Synchronous: POST
// https://api.elevenlabs.io/v1/text-to-speech/<voice_id> with an `xi-api-key`
// header returns MP3 bytes. Voice audio is an INPUT asset (a voiceover to pair
// with video or a slideshow), not directly publishable to Instagram.
// Never logs the text, the key, or provider error bodies.

const API_BASE = "https://api.elevenlabs.io/v1";

// Premade "Rachel" — a safe, natural default present on every account.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL = "eleven_multilingual_v2";

// Voice ids are URL path segments — same injection concern as fal model ids,
// but they're per-account (cloned voices), so an allowlist can't work. Bound
// the charset instead.
const VOICE_ID_RE = /^[A-Za-z0-9]{8,40}$/;
// Model ids are enumerable — allowlist.
const MODELS = ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_v3"] as const;

export function isAllowedVoiceModel(model: string): boolean {
  return (MODELS as readonly string[]).includes(model);
}

// Cost guardrail: ElevenLabs bills per character.
export const VOICE_TEXT_MAX = 2500;

const GENERATE_TIMEOUT_MS = 60_000;

/**
 * Cheap validation of a BYO key — GET /user authenticates without spending
 * character credits. Enumerated errors only.
 */
export async function validateKey(apiKey: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/user`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch {
    throw new Error("could not validate API key");
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("invalid API key");
  }
  if (!resp.ok) {
    throw new Error("could not validate API key");
  }
}

/**
 * Generate speech and return the MP3 bytes (base64) for the caller to store.
 * Throws enumerated errors only.
 */
export async function generateSpeech(
  apiKey: string,
  opts: VoiceGenOptions,
): Promise<VoiceGenOutput> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  if (!VOICE_ID_RE.test(voiceId)) {
    throw new Error("unsupported voice");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  if (!(MODELS as readonly string[]).includes(model)) {
    throw new Error("unsupported model");
  }
  const text = opts.text.trim();
  if (!text || text.length > VOICE_TEXT_MAX) {
    throw new Error("voice generation failed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: model }),
    });
  } catch {
    throw new Error("voice generation failed");
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("voice provider key is invalid");
  }
  if (resp.status === 422) {
    throw new Error("voice generation was declined");
  }
  if (!resp.ok) {
    console.error("[elevenlabs] generation failed with status", resp.status);
    throw new Error("voice generation failed");
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) {
    throw new Error("voice generation failed");
  }
  return {
    base64: buf.toString("base64"),
    contentType: "audio/mpeg",
    model,
    voiceId,
  };
}

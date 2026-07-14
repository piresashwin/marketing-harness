/**
 * Uniform connector interface. Every capability the harness exposes
 * (social, LLM, media generation, ...) implements this shape so the MCP
 * layer and scheduler can treat them interchangeably.
 */
export interface Connector {
  /** Stable id, e.g. "instagram", "anthropic", "fal". */
  readonly id: string;
  /** Human label. */
  readonly name: string;
  /** Capability tags, e.g. ["social.publish", "social.oauth"]. */
  readonly capabilities: string[];
  /** True when the connector has the credentials it needs to operate. */
  isConfigured(): boolean;
}

export interface MediaInput {
  /** Already-public URL — used as-is, not re-hosted. */
  url?: string;
  /** Local filesystem path — read and uploaded to the MediaStore. */
  path?: string;
  /** Raw bytes (base64) — uploaded to the MediaStore. */
  base64?: string;
  /** Optional content type hint for base64/path inputs. */
  contentType?: string;
}

export interface PublishResult {
  providerMediaId: string;
  permalink?: string;
}

/** Generation capabilities the harness can route to a workspace provider. */
export type GenerationCapability = "image" | "video" | "voice";

/** Coarse output shape — each provider maps these to its own size presets. */
export type ImageSize = "square" | "portrait" | "landscape";

export interface ImageGenOptions {
  prompt: string;
  /** Provider model id; must be one the connector explicitly allows. */
  model?: string;
  size?: ImageSize;
}

/** What a provider connector returns: a fetchable URL, not yet re-hosted. */
export interface ImageGenOutput {
  /** Provider-hosted (often short-lived) URL of the generated image. */
  url: string;
  /** The model that actually ran. */
  model: string;
}

/** What the generation service returns to REST/MCP: a stable, re-hosted URL. */
export interface ImageGenResult {
  url: string;
  provider: string;
  model: string;
}

/** Output shape for video — IG Reels want 9:16. */
export type VideoAspect = "9:16" | "16:9" | "1:1";

export interface VideoGenOptions {
  prompt: string;
  /** Provider model id; must be one the connector explicitly allows. */
  model?: string;
  aspect?: VideoAspect;
  /** Clip length; providers bill per second, so this is capped (5 or 10). */
  durationSeconds?: 5 | 10;
}

/** An async video job as submitted to the provider's queue. */
export interface VideoGenSubmission {
  providerRequestId: string;
  /** Provider-issued polling URLs (validated against the provider's host). */
  statusUrl: string;
  responseUrl: string;
  model: string;
}

export interface VoiceGenOptions {
  text: string;
  /** Provider voice id; connector supplies a sensible default. */
  voiceId?: string;
  model?: string;
}

/** Voice output: raw audio bytes for the caller to store. */
export interface VoiceGenOutput {
  base64: string;
  contentType: string;
  model: string;
  voiceId: string;
}

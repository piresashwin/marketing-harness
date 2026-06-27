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

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../../db/index.js";
import { getConnectorApiKey } from "../workspace.js";

// BYOK Claude connector: uses the WORKSPACE's stored key, never an env key.
// Default model is the exact string "claude-opus-4-8" (no date suffix),
// overridable via the connector's config.model. Per opus-4-8 constraints we do
// NOT send temperature/top_p/top_k or thinking — a caption is plain text.

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;

/**
 * Cheap, token-free validation of a BYO key. Maps an auth failure to a clear
 * enumerated message — never leaks the key or the raw provider error text.
 */
export async function validateKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey });
  try {
    await client.models.retrieve(DEFAULT_MODEL);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new Error("invalid API key");
    }
    if (e instanceof Anthropic.APIError && e.status === 404) {
      // Key authenticated but the default model isn't visible — still a valid key.
      return;
    }
    throw new Error("could not validate API key");
  }
}

interface BrandPromptContext {
  workspaceId: number;
  name: string;
  description: string | null;
  audience: string | null;
  voice: Record<string, unknown>;
  pillars: { name: string; description: string | null }[];
}

async function loadBrandContext(brandId: number): Promise<BrandPromptContext> {
  const { rows } = await pool.query<{
    workspace_id: number;
    name: string;
    description: string | null;
    audience: string | null;
    voice: Record<string, unknown> | null;
  }>(
    `SELECT b.workspace_id, b.name, bs.description, bs.audience, bs.voice
       FROM brands b
       LEFT JOIN brand_settings bs ON bs.brand_id = b.id
      WHERE b.id = $1`,
    [brandId],
  );
  if (!rows[0]) throw new Error("brand not found");
  const pillarRes = await pool.query<{ name: string; description: string | null }>(
    "SELECT name, description FROM content_pillars WHERE brand_id = $1 ORDER BY sort_order NULLS LAST, id",
    [brandId],
  );
  return {
    workspaceId: rows[0].workspace_id,
    name: rows[0].name,
    description: rows[0].description,
    audience: rows[0].audience,
    voice: rows[0].voice ?? {},
    pillars: pillarRes.rows,
  };
}

function buildSystemPrompt(ctx: BrandPromptContext, platform?: string): string {
  const lines: string[] = [
    `You are a social media copywriter for the brand "${ctx.name}".`,
    `Write a single ${platform ?? "social media"} caption in the brand's voice.`,
  ];
  if (ctx.description) lines.push(`Brand / industry: ${ctx.description}`);
  if (ctx.audience) lines.push(`Audience: ${ctx.audience}`);
  const tone = ctx.voice?.tone;
  if (Array.isArray(tone) && tone.length) {
    lines.push(`Brand voice / tone: ${tone.join(", ")}.`);
  }
  const goals = ctx.voice?.goals;
  if (typeof goals === "string" && goals.trim()) {
    lines.push(`Marketing goals: ${goals.trim()}`);
  }
  if (ctx.pillars.length) {
    lines.push(
      `Content pillars: ${ctx.pillars
        .map((p) => (p.description ? `${p.name} (${p.description})` : p.name))
        .join("; ")}.`,
    );
  }
  lines.push(
    "Return ONLY the caption text — no preamble, no quotes, no explanation.",
  );
  return lines.join("\n");
}

/**
 * Generate a marketing caption for a brand using its workspace's Claude key.
 * Never logs the prompt or the key.
 */
export async function generateCaption(
  brandId: number,
  opts: { prompt?: string; platform?: string },
): Promise<{ caption: string }> {
  const ctx = await loadBrandContext(brandId);
  const apiKey = await getConnectorApiKey(ctx.workspaceId, "anthropic");
  if (!apiKey) {
    throw new Error("No AI provider connected for this workspace");
  }

  // Non-secret model override lives in the connector config.
  const cfgRes = await pool.query<{ config: { model?: string } }>(
    "SELECT config FROM workspace_connectors WHERE workspace_id = $1 AND provider = 'anthropic'",
    [ctx.workspaceId],
  );
  const model = cfgRes.rows[0]?.config?.model || DEFAULT_MODEL;

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(ctx, opts.platform);
  const userContent =
    `${opts.prompt?.trim() || `Write an engaging caption for ${ctx.name}.`}` +
    (opts.platform ? `\n\nPlatform: ${opts.platform}` : "");

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new Error("AI provider key is invalid");
    }
    // Never surface raw provider error text.
    throw new Error("AI caption generation failed");
  }

  if (response.stop_reason === "refusal") {
    throw new Error("AI declined to generate this caption");
  }

  const caption = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!caption) throw new Error("AI returned an empty caption");
  return { caption };
}

import { env } from "../../config/env.js";

/**
 * Thin client for the "Instagram API with Instagram Login" (graph.instagram.com).
 * Works with Instagram Business/Creator accounts via a central Meta app.
 * Docs: https://developers.facebook.com/docs/instagram-platform
 */

const ig = env.instagram;
const GRAPH = "https://graph.instagram.com";
const V = ig.graphVersion;

interface TokenResponse {
  access_token: string;
  user_id?: string | number;
}
interface LongLivedResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

/**
 * A failed Graph API call. Carries the HTTP status and Graph error code so
 * callers can branch (e.g. a missing-permission code → prompt a reconnect)
 * without string-matching the (already-sanitised) message.
 */
export class IgApiError extends Error {
  readonly status: number;
  readonly code?: number;
  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.name = "IgApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * True when the error means the token lacks a required permission (scope) —
 * e.g. an account connected before `instagram_business_manage_insights` was
 * requested. The fix is a reconnect, not a retry. Codes: 10 / 200 = permission,
 * 403 = forbidden.
 */
export function isPermissionError(e: unknown): boolean {
  return (
    e instanceof IgApiError && (e.code === 10 || e.code === 200 || e.status === 403)
  );
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Never echo the raw body — Graph reflects the request URL (which carries
    // the access_token) into some error bodies. Status only.
    throw new IgApiError(res.status, undefined, `Instagram API non-JSON response (status ${res.status})`);
  }
  if (!res.ok) {
    // Graph's structured human message ("Invalid OAuth access token") is safe
    // and useful; the raw body is NOT. Use the parsed message only, with a
    // generic fallback — no raw-body interpolation.
    const err = json as {
      error?: { message?: string; code?: number; type?: string };
    };
    const msg = err.error?.message;
    const code = err.error?.code;
    throw new IgApiError(
      res.status,
      code,
      msg
        ? `Instagram API error (status ${res.status}): ${msg}`
        : `Instagram API error (status ${res.status}${code != null ? `, code ${code}` : ""})`,
    );
  }
  return json as T;
}

/** Step 1 — URL the user opens to authorize the app. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: ig.clientId,
    redirect_uri: ig.redirectUri,
    response_type: "code",
    scope:
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

/** Step 2 — exchange the auth code for a short-lived token + user id. */
export async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: ig.clientId,
    client_secret: ig.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: ig.redirectUri,
    code,
  });
  const json = await http<TokenResponse>(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  return { accessToken: json.access_token, userId: String(json.user_id ?? "") };
}

/** Step 3 — upgrade short-lived to a long-lived (~60 day) token. */
export async function exchangeForLongLivedToken(
  shortToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: ig.clientSecret,
    access_token: shortToken,
  });
  const json = await http<LongLivedResponse>(
    `${GRAPH}/access_token?${params.toString()}`,
  );
  return { accessToken: json.access_token, expiresInSec: json.expires_in };
}

/** Refresh a long-lived token before it expires. */
export async function refreshLongLivedToken(
  token: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: token,
  });
  const json = await http<LongLivedResponse>(
    `${GRAPH}/refresh_access_token?${params.toString()}`,
  );
  return { accessToken: json.access_token, expiresInSec: json.expires_in };
}

export async function getAccount(
  token: string,
): Promise<{ userId: string; username: string }> {
  const params = new URLSearchParams({
    fields: "user_id,username",
    access_token: token,
  });
  const json = await http<{ user_id?: string; id?: string; username: string }>(
    `${GRAPH}/${V}/me?${params.toString()}`,
  );
  return { userId: String(json.user_id ?? json.id ?? ""), username: json.username };
}

/** Create a single-media container; returns the creation id. */
export async function createMediaContainer(
  igUserId: string,
  token: string,
  opts: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    isCarouselItem?: boolean;
    mediaType?: "REELS";
  },
): Promise<string> {
  const params = new URLSearchParams({ access_token: token });
  if (opts.imageUrl) params.set("image_url", opts.imageUrl);
  if (opts.videoUrl) params.set("video_url", opts.videoUrl);
  if (opts.caption) params.set("caption", opts.caption);
  if (opts.isCarouselItem) params.set("is_carousel_item", "true");
  if (opts.mediaType) params.set("media_type", opts.mediaType);
  const json = await http<{ id: string }>(
    `${GRAPH}/${V}/${igUserId}/media`,
    { method: "POST", body: params },
  );
  return json.id;
}

/** Create a CAROUSEL parent container from child creation ids. */
export async function createCarouselContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption?: string,
): Promise<string> {
  const params = new URLSearchParams({
    access_token: token,
    media_type: "CAROUSEL",
    children: childIds.join(","),
  });
  if (caption) params.set("caption", caption);
  const json = await http<{ id: string }>(
    `${GRAPH}/${V}/${igUserId}/media`,
    { method: "POST", body: params },
  );
  return json.id;
}

/** Publish a previously created container. */
export async function publishContainer(
  igUserId: string,
  token: string,
  creationId: string,
): Promise<string> {
  const params = new URLSearchParams({
    access_token: token,
    creation_id: creationId,
  });
  const json = await http<{ id: string }>(
    `${GRAPH}/${V}/${igUserId}/media_publish`,
    { method: "POST", body: params },
  );
  return json.id;
}

export async function getPermalink(
  mediaId: string,
  token: string,
): Promise<string | undefined> {
  try {
    const params = new URLSearchParams({
      fields: "permalink",
      access_token: token,
    });
    const json = await http<{ permalink?: string }>(
      `${GRAPH}/${V}/${mediaId}?${params.toString()}`,
    );
    return json.permalink;
  } catch {
    return undefined;
  }
}

// ── Insights / analytics ──────────────────────────────────────────────
// Metric names are graph-version sensitive (this client targets the configured
// IG_GRAPH_VERSION, default v21.0); several were renamed/deprecated upstream
// (e.g. impressions → views). Each metric block tolerates a missing/invalid
// metric by omitting it rather than failing the whole snapshot. Insights require
// the `instagram_business_manage_insights` scope — a pre-scope token surfaces an
// IgApiError that isPermissionError() flags so the caller can prompt a reconnect.

export interface AccountFields {
  followersCount: number;
  followsCount: number;
  mediaCount: number;
}

/** Account profile counts — available without the insights scope. */
export async function getAccountFields(
  igUserId: string,
  token: string,
): Promise<AccountFields> {
  const params = new URLSearchParams({
    fields: "followers_count,follows_count,media_count",
    access_token: token,
  });
  const json = await http<{
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>(`${GRAPH}/${V}/${igUserId}?${params.toString()}`);
  return {
    followersCount: json.followers_count ?? 0,
    followsCount: json.follows_count ?? 0,
    mediaCount: json.media_count ?? 0,
  };
}

export interface AccountInsights {
  reach: number;
  views: number;
  profileViews: number;
  accountsEngaged: number;
  totalInteractions: number;
}

const ACCOUNT_METRICS = "reach,views,profile_views,accounts_engaged,total_interactions";

/** Account-level totals aggregated over [sinceSec, untilSec] (unix seconds). */
export async function getAccountInsights(
  igUserId: string,
  token: string,
  sinceSec: number,
  untilSec: number,
): Promise<Partial<AccountInsights>> {
  const params = new URLSearchParams({
    metric: ACCOUNT_METRICS,
    period: "day",
    metric_type: "total_value",
    since: String(sinceSec),
    until: String(untilSec),
    access_token: token,
  });
  const json = await http<{
    data?: { name: string; total_value?: { value?: number } }[];
  }>(`${GRAPH}/${V}/${igUserId}/insights?${params.toString()}`);
  const out: Partial<AccountInsights> = {};
  for (const m of json.data ?? []) {
    const v = m.total_value?.value;
    if (typeof v !== "number") continue;
    switch (m.name) {
      case "reach": out.reach = v; break;
      case "views": out.views = v; break;
      case "profile_views": out.profileViews = v; break;
      case "accounts_engaged": out.accountsEngaged = v; break;
      case "total_interactions": out.totalInteractions = v; break;
    }
  }
  return out;
}

export interface Demographics {
  age?: Record<string, number>;
  gender?: Record<string, number>;
  country?: Record<string, number>;
}

// follower_demographics needs ≥100 followers and the insights scope; a smaller
// or newer account simply has no data — tolerate it (omit the breakdown).
async function getDemographicBreakdown(
  igUserId: string,
  token: string,
  breakdown: "age" | "gender" | "country",
): Promise<Record<string, number> | undefined> {
  try {
    const params = new URLSearchParams({
      metric: "follower_demographics",
      period: "lifetime",
      metric_type: "total_value",
      breakdown,
      access_token: token,
    });
    const json = await http<{
      data?: {
        total_value?: {
          breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[];
        };
      }[];
    }>(`${GRAPH}/${V}/${igUserId}/insights?${params.toString()}`);
    const results = json.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const out: Record<string, number> = {};
    for (const r of results) {
      const key = r.dimension_values?.[0];
      if (key && typeof r.value === "number") out[key] = r.value;
    }
    return Object.keys(out).length ? out : undefined;
  } catch (e) {
    if (isPermissionError(e)) throw e; // scope problem must surface as reconnect
    return undefined;
  }
}

export async function getAccountDemographics(
  igUserId: string,
  token: string,
): Promise<Demographics> {
  const [age, gender, country] = await Promise.all([
    getDemographicBreakdown(igUserId, token, "age"),
    getDemographicBreakdown(igUserId, token, "gender"),
    getDemographicBreakdown(igUserId, token, "country"),
  ]);
  return { age, gender, country };
}

export interface MediaItem {
  id: string;
  caption?: string;
  mediaType: string;
  timestamp?: string;
  permalink?: string;
  likeCount: number;
  commentsCount: number;
}

/** Recent media for the account (newest first), with engagement counts. */
export async function getUserMedia(
  igUserId: string,
  token: string,
  limit: number,
): Promise<MediaItem[]> {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,timestamp,permalink,like_count,comments_count",
    limit: String(limit),
    access_token: token,
  });
  const json = await http<{
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      timestamp?: string;
      permalink?: string;
      like_count?: number;
      comments_count?: number;
    }[];
  }>(`${GRAPH}/${V}/${igUserId}/media?${params.toString()}`);
  return (json.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption,
    mediaType: m.media_type ?? "IMAGE",
    timestamp: m.timestamp,
    permalink: m.permalink,
    likeCount: m.like_count ?? 0,
    commentsCount: m.comments_count ?? 0,
  }));
}

export interface MediaInsights {
  reach?: number;
  saved?: number;
  shares?: number;
  totalInteractions?: number;
  views?: number;
}

// Media insights have moved between `values[0].value` and `total_value.value`
// across versions — read whichever is present.
function metricValue(m: {
  total_value?: { value?: number };
  values?: { value?: number }[];
}): number | undefined {
  const v = m.total_value?.value ?? m.values?.[0]?.value;
  return typeof v === "number" ? v : undefined;
}

/** Per-post insights. Tolerant: an unsupported metric for the media type or a
 *  too-fresh post yields a partial/empty object rather than throwing. */
export async function getMediaInsights(
  mediaId: string,
  token: string,
  mediaType: string,
): Promise<MediaInsights> {
  try {
    const isVideo = mediaType === "VIDEO" || mediaType === "REELS";
    const metric = isVideo
      ? "reach,saved,shares,total_interactions,views"
      : "reach,saved,shares,total_interactions";
    const params = new URLSearchParams({ metric, access_token: token });
    const json = await http<{
      data?: {
        name: string;
        total_value?: { value?: number };
        values?: { value?: number }[];
      }[];
    }>(`${GRAPH}/${V}/${mediaId}/insights?${params.toString()}`);
    const out: MediaInsights = {};
    for (const m of json.data ?? []) {
      const v = metricValue(m);
      if (v === undefined) continue;
      switch (m.name) {
        case "reach": out.reach = v; break;
        case "saved": out.saved = v; break;
        case "shares": out.shares = v; break;
        case "total_interactions": out.totalInteractions = v; break;
        case "views": out.views = v; break;
      }
    }
    return out;
  } catch (e) {
    if (isPermissionError(e)) throw e;
    return {};
  }
}

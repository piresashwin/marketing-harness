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

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Instagram API non-JSON response (${res.status}): ${text}`);
  }
  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(
      `Instagram API ${res.status}: ${err.error?.message ?? text}`,
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
    scope: "instagram_business_basic,instagram_business_content_publish",
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

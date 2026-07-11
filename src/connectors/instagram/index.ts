import { randomUUID } from "node:crypto";
import { pool } from "../../db/index.js";
import { env, assertInstagramConfigured } from "../../config/env.js";
import { encrypt, decrypt } from "../../crypto/secrets.js";
import { resolveToPublicUrl, rehostToStore } from "../media/index.js";
import type { Connector, MediaInput, PublishResult } from "../types.js";
import * as graph from "./graph.js";

// A brand's connected Instagram account, as stored in social_accounts.
// access_token is the ENCRYPTED column value; never log or stringify this row
// after decrypt-on-read (pii-auditor note N1) — keep decrypted tokens in locals.
interface SocialAccountRow {
  id: number;
  brand_id: number;
  external_id: string;
  username: string | null;
  access_token: string; // encrypted blob
  token_expires_at: Date | null;
}

// A persisted post with its (optional) per-post insights merged in.
export type AnalyticsPost = graph.MediaItem & graph.MediaInsights;

// The normalized analytics snapshot stored in ig_analytics_snapshots.payload and
// returned to the API/MCP layers. No tokens or secrets — only metrics.
export interface AnalyticsSnapshot {
  account: {
    username: string | null;
    followersCount: number;
    followsCount: number;
    mediaCount: number;
  };
  insights: Partial<graph.AccountInsights>;
  demographics: graph.Demographics;
  posts: AnalyticsPost[];
  rangeDays: number;
}

// Absolute change vs the previous snapshot for the same brand (null on first pull).
export interface AnalyticsDeltas {
  followersCount?: number;
  reach?: number;
  views?: number;
  totalInteractions?: number;
}

export interface AnalyticsResult {
  snapshot: AnalyticsSnapshot;
  fetchedAt: string;
  deltas: AnalyticsDeltas | null;
}

// A compact KPI point distilled from a stored snapshot — drives trend
// sparklines without re-shipping the whole payload. Series is oldest → newest.
export interface AnalyticsHistoryPoint {
  fetchedAt: string;
  followersCount: number;
  reach?: number;
  views?: number;
  totalInteractions?: number;
}

// Thrown when the connected token predates the insights scope. The API/MCP
// layers map this to a "reconnect Instagram" prompt — not a generic failure.
export class InsightsPermissionError extends Error {
  constructor() {
    super("instagram insights permission missing");
    this.name = "InsightsPermissionError";
  }
}

// How many of the most recent posts get a per-post insights call. Bounds the
// Graph API call count (and rate-limit exposure) per analytics pull.
const PER_POST_INSIGHTS_LIMIT = 12;
const MEDIA_FETCH_LIMIT = 25;

function diff(curr: number | undefined, prev: number | undefined): number | undefined {
  if (typeof curr !== "number" || typeof prev !== "number") return undefined;
  return curr - prev;
}

export class InstagramConnector implements Connector {
  readonly id = "instagram";
  readonly name = "Instagram";
  readonly capabilities = ["social.oauth", "social.publish"];
  readonly platform = "instagram";

  isConfigured(): boolean {
    return Boolean(env.instagram.clientId && env.instagram.clientSecret);
  }

  // ── OAuth ───────────────────────────────────────────────────────────
  /** Returns the URL the user opens in a browser to connect a brand's account. */
  async getConnectUrl(brandId: number): Promise<string> {
    assertInstagramConfigured();
    const state = randomUUID();
    // oauth_states still carries the legacy user_key column (NOT NULL); the
    // brand_id column is the new source of truth resolved in the callback.
    await pool.query(
      "INSERT INTO oauth_states (state, provider, user_key, brand_id) VALUES ($1, 'instagram', $2, $3)",
      [state, `brand:${brandId}`, brandId],
    );
    return graph.buildAuthorizeUrl(state);
  }

  /** Handles the OAuth callback: validates state, exchanges code, stores token. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ brandId: number; username: string; igUserId: string }> {
    assertInstagramConfigured();
    const { rows } = await pool.query<{ brand_id: number | null }>(
      "DELETE FROM oauth_states WHERE state = $1 AND provider = 'instagram' RETURNING brand_id",
      [state],
    );
    if (rows.length === 0 || rows[0].brand_id == null) {
      throw new Error("Invalid or expired OAuth state");
    }
    const brandId = rows[0].brand_id;

    const short = await graph.exchangeCodeForToken(code);
    const long = await graph.exchangeForLongLivedToken(short.accessToken);
    const account = await graph.getAccount(long.accessToken);
    const expiresAt = new Date(Date.now() + long.expiresInSec * 1000);
    const externalId = account.userId || short.userId;

    await pool.query(
      `INSERT INTO social_accounts
         (brand_id, platform, external_id, username, access_token, token_expires_at, status, updated_at)
       VALUES ($1, 'instagram', $2, $3, $4, $5, 'connected', now())
       ON CONFLICT (brand_id, platform, external_id) DO UPDATE SET
         username = EXCLUDED.username,
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         status = 'connected',
         updated_at = now()`,
      [brandId, externalId, account.username, encrypt(long.accessToken), expiresAt],
    );
    return { brandId, username: account.username, igUserId: externalId };
  }

  // ── Account state ───────────────────────────────────────────────────
  private async getAccount(brandId: number): Promise<SocialAccountRow | null> {
    const { rows } = await pool.query<SocialAccountRow>(
      `SELECT id, brand_id, external_id, username, access_token, token_expires_at
         FROM social_accounts
        WHERE brand_id = $1 AND platform = 'instagram'
        ORDER BY id
        LIMIT 1`,
      [brandId],
    );
    return rows[0] ?? null;
  }

  /**
   * Returns a valid plaintext token, refreshing if close to expiry and writing
   * the new (encrypted) token back. Decrypt is narrow — the plaintext lives only
   * in this local and is returned to the immediate caller.
   */
  private async getValidToken(account: SocialAccountRow): Promise<string> {
    const token = decrypt(account.access_token);
    const soon = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    if (account.token_expires_at && account.token_expires_at.getTime() < soon) {
      try {
        const refreshed = await graph.refreshLongLivedToken(token);
        const expiresAt = new Date(Date.now() + refreshed.expiresInSec * 1000);
        await pool.query(
          "UPDATE social_accounts SET access_token = $1, token_expires_at = $2, updated_at = now() WHERE id = $3 AND brand_id = $4",
          [encrypt(refreshed.accessToken), expiresAt, account.id, account.brand_id],
        );
        return refreshed.accessToken;
      } catch {
        // Static message + brand id only — never the error text (token risk).
        console.warn(
          "[instagram] token refresh failed for brand " + account.brand_id,
        );
      }
    }
    return token;
  }

  async status(
    brandId: number,
  ): Promise<
    | { connected: false }
    | { connected: true; username: string; externalId: string; tokenExpiresAt: string | null }
  > {
    const account = await this.getAccount(brandId);
    if (!account) return { connected: false };
    const token = await this.getValidToken(account);
    try {
      const live = await graph.getAccount(token);
      return {
        connected: true,
        username: live.username,
        externalId: live.userId,
        tokenExpiresAt: account.token_expires_at?.toISOString() ?? null,
      };
    } catch {
      // Token present but failing — report what we have.
      return {
        connected: true,
        username: account.username ?? "",
        externalId: account.external_id,
        tokenExpiresAt: account.token_expires_at?.toISOString() ?? null,
      };
    }
  }

  // ── Publishing ──────────────────────────────────────────────────────
  async publishImage(
    brandId: number,
    image: MediaInput,
    caption?: string,
  ): Promise<PublishResult> {
    const account = await this.requireAccount(brandId);
    const token = await this.getValidToken(account);
    const imageUrl = await resolveToPublicUrl(image, account.brand_id);

    const postId = await this.logPost(account, "IMAGE", caption, [imageUrl]);
    try {
      const creationId = await graph.createMediaContainer(
        account.external_id,
        token,
        { imageUrl, caption },
      );
      const mediaId = await graph.publishContainer(
        account.external_id,
        token,
        creationId,
      );
      const permalink = await graph.getPermalink(mediaId, token);
      await this.markPublished(postId, account.brand_id, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, account.brand_id, (e as Error).name);
      throw e;
    }
  }

  async publishCarousel(
    brandId: number,
    images: MediaInput[],
    caption?: string,
  ): Promise<PublishResult> {
    if (images.length < 2 || images.length > 10) {
      throw new Error("Carousel requires between 2 and 10 images");
    }
    const account = await this.requireAccount(brandId);
    const token = await this.getValidToken(account);
    const urls = await Promise.all(
      images.map((m) => resolveToPublicUrl(m, account.brand_id)),
    );

    const postId = await this.logPost(account, "CAROUSEL", caption, urls);
    try {
      const childIds = await Promise.all(
        urls.map((imageUrl) =>
          graph.createMediaContainer(account.external_id, token, {
            imageUrl,
            isCarouselItem: true,
          }),
        ),
      );
      const parentId = await graph.createCarouselContainer(
        account.external_id,
        token,
        childIds,
        caption,
      );
      const mediaId = await graph.publishContainer(
        account.external_id,
        token,
        parentId,
      );
      const permalink = await graph.getPermalink(mediaId, token);
      await this.markPublished(postId, account.brand_id, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, account.brand_id, (e as Error).name);
      throw e;
    }
  }

  // ── Scheduling ──────────────────────────────────────────────────────
  /**
   * Resolves media to a public URL immediately (so bytes are stored now), then
   * inserts a posts row with status='scheduled'. The worker picks it up later.
   * Returns the new post id.
   */
  async schedulePost(
    brandId: number,
    opts: { media: MediaInput; caption?: string; scheduledAt: Date },
  ): Promise<number> {
    const account = await this.requireAccount(brandId);
    // Use rehostToStore so ephemeral URLs (e.g. Higgsfield-generated) are copied
    // to a stable MediaStore location before the worker fires at schedule time.
    const publicUrl = await rehostToStore(opts.media, account.brand_id);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO posts
         (user_key, brand_id, social_account_id, media_type, caption, media_urls, status, scheduled_at)
       VALUES ($1, $2, $3, 'IMAGE', $4, $5::jsonb, 'scheduled', $6)
       RETURNING id`,
      [
        `brand:${account.brand_id}`,
        account.brand_id,
        account.id,
        opts.caption ?? null,
        JSON.stringify([publicUrl]),
        opts.scheduledAt,
      ],
    );
    return rows[0].id;
  }

  /**
   * Completes a goal-driven draft (status='draft', caption but no media) with
   * media and a schedule time, turning it into status='scheduled' — the same
   * row, so the worker picks it up and no orphan draft is left behind. The
   * caption passed in overrides the draft's seed hook if provided.
   */
  async promoteDraft(
    brandId: number,
    postId: number,
    opts: { media: MediaInput; caption?: string; scheduledAt: Date },
  ): Promise<void> {
    const account = await this.requireAccount(brandId);
    const publicUrl = await rehostToStore(opts.media, account.brand_id);
    const { rowCount } = await pool.query(
      `UPDATE posts
          SET social_account_id = $1,
              caption = $2,
              media_urls = $3::jsonb,
              status = 'scheduled',
              scheduled_at = $4
        WHERE id = $5 AND brand_id = $6 AND status = 'draft'`,
      [
        account.id,
        opts.caption ?? null,
        JSON.stringify([publicUrl]),
        opts.scheduledAt,
        postId,
        brandId,
      ],
    );
    if (!rowCount) throw new Error("not_found");
  }

  /**
   * Publishes an already-claimed posts row by its id. The row must have been
   * claimed (status='publishing') by the scheduler's atomic UPDATE. Uses the
   * stored public URLs — no re-hosting. Updates the row in-place; does NOT
   * insert a new row. Throws on failure (caller handles markFailed).
   */
  async publishExistingPost(
    postId: number,
    brandId: number,
    mediaUrls: string[],
    mediaType: string,
    caption: string | null,
  ): Promise<void> {
    const account = await this.requireAccount(brandId);
    const token = await this.getValidToken(account);
    // IMAGE: single container + publish. For future CAROUSEL support,
    // mediaType would drive the branch — only IMAGE is scheduled today.
    if (mediaType === "IMAGE" && mediaUrls.length >= 1) {
      const imageUrl = mediaUrls[0];
      const creationId = await graph.createMediaContainer(
        account.external_id,
        token,
        { imageUrl, caption: caption ?? undefined },
      );
      const mediaId = await graph.publishContainer(
        account.external_id,
        token,
        creationId,
      );
      const permalink = await graph.getPermalink(mediaId, token);
      await this.markPublished(postId, brandId, mediaId, permalink);
    } else {
      throw new Error("UnsupportedMediaType");
    }
  }

  // ── Analytics ───────────────────────────────────────────────────────
  /**
   * Pull a fresh analytics snapshot from the Graph API, persist it, and return
   * it with week-over-week deltas vs the previous stored snapshot. Account
   * counts work without the insights scope; insights/demographics/per-post
   * metrics require `instagram_business_manage_insights` — a pre-scope token
   * surfaces InsightsPermissionError so the caller can prompt a reconnect.
   */
  /**
   * Lightweight brand signal for profile autofill: username, follower count,
   * and recent post captions. Uses only the basic profile + media scopes (no
   * insights scope), so it works for any connected account. Captions are the
   * brand's own published copy — fine to pass to the workspace's own LLM, but
   * never logged here.
   */
  async profileSignal(
    brandId: number,
  ): Promise<{ username: string; followersCount: number; captions: string[] }> {
    const account = await this.requireAccount(brandId);
    const token = await this.getValidToken(account);
    const igUserId = account.external_id;
    const [fields, media] = await Promise.all([
      graph.getAccountFields(igUserId, token),
      graph.getUserMedia(igUserId, token, MEDIA_FETCH_LIMIT),
    ]);
    const captions = media
      .map((m) => (m.caption ?? "").trim())
      .filter(Boolean)
      .slice(0, 12);
    return {
      username: account.username ?? "",
      followersCount: fields.followersCount,
      captions,
    };
  }

  async fetchAnalytics(brandId: number, rangeDays: number): Promise<AnalyticsResult> {
    const account = await this.requireAccount(brandId);
    const token = await this.getValidToken(account);
    const igUserId = account.external_id;
    const untilSec = Math.floor(Date.now() / 1000);
    const sinceSec = untilSec - rangeDays * 24 * 60 * 60;

    // Grab the previous snapshot BEFORE inserting this one, for delta math.
    const previous = await this.latestSnapshot(brandId);

    const fields = await graph.getAccountFields(igUserId, token);

    let insights: Partial<graph.AccountInsights> = {};
    try {
      insights = await graph.getAccountInsights(igUserId, token, sinceSec, untilSec);
    } catch (e) {
      if (graph.isPermissionError(e)) throw new InsightsPermissionError();
      // A non-permission insights failure degrades to partial — counts + posts
      // still render. Static log line only (never the raw error → token risk).
      console.warn("[instagram] account insights unavailable for brand " + brandId);
    }

    let demographics: graph.Demographics = {};
    let media: graph.MediaItem[] = [];
    try {
      [demographics, media] = await Promise.all([
        graph.getAccountDemographics(igUserId, token),
        graph.getUserMedia(igUserId, token, MEDIA_FETCH_LIMIT),
      ]);
    } catch (e) {
      if (graph.isPermissionError(e)) throw new InsightsPermissionError();
      throw e;
    }

    const enriched = await Promise.all(
      media.slice(0, PER_POST_INSIGHTS_LIMIT).map(async (m) => ({
        ...m,
        ...(await graph.getMediaInsights(m.id, token, m.mediaType)),
      })),
    );
    const posts: AnalyticsPost[] = [...enriched, ...media.slice(PER_POST_INSIGHTS_LIMIT)];

    const snapshot: AnalyticsSnapshot = {
      account: {
        username: account.username,
        followersCount: fields.followersCount,
        followsCount: fields.followsCount,
        mediaCount: fields.mediaCount,
      },
      insights,
      demographics,
      posts,
      rangeDays,
    };

    await pool.query(
      `INSERT INTO ig_analytics_snapshots (brand_id, social_account_id, range_days, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [account.brand_id, account.id, rangeDays, JSON.stringify(snapshot)],
    );

    const deltas = previous
      ? {
          followersCount: diff(
            snapshot.account.followersCount,
            previous.snapshot.account.followersCount,
          ),
          reach: diff(snapshot.insights.reach, previous.snapshot.insights.reach),
          views: diff(snapshot.insights.views, previous.snapshot.insights.views),
          totalInteractions: diff(
            snapshot.insights.totalInteractions,
            previous.snapshot.insights.totalInteractions,
          ),
        }
      : null;

    return { snapshot, fetchedAt: new Date().toISOString(), deltas };
  }

  /** Most recent stored snapshot for a brand, or null — no Graph API call. */
  async latestAnalytics(brandId: number): Promise<AnalyticsResult | null> {
    return this.latestSnapshot(brandId);
  }

  /**
   * Compact KPI series from the last `limit` stored snapshots for trend
   * sparklines, oldest → newest. Brand-scoped, no Graph API call.
   */
  async analyticsHistory(
    brandId: number,
    limit = 30,
  ): Promise<AnalyticsHistoryPoint[]> {
    const { rows } = await pool.query<{ payload: AnalyticsSnapshot; fetched_at: Date }>(
      `SELECT payload, fetched_at FROM ig_analytics_snapshots
        WHERE brand_id = $1 ORDER BY fetched_at DESC LIMIT $2`,
      [brandId, limit],
    );
    return rows
      .map((r) => ({
        fetchedAt: r.fetched_at.toISOString(),
        followersCount: r.payload.account.followersCount,
        reach: r.payload.insights.reach,
        views: r.payload.insights.views,
        totalInteractions: r.payload.insights.totalInteractions,
      }))
      .reverse();
  }

  private async latestSnapshot(brandId: number): Promise<AnalyticsResult | null> {
    const { rows } = await pool.query<{ payload: AnalyticsSnapshot; fetched_at: Date }>(
      `SELECT payload, fetched_at FROM ig_analytics_snapshots
        WHERE brand_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
      [brandId],
    );
    if (!rows[0]) return null;
    return {
      snapshot: rows[0].payload,
      fetchedAt: rows[0].fetched_at.toISOString(),
      deltas: null,
    };
  }

  // ── Scheduler helpers (called by the publish worker) ────────────────
  /**
   * Marks a scheduled post as failed. `reason` is the Error.name only —
   * never raw provider text or message (which can carry token/PII).
   * Public so the worker can call it without re-importing pool.
   */
  async markScheduledFailed(
    postId: number,
    brandId: number,
    reason: string,
  ): Promise<void> {
    await this.markFailed(postId, brandId, reason);
  }

  // ── helpers ─────────────────────────────────────────────────────────
  private async requireAccount(brandId: number): Promise<SocialAccountRow> {
    const account = await this.getAccount(brandId);
    if (!account) {
      throw new Error(
        `No Instagram account connected for brand ${brandId}. Connect Instagram first.`,
      );
    }
    return account;
  }

  private async logPost(
    account: SocialAccountRow,
    mediaType: string,
    caption: string | undefined,
    urls: string[],
  ): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO posts (user_key, brand_id, social_account_id, media_type, caption, media_urls, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending') RETURNING id`,
      [
        `brand:${account.brand_id}`,
        account.brand_id,
        account.id,
        mediaType,
        caption ?? null,
        JSON.stringify(urls),
      ],
    );
    return rows[0].id;
  }

  private async markPublished(
    id: number,
    brandId: number,
    mediaId: string,
    permalink?: string,
  ): Promise<void> {
    await pool.query(
      "UPDATE posts SET status = 'published', provider_media_id = $1, permalink = $2 WHERE id = $3 AND brand_id = $4 AND status IN ('pending','publishing')",
      [mediaId, permalink ?? null, id, brandId],
    );
  }

  // `reason` is a short, sanitized failure reason (e.g. the Error name) — never
  // raw provider error text, which can contain the access_token.
  private async markFailed(
    id: number,
    brandId: number,
    reason: string,
  ): Promise<void> {
    await pool.query(
      "UPDATE posts SET status = 'failed', error = $1 WHERE id = $2 AND brand_id = $3 AND status IN ('pending','publishing')",
      [reason, id, brandId],
    );
  }
}

export const instagram = new InstagramConnector();

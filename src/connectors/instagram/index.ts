import { randomUUID } from "node:crypto";
import { pool } from "../../db/index.js";
import { env, assertInstagramConfigured } from "../../config/env.js";
import { encrypt, decrypt } from "../../crypto/secrets.js";
import { resolveToPublicUrl } from "../media/index.js";
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
          "UPDATE social_accounts SET access_token = $1, token_expires_at = $2, updated_at = now() WHERE id = $3",
          [encrypt(refreshed.accessToken), expiresAt, account.id],
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
      await this.markPublished(postId, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, (e as Error).name);
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
      await this.markPublished(postId, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, (e as Error).name);
      throw e;
    }
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
    mediaId: string,
    permalink?: string,
  ): Promise<void> {
    await pool.query(
      "UPDATE posts SET status = 'published', provider_media_id = $1, permalink = $2 WHERE id = $3",
      [mediaId, permalink ?? null, id],
    );
  }

  // `reason` is a short, sanitized failure reason (e.g. the Error name) — never
  // raw provider error text, which can contain the access_token.
  private async markFailed(id: number, reason: string): Promise<void> {
    await pool.query("UPDATE posts SET status = 'failed', error = $1 WHERE id = $2", [
      reason,
      id,
    ]);
  }
}

export const instagram = new InstagramConnector();

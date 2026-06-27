import { randomUUID } from "node:crypto";
import { pool } from "../../db/index.js";
import { env, assertInstagramConfigured } from "../../config/env.js";
import { resolveToPublicUrl } from "../media/index.js";
import type { Connector, MediaInput, PublishResult } from "../types.js";
import * as graph from "./graph.js";

interface IgAccount {
  user_key: string;
  ig_user_id: string;
  username: string | null;
  access_token: string;
  token_expires_at: Date | null;
}

export class InstagramConnector implements Connector {
  readonly id = "instagram";
  readonly name = "Instagram";
  readonly capabilities = ["social.oauth", "social.publish"];

  isConfigured(): boolean {
    return Boolean(env.instagram.clientId && env.instagram.clientSecret);
  }

  // ── OAuth ───────────────────────────────────────────────────────────
  /** Returns the URL the user opens in a browser to connect their account. */
  async getConnectUrl(userKey: string): Promise<string> {
    assertInstagramConfigured();
    const state = randomUUID();
    await pool.query(
      "INSERT INTO oauth_states (state, provider, user_key) VALUES ($1, 'instagram', $2)",
      [state, userKey],
    );
    return graph.buildAuthorizeUrl(state);
  }

  /** Handles the OAuth callback: validates state, exchanges code, stores token. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userKey: string; username: string; igUserId: string }> {
    assertInstagramConfigured();
    const { rows } = await pool.query<{ user_key: string }>(
      "DELETE FROM oauth_states WHERE state = $1 AND provider = 'instagram' RETURNING user_key",
      [state],
    );
    if (rows.length === 0) throw new Error("Invalid or expired OAuth state");
    const userKey = rows[0].user_key;

    const short = await graph.exchangeCodeForToken(code);
    const long = await graph.exchangeForLongLivedToken(short.accessToken);
    const account = await graph.getAccount(long.accessToken);
    const expiresAt = new Date(Date.now() + long.expiresInSec * 1000);

    await pool.query(
      `INSERT INTO ig_accounts (user_key, ig_user_id, username, access_token, token_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_key) DO UPDATE SET
         ig_user_id = EXCLUDED.ig_user_id,
         username = EXCLUDED.username,
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = now()`,
      [
        userKey,
        account.userId || short.userId,
        account.username,
        long.accessToken,
        expiresAt,
      ],
    );
    return {
      userKey,
      username: account.username,
      igUserId: account.userId || short.userId,
    };
  }

  // ── Account state ───────────────────────────────────────────────────
  private async getAccount(userKey: string): Promise<IgAccount | null> {
    const { rows } = await pool.query<IgAccount>(
      "SELECT user_key, ig_user_id, username, access_token, token_expires_at FROM ig_accounts WHERE user_key = $1",
      [userKey],
    );
    return rows[0] ?? null;
  }

  /** Returns a valid token, refreshing it if it is close to expiry. */
  private async getValidToken(account: IgAccount): Promise<string> {
    const soon = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    if (account.token_expires_at && account.token_expires_at.getTime() < soon) {
      try {
        const refreshed = await graph.refreshLongLivedToken(account.access_token);
        const expiresAt = new Date(Date.now() + refreshed.expiresInSec * 1000);
        await pool.query(
          "UPDATE ig_accounts SET access_token = $1, token_expires_at = $2, updated_at = now() WHERE user_key = $3",
          [refreshed.accessToken, expiresAt, account.user_key],
        );
        return refreshed.accessToken;
      } catch (e) {
        console.warn("[instagram] token refresh failed:", (e as Error).message);
      }
    }
    return account.access_token;
  }

  async status(
    userKey: string,
  ): Promise<
    | { connected: false }
    | { connected: true; username: string; igUserId: string; tokenExpiresAt: string | null }
  > {
    const account = await this.getAccount(userKey);
    if (!account) return { connected: false };
    const token = await this.getValidToken(account);
    try {
      const live = await graph.getAccount(token);
      return {
        connected: true,
        username: live.username,
        igUserId: live.userId,
        tokenExpiresAt: account.token_expires_at?.toISOString() ?? null,
      };
    } catch {
      // Token present but failing — report what we have.
      return {
        connected: true,
        username: account.username ?? "",
        igUserId: account.ig_user_id,
        tokenExpiresAt: account.token_expires_at?.toISOString() ?? null,
      };
    }
  }

  // ── Publishing ──────────────────────────────────────────────────────
  async publishImage(
    userKey: string,
    image: MediaInput,
    caption?: string,
  ): Promise<PublishResult> {
    const account = await this.requireAccount(userKey);
    const token = await this.getValidToken(account);
    const imageUrl = await resolveToPublicUrl(image);

    const postId = await this.logPost(userKey, "IMAGE", caption, [imageUrl]);
    try {
      const creationId = await graph.createMediaContainer(
        account.ig_user_id,
        token,
        { imageUrl, caption },
      );
      const mediaId = await graph.publishContainer(
        account.ig_user_id,
        token,
        creationId,
      );
      const permalink = await graph.getPermalink(mediaId, token);
      await this.markPublished(postId, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, (e as Error).message);
      throw e;
    }
  }

  async publishCarousel(
    userKey: string,
    images: MediaInput[],
    caption?: string,
  ): Promise<PublishResult> {
    if (images.length < 2 || images.length > 10) {
      throw new Error("Carousel requires between 2 and 10 images");
    }
    const account = await this.requireAccount(userKey);
    const token = await this.getValidToken(account);
    const urls = await Promise.all(images.map((m) => resolveToPublicUrl(m)));

    const postId = await this.logPost(userKey, "CAROUSEL", caption, urls);
    try {
      const childIds = await Promise.all(
        urls.map((imageUrl) =>
          graph.createMediaContainer(account.ig_user_id, token, {
            imageUrl,
            isCarouselItem: true,
          }),
        ),
      );
      const parentId = await graph.createCarouselContainer(
        account.ig_user_id,
        token,
        childIds,
        caption,
      );
      const mediaId = await graph.publishContainer(
        account.ig_user_id,
        token,
        parentId,
      );
      const permalink = await graph.getPermalink(mediaId, token);
      await this.markPublished(postId, mediaId, permalink);
      return { providerMediaId: mediaId, permalink };
    } catch (e) {
      await this.markFailed(postId, (e as Error).message);
      throw e;
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────
  private async requireAccount(userKey: string): Promise<IgAccount> {
    const account = await this.getAccount(userKey);
    if (!account) {
      throw new Error(
        `No Instagram account connected for user "${userKey}". Run ig_get_connect_url first.`,
      );
    }
    return account;
  }

  private async logPost(
    userKey: string,
    mediaType: string,
    caption: string | undefined,
    urls: string[],
  ): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO posts (user_key, media_type, caption, media_urls, status)
       VALUES ($1, $2, $3, $4::jsonb, 'pending') RETURNING id`,
      [userKey, mediaType, caption ?? null, JSON.stringify(urls)],
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

  private async markFailed(id: number, error: string): Promise<void> {
    await pool.query("UPDATE posts SET status = 'failed', error = $1 WHERE id = $2", [
      error,
      id,
    ]);
  }
}

export const instagram = new InstagramConnector();

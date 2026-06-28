import type { Response } from "express";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidTargetError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { pool } from "../../db/index.js";
import { env } from "../../config/env.js";
import { clientsStore } from "./clients.js";
import { sha256, randomToken } from "./crypto.js";

// The single RFC 8707 resource this AS issues tokens for: the MCP endpoint.
// Tokens are bound to this and verifyAccessToken re-checks it (audience binding).
const MCP_RESOURCE = `${env.publicBaseUrl}/mcp`;

const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000; // 10m
const AUTH_CODE_TTL_MS = 2 * 60 * 1000; // 2m
const ACCESS_TTL_MS = 60 * 60 * 1000; // 1h

/** Normalize a resource URL for comparison (drop trailing slash + fragment). */
function normalizeResource(r: URL | string | undefined): string | undefined {
  if (r == null) return undefined;
  const u = new URL(r.toString());
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

const MCP_RESOURCE_NORM = normalizeResource(MCP_RESOURCE)!;

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  // Begin authorization. This handler has NO session/cookies — it persists a
  // pending request and redirects to the consent route, which binds the user.
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const id = randomToken(24);
    const expiresAt = new Date(Date.now() + AUTH_REQUEST_TTL_MS);
    await pool.query(
      `INSERT INTO oauth_authorization_requests
         (id, client_id, redirect_uri, code_challenge, code_challenge_method,
          scopes, state, resource, expires_at)
       VALUES ($1, $2, $3, $4, 'S256', $5::jsonb, $6, $7, $8)`,
      [
        id,
        client.client_id,
        params.redirectUri,
        params.codeChallenge,
        JSON.stringify(params.scopes ?? []),
        params.state ?? null,
        params.resource ? params.resource.toString() : null,
        expiresAt,
      ],
    );
    res.redirect(`${env.publicBaseUrl}/oauth/consent?req=${id}`);
  },

  // Let the SDK perform PKCE verification (skipLocalPkceValidation unset/false).
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const { rows } = await pool.query<{
      code_challenge: string;
      client_id: string;
      used: boolean;
      expires_at: Date;
    }>(
      "SELECT code_challenge, client_id, used, expires_at FROM oauth_auth_codes WHERE code_hash = $1",
      [sha256(authorizationCode)],
    );
    const row = rows[0];
    if (
      !row ||
      row.client_id !== client.client_id ||
      row.used ||
      row.expires_at.getTime() < Date.now()
    ) {
      throw new InvalidGrantError("invalid authorization code");
    }
    return row.code_challenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const codeHash = sha256(authorizationCode);
    const clientForUpdate = await pool.connect();
    try {
      await clientForUpdate.query("BEGIN");
      const { rows } = await clientForUpdate.query<{
        client_id: string;
        user_id: number;
        redirect_uri: string;
        scopes: string[];
        resource: string | null;
        used: boolean;
        expires_at: Date;
      }>(
        "SELECT client_id, user_id, redirect_uri, scopes, resource, used, expires_at FROM oauth_auth_codes WHERE code_hash = $1 FOR UPDATE",
        [codeHash],
      );
      const row = rows[0];
      if (
        !row ||
        row.client_id !== client.client_id ||
        row.used ||
        row.expires_at.getTime() < Date.now()
      ) {
        throw new InvalidGrantError("invalid authorization code");
      }
      if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
        throw new InvalidGrantError("redirect_uri mismatch");
      }
      // The token's audience must be the MCP resource.
      const reqResource = normalizeResource(resource ?? row.resource ?? undefined);
      if (reqResource && reqResource !== MCP_RESOURCE_NORM) {
        throw new InvalidTargetError("resource does not match this server");
      }

      await clientForUpdate.query(
        "UPDATE oauth_auth_codes SET used = true WHERE code_hash = $1",
        [codeHash],
      );

      const tokens = await mintTokens(
        clientForUpdate,
        client.client_id,
        row.user_id,
        row.scopes,
      );
      await clientForUpdate.query("COMMIT");
      return tokens;
    } catch (e) {
      await clientForUpdate.query("ROLLBACK");
      throw e;
    } finally {
      clientForUpdate.release();
    }
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const refreshHash = sha256(refreshToken);
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const { rows } = await conn.query<{
        id: number;
        client_id: string;
        user_id: number;
        scopes: string[];
        revoked: boolean;
      }>(
        "SELECT id, client_id, user_id, scopes, revoked FROM oauth_tokens WHERE refresh_token_hash = $1 FOR UPDATE",
        [refreshHash],
      );
      const row = rows[0];
      if (!row || row.client_id !== client.client_id || row.revoked) {
        throw new InvalidGrantError("invalid refresh token");
      }
      const reqResource = normalizeResource(resource);
      if (reqResource && reqResource !== MCP_RESOURCE_NORM) {
        throw new InvalidTargetError("resource does not match this server");
      }
      // Rotate: revoke the old row, mint a fresh access+refresh pair.
      await conn.query("UPDATE oauth_tokens SET revoked = true WHERE id = $1", [
        row.id,
      ]);
      const grantedScopes = scopes && scopes.length ? scopes : row.scopes;
      const tokens = await mintTokens(
        conn,
        client.client_id,
        row.user_id,
        grantedScopes,
      );
      await conn.query("COMMIT");
      return tokens;
    } catch (e) {
      await conn.query("ROLLBACK");
      throw e;
    } finally {
      conn.release();
    }
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { rows } = await pool.query<{
      client_id: string;
      user_id: number;
      scopes: string[];
      resource: string | null;
      access_expires_at: Date;
      revoked: boolean;
    }>(
      "SELECT client_id, user_id, scopes, resource, access_expires_at, revoked FROM oauth_tokens WHERE access_token_hash = $1",
      [sha256(token)],
    );
    const row = rows[0];
    if (!row || row.revoked || row.access_expires_at.getTime() < Date.now()) {
      throw new InvalidTokenError("token is invalid or expired");
    }
    // Audience binding: the token's resource MUST be this MCP server.
    if (normalizeResource(row.resource ?? undefined) !== MCP_RESOURCE_NORM) {
      throw new InvalidTokenError("token not valid for this resource");
    }
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      expiresAt: Math.floor(row.access_expires_at.getTime() / 1000),
      resource: new URL(MCP_RESOURCE),
      extra: { userId: row.user_id },
    };
  },

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hash = sha256(request.token);
    // RFC 7009: a client may only revoke its OWN tokens. Scope by client_id.
    await pool.query(
      "UPDATE oauth_tokens SET revoked = true WHERE (access_token_hash = $1 OR refresh_token_hash = $1) AND client_id = $2",
      [hash, client.client_id],
    );
  },
};

/** Mint + persist an access/refresh pair bound to the MCP resource. */
async function mintTokens(
  conn: { query: typeof pool.query },
  clientId: string,
  userId: number,
  scopes: string[],
): Promise<OAuthTokens> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  try {
    await conn.query(
      `INSERT INTO oauth_tokens
         (access_token_hash, refresh_token_hash, client_id, user_id, scopes, resource, access_expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        sha256(accessToken),
        sha256(refreshToken),
        clientId,
        userId,
        JSON.stringify(scopes),
        MCP_RESOURCE,
        accessExpiresAt,
      ],
    );
  } catch {
    throw new ServerError("could not issue token");
  }
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  };
}

export { MCP_RESOURCE };

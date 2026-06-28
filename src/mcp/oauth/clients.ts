import { pool } from "../../db/index.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomToken } from "./crypto.js";

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string | null;
  token_endpoint_auth_method: string;
  client_id_issued_at: string; // bigint -> string
  client_secret_expires_at: string | null;
}

function rowToClient(r: ClientRow): OAuthClientInformationFull {
  return {
    client_id: r.client_id,
    // We never store or return the raw secret after registration; confidential
    // clients authenticate by presenting it and the SDK compares (see note below).
    redirect_uris: r.redirect_uris,
    grant_types: r.grant_types,
    response_types: r.response_types,
    token_endpoint_auth_method: r.token_endpoint_auth_method,
    client_name: r.client_name ?? undefined,
    scope: r.scope ?? undefined,
    client_id_issued_at: Number(r.client_id_issued_at),
    client_secret_expires_at:
      r.client_secret_expires_at != null
        ? Number(r.client_secret_expires_at)
        : undefined,
  };
}

export const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    const { rows } = await pool.query<ClientRow>(
      "SELECT * FROM oauth_clients WHERE client_id = $1",
      [clientId],
    );
    return rows[0] ? rowToClient(rows[0]) : undefined;
  },

  async registerClient(client) {
    const clientId = randomToken(16);
    const issuedAt = Math.floor(Date.now() / 1000);

    // We support ONLY public PKCE clients (the MCP norm). The SDK authenticates
    // confidential clients by comparing the presented secret to client_secret
    // from getClient — which is incompatible with hash-only storage, so a stored
    // secret would never actually be verified (security theater). We therefore
    // force token_endpoint_auth_method = "none", never generate/store/return a
    // client_secret, and rely on PKCE (already enforced) for client protection.
    await pool.query(
      `INSERT INTO oauth_clients
         (client_id, client_secret_hash, client_name, redirect_uris, grant_types,
          response_types, scope, token_endpoint_auth_method, client_id_issued_at)
       VALUES ($1, NULL, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, 'none', $7)`,
      [
        clientId,
        client.client_name ?? null,
        JSON.stringify(client.redirect_uris ?? []),
        JSON.stringify(client.grant_types ?? ["authorization_code", "refresh_token"]),
        JSON.stringify(client.response_types ?? ["code"]),
        client.scope ?? null,
        issuedAt,
      ],
    );

    // The SDK's register handler pre-injects a client_secret onto the incoming
    // `client` object (based on the REQUESTED auth method). Strip it so the DCR
    // response never advertises a secret we don't store and never verify.
    const { client_secret, client_secret_expires_at, ...rest } = client;
    void client_secret;
    void client_secret_expires_at;
    return {
      ...rest,
      client_id: clientId,
      client_id_issued_at: issuedAt,
      token_endpoint_auth_method: "none",
    };
  },
};

import { createHash, randomBytes } from "node:crypto";

// OAuth secret handling: we persist only SHA-256 hashes of codes/secrets/tokens,
// never the raw value. Raw values exist only transiently (returned to the client
// once, then forgotten). Tokens/codes are generated from crypto.randomBytes.

/** Hex SHA-256 of a value — the only form that touches the DB. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A high-entropy URL-safe opaque token/code. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

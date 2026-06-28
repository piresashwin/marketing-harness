import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "../config/env.js";

// AES-256-GCM encryption-at-rest for connector secrets and OAuth tokens.
//
// Wire format (compact, self-describing):
//   v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>
// where iv is a 12-byte random nonce and tag is the 16-byte GCM auth tag.
//
// The key comes from APP_ENCRYPTION_KEY (32 bytes, hex-encoded => 64 hex chars).
// We don't crash the whole app at import if it's missing — instead we surface a
// clear error the moment encrypt()/decrypt() is actually used.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PREFIX = "v1";

function parseKey(hex: string, name: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be 32 bytes hex-encoded (64 hex characters).`);
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly 32 bytes.`);
  }
  return key;
}

/** The primary key — used by encrypt() and tried first by decrypt(). */
function loadKey(): Buffer {
  const hex = env.appEncryptionKey;
  if (!hex) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.",
    );
  }
  return parseKey(hex, "APP_ENCRYPTION_KEY");
}

/** The optional previous key, used ONLY as a decrypt fallback during rotation. */
function loadOldKey(): Buffer | null {
  const hex = env.appEncryptionKeyOld;
  if (!hex) return null;
  return parseKey(hex, "APP_ENCRYPTION_KEY_OLD");
}

/** True when a valid 32-byte hex key is configured. */
export function isConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt UTF-8 plaintext into the compact `v1:iv:tag:ciphertext` format. */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decryptWith(key: Buffer, parts: string[]): string {
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Decrypt a `v1:iv:tag:ciphertext` blob. Tries the primary key first; on an
 * auth-tag failure, falls back to APP_ENCRYPTION_KEY_OLD if set (rotation).
 * Throws on tamper / bad format / no key matching.
 */
export function decrypt(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Malformed ciphertext blob.");
  }
  try {
    return decryptWith(loadKey(), parts);
  } catch (primaryErr) {
    const old = loadOldKey();
    if (old) {
      try {
        return decryptWith(old, parts);
      } catch {
        // fall through to throw the primary error
      }
    }
    throw primaryErr;
  }
}

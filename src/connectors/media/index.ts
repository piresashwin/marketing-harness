import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { env } from "../../config/env.js";
import type { MediaInput } from "../types.js";
import { S3MediaStore } from "./s3.js";
import { LocalMediaStore } from "./local.js";
import {
  contentTypeFromKey,
  extFromContentType,
  type MediaStore,
} from "./store.js";

export const mediaStore: MediaStore =
  env.media.store === "local" ? new LocalMediaStore() : new S3MediaStore();

/**
 * Resolves a MediaInput to a public URL Instagram can fetch.
 * - `url`: returned as-is (assumed already public).
 * - `path`/`base64`: uploaded to the MediaStore, public URL returned.
 *
 * `brandId` is the VERIFIED owning brand (from server-side context, never client
 * input); it namespaces stored objects under `brands/<brandId>/...` for
 * defense-in-depth + lifecycle scoping.
 */
export async function resolveToPublicUrl(
  input: MediaInput,
  brandId: number,
): Promise<string> {
  if (input.url) return input.url;

  let body: Buffer;
  let contentType = input.contentType ?? "application/octet-stream";

  if (input.path) {
    body = await readFile(input.path);
    if (!input.contentType) contentType = contentTypeFromKey(input.path);
  } else if (input.base64) {
    body = Buffer.from(input.base64, "base64");
  } else {
    throw new Error("MediaInput requires one of: url, path, base64");
  }

  const ext = extFromContentType(contentType);
  const date = new Date().toISOString().slice(0, 10);
  const key = `brands/${brandId}/${date}/${randomUUID()}.${ext}`;
  const { url } = await mediaStore.put(key, body, contentType);
  return url;
}

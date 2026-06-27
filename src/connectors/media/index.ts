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
 */
export async function resolveToPublicUrl(input: MediaInput): Promise<string> {
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
  const key = `media/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const { url } = await mediaStore.put(key, body, contentType);
  return url;
}

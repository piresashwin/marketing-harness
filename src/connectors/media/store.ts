export interface PutResult {
  /** Publicly fetchable URL (Instagram must be able to GET this). */
  url: string;
  key: string;
}

export interface MediaStore {
  readonly kind: "s3" | "local";
  /** Stores bytes and returns a public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<PutResult>;
  /** Called once at startup to provision buckets/dirs. */
  init(): Promise<void>;
  /** Deletes all objects under a key prefix (e.g. "brands/<id>/"). */
  deletePrefix(prefix: string): Promise<void>;
}

const EXT_TO_CT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function contentTypeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_CT[ext] ?? "application/octet-stream";
}

export function extFromContentType(ct: string): string {
  const found = Object.entries(EXT_TO_CT).find(([, v]) => v === ct);
  return found?.[0] ?? "bin";
}

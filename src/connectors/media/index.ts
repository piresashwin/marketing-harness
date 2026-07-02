import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
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

// Max response body for a remote media fetch (15 MB).
const REMOTE_FETCH_MAX_BYTES = 15 * 1024 * 1024;
// Request timeout for remote media fetch (10 s).
const REMOTE_FETCH_TIMEOUT_MS = 10_000;

/** True if an IPv4 literal falls in a loopback/private/reserved range. */
function isBlockedIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, a, b, c] = m.map(Number);
  return (
    a === 127 || // 127.0.0.0/8  loopback
    a === 10 || // 10.0.0.0/8   private
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. cloud metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a === 0 || // 0.0.0.0/8
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 TEST-NET-1
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) // 203.0.113.0/24 TEST-NET-3
  );
}

/** True if an IPv6 literal is loopback / ULA / link-local, incl. v4-mapped. */
function isBlockedIpv6(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped IPv6 in hex-group form: ::ffff:7f00:1  or  0:0:0:0:0:ffff:7f00:1
  const hexMapped = h.match(/^(?:0*:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isBlockedIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // IPv4-mapped (::ffff:127.0.0.1) — validate the embedded v4.
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return (
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    h === "::" ||
    h.startsWith("fc") || // fc00::/7 ULA
    h.startsWith("fd") ||
    h.startsWith("fe80") // link-local
  );
}

/**
 * SSRF guard for a remote media URL. Rejects non-`https:` schemes, then
 * RESOLVES the hostname via DNS and rejects if ANY resolved address is
 * loopback/private/reserved — this is what stops a public hostname that points
 * at 127.0.0.1 or the cloud-metadata endpoint (169.254.169.254). Literal
 * hostnames are checked directly too. Async because it does a DNS lookup.
 *
 * Residual risk: a DNS-rebind between this check and the kernel's fetch resolve
 * (TOCTOU) is not fully closed without pinning the connection to the validated
 * IP; egress controls on the host remain the backstop. Redirects are handled by
 * the caller, which re-runs this guard on every hop.
 */
async function assertSafeRemoteUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("could not fetch media");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("could not fetch media");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("could not fetch media");
  }
  // Literal-IP hosts: check directly (no DNS needed).
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
    throw new Error("could not fetch media");
  }

  // Hostname: resolve and reject if any address lands in a blocked range.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("could not fetch media");
  }
  for (const { address, family } of addrs) {
    if (family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address)) {
      throw new Error("could not fetch media");
    }
  }
}

// Bound how many redirect hops we'll follow (each re-validated by the guard).
const REMOTE_FETCH_MAX_REDIRECTS = 3;

/**
 * Re-hosts a MediaInput to the MediaStore, always producing a stable stored
 * copy. Use this for SCHEDULED posts so the URL remains valid at publish time.
 *
 * - `path`/`base64`: same as resolveToPublicUrl — upload bytes directly.
 * - `url`: fetches the bytes server-side (SSRF-guarded, image/* only, 15 MB cap,
 *   10 s timeout) and stores them under `brands/<brandId>/<date>/<uuid>.<ext>`.
 *
 * Never logs the source URL or response bytes. Throws a safe enumerated error on
 * any SSRF violation, bad content type, size over-run, or fetch failure.
 */
export async function rehostToStore(
  input: MediaInput,
  brandId: number,
): Promise<string> {
  // Non-URL inputs: delegate to the existing upload path.
  if (!input.url) {
    return resolveToPublicUrl(input, brandId);
  }

  // --- Server-side fetch of a remote URL ---
  // Follow redirects manually so the SSRF guard re-runs on every hop — an
  // allowed host must not be able to 3xx-redirect us to an internal address.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);

  let resp: Response;
  try {
    let current = input.url;
    for (let hop = 0; ; hop++) {
      await assertSafeRemoteUrl(current);
      resp = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
      });
      if (resp.status < 300 || resp.status >= 400) break;
      const location = resp.headers.get("location");
      if (!location || hop >= REMOTE_FETCH_MAX_REDIRECTS) {
        throw new Error("could not fetch media");
      }
      current = new URL(location, current).href;
    }
  } catch {
    // Network error, abort, redirect overrun, or SSRF rejection — never echo
    // the URL or the underlying error.
    throw new Error("could not fetch media");
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error("could not fetch media");
  }

  // Enforce image/* content type.
  const rawCt = resp.headers.get("content-type") ?? "";
  const contentType = rawCt.split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("unsupported media");
  }

  // Cap body size — read via arrayBuffer to avoid streaming partial reads.
  const contentLength = Number(resp.headers.get("content-length") ?? "0");
  if (contentLength > REMOTE_FETCH_MAX_BYTES) {
    throw new Error("could not fetch media");
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength > REMOTE_FETCH_MAX_BYTES) {
    throw new Error("could not fetch media");
  }

  const body = Buffer.from(buf);
  const ext = extFromContentType(contentType) || "bin";
  const date = new Date().toISOString().slice(0, 10);
  const key = `brands/${brandId}/${date}/${randomUUID()}.${ext}`;
  const { url: storedUrl } = await mediaStore.put(key, body, contentType);
  return storedUrl;
}

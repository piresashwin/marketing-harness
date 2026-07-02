import { lookup } from "node:dns/promises";

// Lightweight, dependency-free website signal extractor. Given a URL the user
// owns, it fetches the page over the public internet and pulls the brand signal
// a profile draft can be grounded in: title, meta/OG description, site name,
// theme colour, headings, and a bounded text excerpt.
//
// Security posture (this fetches an arbitrary user-supplied URL, server-side):
//  - SSRF guard: only http(s); every resolved address is checked against
//    private / loopback / link-local ranges, and redirects are followed
//    MANUALLY so each hop is re-validated (a public host can't 30x us onto an
//    internal one).
//  - Bounded: 8s timeout, ≤3 redirect hops, content-type must be HTML, body
//    read is capped. Never logs the URL or page content.
//  - Failures map to a small enumerated set so callers return safe messages.

export interface SiteSignal {
  url: string;
  title: string;
  description: string;
  siteName: string;
  themeColor: string;
  headings: string[];
  text: string;
}

// Enumerated, client-safe failure codes (the route maps these to messages).
export type SiteExtractError =
  | "invalid_url"
  | "blocked_host"
  | "unreachable"
  | "not_html"
  | "timeout";

function fail(code: SiteExtractError): Error {
  return new Error(code);
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2_000_000; // 2 MB of HTML is plenty for the <head> + copy.
const TEXT_MAX = 4_000;

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw fail("invalid_url");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw fail("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw fail("invalid_url");
  return url;
}

// True for addresses that must never be reached from a user-supplied URL.
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique-local
  if (v6.startsWith("fe80")) return true; // link-local
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7)); // v4-mapped
  return false;
}

// Resolves the host and rejects if it points anywhere private. Run on the
// initial URL and on every redirect target.
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw fail("blocked_host");
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw fail("unreachable");
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw fail("blocked_host");
  }
}

// Fetch one URL with no automatic redirects, re-validating the host first.
async function fetchNoRedirect(url: URL): Promise<Response> {
  await assertPublicHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": "marketing-harness/1.0 (+brand-import)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw fail(controller.signal.aborted ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

// Follow up to MAX_REDIRECTS hops manually so every hop is re-validated.
async function fetchHtml(start: URL): Promise<{ url: URL; html: string }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchNoRedirect(url);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw fail("unreachable");
      try {
        url = new URL(location, url);
      } catch {
        throw fail("unreachable");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw fail("blocked_host");
      continue;
    }
    if (!res.ok) throw fail("unreachable");
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) throw fail("not_html");
    return { url, html: await readCapped(res) };
  }
  throw fail("unreachable");
}

// Read the body but stop once we've seen enough HTML (head + lead copy).
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= MAX_BODY_BYTES) break;
    }
  } catch {
    throw fail("unreachable");
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function collapse(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

// Pull a <meta> content value by matching name= OR property= regardless of
// attribute order (content can sit before or after the key).
function metaContent(html: string, key: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (new RegExp(`(?:name|property)\\s*=\\s*["']${k}["']`, "i").test(tag)) {
      const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
      if (c) return collapse(c[1]);
    }
  }
  return "";
}

function extract(html: string, finalUrl: URL): SiteSignal {
  // Drop script/style/noscript so their contents don't pollute the text.
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const titleMatch = stripped.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? collapse(titleMatch[1]) : "";

  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const siteName = metaContent(html, "og:site_name");
  const themeColor = metaContent(html, "theme-color");

  const headings: string[] = [];
  const hRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(stripped)) && headings.length < 12) {
    const t = collapse(hm[1].replace(/<[^>]+>/g, " "));
    if (t && !headings.includes(t)) headings.push(t);
  }

  const bodyMatch = stripped.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const text = collapse((bodyMatch ? bodyMatch[1] : stripped).replace(/<[^>]+>/g, " ")).slice(
    0,
    TEXT_MAX,
  );

  return {
    url: `${finalUrl.protocol}//${finalUrl.host}${finalUrl.pathname}`,
    title,
    description,
    siteName,
    themeColor,
    headings,
    text,
  };
}

/**
 * Fetch a user-supplied site URL and extract its brand signal. Throws an Error
 * whose message is a `SiteExtractError` code on any failure.
 */
export async function fetchSiteSignal(rawUrl: string): Promise<SiteSignal> {
  const url = normalizeUrl(rawUrl);
  const { url: finalUrl, html } = await fetchHtml(url);
  const signal = extract(html, finalUrl);
  if (!signal.title && !signal.description && !signal.text) throw fail("not_html");
  return signal;
}

/** Render a SiteSignal into the bounded prompt text the draft task ingests. */
export function siteSignalToText(s: SiteSignal): string {
  const lines = [`URL: ${s.url}`];
  if (s.siteName) lines.push(`Site name: ${s.siteName}`);
  if (s.title) lines.push(`Page title: ${s.title}`);
  if (s.description) lines.push(`Meta description: ${s.description}`);
  if (s.themeColor) lines.push(`Theme colour: ${s.themeColor}`);
  if (s.headings.length) lines.push(`Headings: ${s.headings.join(" | ")}`);
  if (s.text) lines.push(`Page content: ${s.text}`);
  return lines.join("\n");
}

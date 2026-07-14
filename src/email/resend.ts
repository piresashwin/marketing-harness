import { env } from "../config/env.js";

function emailHtml(link: string): string {
  return `
  <div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:440px;margin:0 auto;padding:32px">
    <h2 style="margin:0 0 8px">Sign in to Inflxr</h2>
    <p style="color:#475569;margin:0 0 24px">Click the button below to sign in. This link expires in 15 minutes.</p>
    <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Sign in</a>
    <p style="color:#94a3b8;font-size:13px;margin:24px 0 0">If you didn't request this, you can ignore this email.</p>
  </div>`;
}

/**
 * Sends a magic-link email via Resend. If no API key is configured, falls back
 * to logging the link (and returning it in non-production) so dev still works.
 */
export async function sendMagicLinkEmail(
  to: string,
  link: string,
): Promise<{ delivered: boolean; devLink?: string }> {
  if (!env.email.resendApiKey) {
    // Dev fallback only — never in prod, and never log the recipient email (PII).
    if (!env.isProd) {
      console.log(`\n[auth] Magic link (dev):\n  ${link}\n`);
      return { delivered: false, devLink: link };
    }
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.email.from,
      to,
      subject: "Your sign-in link",
      html: emailHtml(link),
    }),
  });
  if (!res.ok) {
    // Never surface the raw provider body (may echo recipient/PII). Status only.
    console.error("[email] resend send failed:", res.status);
    throw new Error("email send failed");
  }
  return { delivered: true };
}

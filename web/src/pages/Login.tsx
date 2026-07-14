import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Loader2,
  MailCheck,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import { api } from "../api";
import { Button, Input } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";

/**
 * Passwordless sign-in / sign-up. One flow does both — requesting a magic link
 * either finds the account or creates it. Split layout: a fixed-dark "console"
 * brand panel on the left (a taste of the product) and the email form on the
 * right. The dark panel is intentionally dark in both themes — it reads as the
 * product screen.
 */
export function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    setDevLink(null);
    try {
      const res = await api.requestMagicLink(email);
      setStatus("sent");
      setDevLink(res.devLink ?? null);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* ── Brand / console panel (lg+) ─────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-[#0d1120] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        {/* ambient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[460px] w-[460px] rounded-full bg-brand-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-[380px] w-[380px] rounded-full bg-emerald-500/10 blur-3xl"
        />

        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-base font-extrabold shadow-lg shadow-brand-600/40">
            i
          </span>
          <span className="text-lg font-semibold tracking-tight">Inflxr</span>
        </Link>

        <div className="relative max-w-md">
          <p className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-brand-200">
            Autonomous social marketing
          </p>
          <h2 className="font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-balance">
            Marketing that runs itself.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-white/60">
            Give it one goal. It plans the calendar, writes the captions,
            generates the visuals, and publishes — in your brand's voice.
          </p>

          <ul className="mt-9 space-y-4">
            <FeatureRow icon={Target} title="State a goal">
              Turn one outcome into an approvable two-week plan.
            </FeatureRow>
            <FeatureRow icon={Sparkles} title="On-brand by default">
              Captions, images and video, generated in your voice.
            </FeatureRow>
            <FeatureRow icon={Send} title="Publishes itself">
              Scheduled to Instagram, server-side, hands-free.
            </FeatureRow>
          </ul>
        </div>

        <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.7rem] text-white/40">
          <span className="text-white/30">Bring your own keys —</span>
          <span className="text-white/70">Claude</span>
          <span>·</span>
          <span className="text-white/70">FLUX</span>
          <span>·</span>
          <span className="text-white/70">Kling</span>
          <span>·</span>
          <span className="text-white/70">ElevenLabs</span>
        </div>
      </aside>

      {/* ── Form panel ──────────────────────────────────────────── */}
      <main className="relative flex min-h-full items-center justify-center bg-canvas px-5 py-14">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* compact brand mark (carries brand on mobile) */}
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-2 lg:hidden"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-base font-extrabold text-white">
              i
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink">
              Inflxr
            </span>
          </Link>

          {status === "sent" ? (
            <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-fg">
                <MailCheck className="h-6 w-6" />
              </div>
              <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">
                Check your inbox
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                We sent a sign-in link to{" "}
                <span className="font-medium text-ink">{email}</span>. It expires
                in a few minutes — open it on this device.
              </p>

              {devLink && (
                <a
                  href={devLink}
                  className="mt-5 block break-all rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5 font-mono text-xs text-accent-soft-fg transition hover:bg-accent-soft/70"
                >
                  Dev link (no email configured) — open →
                </a>
              )}

              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setMessage("");
                }}
                className="mt-6 w-full rounded-lg py-1.5 text-sm font-medium text-faint outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
                Sign in or sign up
              </p>
              <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-ink text-balance">
                Welcome to Inflxr
              </h1>
              <p className="mt-2 text-[0.95rem] text-muted">
                Enter your email and we'll send a magic link. No password to
                remember, ever.
              </p>

              {params.get("error") && status !== "error" && (
                <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                  That sign-in link was invalid or expired. Request a new one
                  below.
                </div>
              )}

              <form
                onSubmit={submit}
                className="mt-6 rounded-2xl border border-line bg-surface p-6 shadow-sm"
              >
                <label
                  htmlFor="login-email"
                  className="mb-1.5 block text-sm font-medium text-ink"
                >
                  Email address
                </label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="py-2.5 text-base"
                />

                {status === "error" && (
                  <p
                    role="alert"
                    className="mt-2 text-sm text-red-600 dark:text-red-400"
                  >
                    {message}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={status === "sending"}
                  className="mt-4 w-full py-2.5 text-base"
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      Sending link…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Send magic link
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                <p className="mt-3.5 text-center text-xs text-faint">
                  New here? Your account is created automatically.
                </p>
              </form>

              <p className="mt-6 text-center text-xs leading-relaxed text-faint">
                By continuing you agree to bring your own provider keys. Your
                data stays yours — export or delete it anytime.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Target;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-brand-200">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div>
        <div className="text-sm font-semibold text-white/90">{title}</div>
        <div className="text-sm leading-snug text-white/50">{children}</div>
      </div>
    </li>
  );
}

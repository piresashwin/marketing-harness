import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../api";

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
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white">
            M
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Marketing Harness
          </h1>
          <p className="mt-1 text-sm text-muted">
            Sign in with your email — no password needed.
          </p>
        </div>

        {params.get("error") && status === "idle" && (
          <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-400/20">
            That sign-in link was invalid or expired. Request a new one.
          </div>
        )}

        {status === "sent" ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
            <div className="mb-2 text-3xl">✉️</div>
            <h2 className="font-medium text-ink">Check your inbox</h2>
            <p className="mt-1 text-sm text-muted">
              We sent a sign-in link to <b>{email}</b>.
            </p>
            {devLink && (
              <a
                href={devLink}
                className="mt-4 inline-block break-all rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-soft-fg underline"
              >
                Dev link (no email configured): open
              </a>
            )}
            <button
              onClick={() => setStatus("idle")}
              className="mt-4 block w-full text-sm text-faint hover:text-muted outline-none focus-visible:ring-2 focus-visible:ring-brand-100 rounded"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-2xl border border-line bg-surface p-6 shadow-sm"
          >
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {status === "error" && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{message}</p>
            )}
            <button
              type="submit"
              disabled={status === "sending"}
              className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-brand-100 inline-flex items-center justify-center gap-2"
            >
              {status === "sending" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Sending…
                </>
              ) : (
                "Send magic link"
              )}
            </button>
            <p className="mt-3 text-center text-xs text-faint">
              New here? A profile is created automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

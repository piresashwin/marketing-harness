import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
          <h1 className="text-2xl font-semibold tracking-tight">
            Marketing Harness
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with your email — no password needed.
          </p>
        </div>

        {params.get("error") && status === "idle" && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            That sign-in link was invalid or expired. Request a new one.
          </div>
        )}

        {status === "sent" ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="mb-2 text-3xl">✉️</div>
            <h2 className="font-medium">Check your inbox</h2>
            <p className="mt-1 text-sm text-slate-500">
              We sent a sign-in link to <b>{email}</b>.
            </p>
            {devLink && (
              <a
                href={devLink}
                className="mt-4 inline-block break-all rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 underline"
              >
                Dev link (no email configured): open
              </a>
            )}
            <button
              onClick={() => setStatus("idle")}
              className="mt-4 block w-full text-sm text-slate-400 hover:text-slate-600"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {status === "error" && (
              <p className="mt-2 text-sm text-red-600">{message}</p>
            )}
            <button
              type="submit"
              disabled={status === "sending"}
              className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">
              New here? A profile is created automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Globe, Loader2, PenLine, Sparkles } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { Button, Textarea } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || ""
  );
}

type Mode = "website" | "manual";

/**
 * First-run welcome (shown only when the user has zero brands). Names the first
 * brand, then offers two starting points: import branding from a website (the
 * backend scrapes it and Claude drafts the profile) or describe it in a
 * sentence. Either way the brand is created empty and the profile opens in
 * onboarding mode — the chosen source is handed forward via route state so the
 * DraftHero autofills from it.
 */
export function Welcome() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { switchBrand, refresh } = useBrand();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("website");
  const [url, setUrl] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const firstName = (me?.user.email ?? "").split("@")[0];

  const start = async () => {
    const slug = slugify(name);
    if (!name.trim() || !slug) {
      setError("Give your brand a name to get started.");
      return;
    }
    if (mode === "website" && !url.trim()) {
      setError("Add your website address, or switch to describing it yourself.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { id } = await api.createBrand({ name: name.trim(), slug });
      await refresh();
      await switchBrand(id);
      navigate(`/brands/${id}/settings`, {
        state:
          mode === "website"
            ? { sourceUrl: url.trim(), onboarding: true }
            : { seed: seed.trim() || undefined, onboarding: true },
        replace: true,
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(
        err.status === 409
          ? "You already have a brand with that name — try another."
          : err.message || "Couldn't create your brand.",
      );
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && !!name.trim() && (mode === "manual" || !!url.trim());

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-canvas px-4 py-16">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <span className="font-semibold text-ink">Harness</span>
        </div>

        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-accent">
          Welcome{firstName ? `, ${firstName}` : ""}
        </p>
        <h1 className="font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-ink text-balance">
          Let's bring your first brand to life.
        </h1>
        <p className="mt-4 max-w-md text-muted">
          Name it, then pick how to start. We'll draft a full profile — belief,
          voice, audience and content themes — for you to shape.
        </p>

        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <label
            htmlFor="brand-name"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Brand name
          </label>
          <input
            id="brand-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zenith Studio"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink placeholder:text-faint outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />

          <div className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-wide text-muted">
            How do you want to start?
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={mode === "website"}
              icon={Globe}
              title="From my website"
              subtitle="We'll read it and autofill"
              onClick={() => setMode("website")}
            />
            <ModeCard
              active={mode === "manual"}
              icon={PenLine}
              title="Describe it myself"
              subtitle="Start from one sentence"
              onClick={() => setMode("manual")}
            />
          </div>

          {mode === "website" ? (
            <div className="mt-4">
              <label
                htmlFor="brand-url"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Website address
              </label>
              <input
                id="brand-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && void start()}
                placeholder="yourbrand.com"
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink placeholder:text-faint outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <p className="mt-1.5 text-xs text-faint">
                We read your public homepage to draft a starting profile. Nothing
                is published.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <label
                htmlFor="brand-seed"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted"
              >
                What's it about?{" "}
                <span className="font-normal normal-case text-faint">
                  optional
                </span>
              </label>
              <Textarea
                id="brand-seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                rows={3}
                className="text-base"
                placeholder="A booking app that helps indie barbers fill empty chairs."
              />
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-5">
            <Button
              onClick={() => void start()}
              disabled={!canSubmit}
              className="w-full justify-center"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {busy
                ? "Creating…"
                : mode === "website"
                  ? "Import & draft my profile"
                  : "Create & draft my profile"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: typeof Globe;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 ${
        active
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-surface hover:bg-hover"
      }`}
    >
      <Icon className={`h-5 w-5 ${active ? "text-accent" : "text-muted"}`} />
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-xs text-faint">{subtitle}</span>
    </button>
  );
}

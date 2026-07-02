import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Camera,
  PenLine,
  Sparkles,
  UserRound,
} from "lucide-react";
import { api, type BrandDetail, type IgStatus } from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { staggerStyle } from "../components/motion";
import { Card } from "../components/ui";

/** Profile completeness, mirroring the strength meter on the brand profile. */
function profileStrength(detail: BrandDetail | null): number {
  if (!detail) return 0;
  const s = detail.settings;
  const voice = s.voice ?? {};
  const tone = Array.isArray(voice.tone) ? voice.tone : [];
  const are = Array.isArray(voice.are) ? voice.are : [];
  const guidelines = typeof voice.guidelines === "string" ? voice.guidelines : "";
  const checks = [
    (s.why ?? "").trim().length > 20,
    tone.length > 0,
    are.length > 0 || guidelines.trim().length > 15,
    (s.description ?? "").trim().length > 15,
    (s.audience ?? "").trim().length > 15,
    detail.pillars.length >= 3,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function BrandHome() {
  const { me } = useAuth();
  const { activeBrand, activeBrandId } = useBrand();
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const aiReady = useMemo(
    () => (me?.workspaceConnectors ?? []).some((c) => c.provider === "anthropic"),
    [me],
  );

  const load = useCallback(async () => {
    if (activeBrandId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [d, status] = await Promise.all([
        api.getBrand(activeBrandId),
        api.igStatus(activeBrandId).catch(() => ({ connected: false })),
      ]);
      setDetail(d);
      setIg(status);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const strength = profileStrength(detail);
  const brandName = activeBrand?.name ?? "your brand";

  return (
    <AppShell title="Home" subtitle={activeBrand?.name}>
      <div className="space-y-8">
        <header>
          <p className="text-sm text-muted">Welcome back</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {brandName}
          </h1>
        </header>

        {!aiReady && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Connect Claude in{" "}
              <Link to="/settings" className="font-semibold underline">
                Settings
              </Link>{" "}
              to draft and refine content with AI.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NextStep
            index={0}
            to={`/brands/${activeBrandId}/settings`}
            icon={UserRound}
            title="Shape your brand profile"
            body={
              strength >= 100
                ? "Your profile is looking sharp."
                : strength > 0
                  ? "Pick up where you left off."
                  : "Define your belief, voice and audience."
            }
            meter={loading ? undefined : strength}
            cta={strength > 0 ? "Continue" : "Get started"}
            highlight={strength < 100}
          />
          <NextStep
            index={1}
            to="/settings"
            icon={Camera}
            title="Connect Instagram"
            body={
              ig?.connected
                ? `Connected as @${ig.username ?? "—"}.`
                : "Publish straight from Harness."
            }
            status={loading ? undefined : ig?.connected ? "Connected" : "Not connected"}
            cta={ig?.connected ? "Manage" : "Connect"}
            highlight={!ig?.connected}
          />
          <NextStep
            index={2}
            to="/compose"
            icon={PenLine}
            title="Compose a post"
            body="Draft a caption in your brand voice and publish it."
            cta="Open composer"
          />
          <NextStep
            index={3}
            to="/analytics"
            icon={BarChart3}
            title="Track performance"
            body="See reach, engagement and what's working."
            cta="View analytics"
          />
        </div>
      </div>
    </AppShell>
  );
}

function NextStep({
  index,
  to,
  icon: Icon,
  title,
  body,
  cta,
  meter,
  status,
  highlight = false,
}: {
  index: number;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta: string;
  meter?: number;
  status?: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group block animate-fade-up focus-visible:outline-none"
      style={staggerStyle(index)}
    >
      <Card
        className={`flex h-full flex-col p-5 transition group-hover:border-line-strong group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-100 ${
          highlight ? "border-accent-line" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              highlight ? "bg-accent-soft text-accent-soft-fg" : "bg-hover text-muted"
            }`}
          >
            <Icon className="h-5 w-5" />
          </span>
          {status && (
            <span className="rounded-full bg-hover px-2.5 py-1 text-xs font-medium text-muted">
              {status}
            </span>
          )}
        </div>

        <div className="mt-4 flex-1">
          <h2 className="font-medium text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{body}</p>
          {meter !== undefined && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${meter}%` }}
                />
              </div>
              <span className="text-xs font-semibold tabular-nums text-muted">
                {meter}%
              </span>
            </div>
          )}
        </div>

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          {cta}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </Card>
    </Link>
  );
}

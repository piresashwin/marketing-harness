import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  api,
  type AnalyticsHistoryPoint,
  type AnalyticsInsights,
  type AnalyticsPost,
  type AnalyticsResult,
} from "../api";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { Donut, Scatter, Sparkline } from "../components/charts";
import { staggerStyle } from "../components/motion";
import { Button, Card, Chip } from "../components/ui";

type RangeDays = 7 | 30 | 90;
const RANGES: RangeDays[] = [7, 30, 90];

// "reconnect_required" → token predates the insights scope; "not_connected" →
// no IG account at all. Either way the fix lives in the connect flow.
type LoadError = "reconnect_required" | "not_connected" | "generic" | null;

function errCode(e: unknown): LoadError {
  const code = (e as { body?: { error?: string } }).body?.error;
  if (code === "reconnect_required") return "reconnect_required";
  if (code === "not_connected") return "not_connected";
  return "generic";
}

function fmt(n?: number): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function engagement(p: AnalyticsPost): number {
  return p.totalInteractions ?? p.likeCount + p.commentsCount;
}

export function InstagramAnalytics() {
  const { activeBrand, activeBrandId } = useBrand();
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [history, setHistory] = useState<AnalyticsHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError>(null);
  const [range, setRange] = useState<RangeDays>(30);

  const load = useCallback(
    async (opts?: { refresh?: boolean; range?: RangeDays }) => {
      if (activeBrandId == null) {
        setLoading(false);
        return;
      }
      opts?.refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const result = await api.igAnalytics(activeBrandId, {
          refresh: opts?.refresh,
          range: opts?.range,
        });
        setData(result);
        setRange((result.snapshot.rangeDays as RangeDays) ?? 30);
        // Trend series is best-effort — a snapshot still renders without it.
        try {
          setHistory(await api.igAnalyticsHistory(activeBrandId));
        } catch {
          setHistory([]);
        }
      } catch (e) {
        setError(errCode(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeBrandId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reconnect = async () => {
    if (activeBrandId == null) return;
    try {
      const { url } = await api.igConnectUrl(activeBrandId);
      // Open OAuth in a NEW tab (matches Settings) so the app tab is never
      // navigated away — otherwise the full reload re-runs the auth gate and
      // bounces a user to /welcome. Refresh analytics when they return.
      window.open(url, "_blank");
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        void load({ refresh: true, range });
      };
      window.addEventListener("focus", onFocus);
    } catch {
      /* surfaced via the settings page if the connector is misconfigured */
    }
  };

  return (
    <AppShell
      title="Analytics"
      subtitle={activeBrand ? `Instagram · ${activeBrand.name}` : undefined}
      actions={
        data && !error ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => load({ refresh: true, range })}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Refresh
          </Button>
        ) : undefined
      }
    >
      {activeBrandId == null ? (
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one to see its analytics.
        </Card>
      ) : loading ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading analytics…
        </Card>
      ) : error ? (
        <ErrorState error={error} onReconnect={reconnect} />
      ) : data ? (
        <div className="space-y-5">
          <RangeBar
            range={range}
            busy={refreshing}
            onChange={(r) => {
              setRange(r);
              void load({ refresh: true, range: r });
            }}
            fetchedAt={data.fetchedAt}
          />
          <Kpis result={data} history={history} />
          <div className="grid gap-5 lg:grid-cols-2">
            <EngagementMix posts={data.snapshot.posts} />
            <PostPerformance posts={data.snapshot.posts} />
          </div>
          <Audience snapshot={data.snapshot} />
          <TopPosts posts={data.snapshot.posts} />
          <InsightsPanel brandId={activeBrandId} />
        </div>
      ) : null}
    </AppShell>
  );
}

function ErrorState({
  error,
  onReconnect,
}: {
  error: LoadError;
  onReconnect: () => void;
}) {
  if (error === "generic") {
    return (
      <Card className="p-8 text-center text-sm text-muted">
        Couldn't load analytics. Try refreshing shortly.
      </Card>
    );
  }
  const reconnecting = error === "reconnect_required";
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg">
        <BarChart2 className="h-5 w-5" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-ink">
        {reconnecting ? "Reconnect Instagram" : "Connect Instagram"}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        {reconnecting
          ? "This account was connected before analytics access was added. Reconnect to grant insights permission and see your metrics."
          : "Connect an Instagram Business or Creator account to this brand to see analytics."}
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Button onClick={onReconnect}>
          {reconnecting ? "Reconnect Instagram" : "Connect Instagram"}
        </Button>
        <Link
          to="/settings"
          className="text-sm font-medium text-accent underline underline-offset-2"
        >
          Connection settings
        </Link>
      </div>
    </Card>
  );
}

function RangeBar({
  range,
  busy,
  onChange,
  fetchedAt,
}: {
  range: RangeDays;
  busy: boolean;
  onChange: (r: RangeDays) => void;
  fetchedAt: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <Chip
            key={r}
            label={`${r} days`}
            active={r === range}
            onClick={() => !busy && onChange(r)}
          />
        ))}
      </div>
      <span className="text-xs text-faint">
        Updated {new Date(fetchedAt).toLocaleString()}
      </span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta?: number }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
      }`}
    >
      {up ? (
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <TrendingDown className="h-3.5 w-3.5" aria-hidden />
      )}
      {up ? "+" : ""}
      {fmt(delta)}
    </span>
  );
}

function Stat({
  index = 0,
  label,
  value,
  delta,
  series,
}: {
  index?: number;
  label: string;
  value: string;
  delta?: number;
  series?: (number | undefined)[];
}) {
  return (
    <Card className="flex animate-fade-up flex-col p-4" style={staggerStyle(index)}>
      <div className="text-xs font-medium uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-ink">{value}</span>
        <DeltaBadge delta={delta} />
      </div>
      {series && (
        <div className="mt-3">
          <Sparkline values={series} ariaLabel={`${label} trend`} />
        </div>
      )}
    </Card>
  );
}

function Kpis({
  result,
  history,
}: {
  result: AnalyticsResult;
  history: AnalyticsHistoryPoint[];
}) {
  const { snapshot, deltas } = result;
  const { account, insights } = snapshot;
  // Only draw sparklines once there's a real series (≥2 snapshots).
  const trend = history.length >= 2;
  const series = (pick: (p: AnalyticsHistoryPoint) => number | undefined) =>
    trend ? history.map(pick) : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        index={0}
        label="Followers"
        value={fmt(account.followersCount)}
        delta={deltas?.followersCount}
        series={series((p) => p.followersCount)}
      />
      <Stat
        index={1}
        label="Reach"
        value={fmt(insights.reach)}
        delta={deltas?.reach}
        series={series((p) => p.reach)}
      />
      <Stat
        index={2}
        label="Views"
        value={fmt(insights.views)}
        delta={deltas?.views}
        series={series((p) => p.views)}
      />
      <Stat index={3} label="Profile views" value={fmt(insights.profileViews)} />
      <Stat
        index={4}
        label="Interactions"
        value={fmt(insights.totalInteractions)}
        delta={deltas?.totalInteractions}
        series={series((p) => p.totalInteractions)}
      />
    </div>
  );
}

// Aggregate interaction composition across the fetched posts.
function EngagementMix({ posts }: { posts: AnalyticsPost[] }) {
  const sum = (pick: (p: AnalyticsPost) => number | undefined) =>
    posts.reduce((a, p) => a + (pick(p) ?? 0), 0);
  const segments = [
    { label: "Likes", value: sum((p) => p.likeCount) },
    { label: "Comments", value: sum((p) => p.commentsCount) },
    { label: "Saves", value: sum((p) => p.saved) },
    { label: "Shares", value: sum((p) => p.shares) },
  ];
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">Engagement mix</h2>
      {total === 0 ? (
        <p className="text-sm text-faint">
          No interaction data on recent posts yet.
        </p>
      ) : (
        <Donut
          segments={segments}
          centerTop={fmt(total)}
          centerBottom="actions"
          ariaLabel="Interaction breakdown across recent posts"
        />
      )}
    </Card>
  );
}

// Reach vs engagement scatter — the top-right corner is your outperformers.
function PostPerformance({ posts }: { posts: AnalyticsPost[] }) {
  const points = posts
    .filter((p) => (p.reach ?? 0) > 0)
    .map((p) => ({
      x: p.reach ?? 0,
      y: engagement(p),
      label: `${p.caption?.trim().slice(0, 48) || p.mediaType} · ${fmt(
        p.reach,
      )} reach · ${fmt(engagement(p))} eng.`,
    }));
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold text-ink">Post performance</h2>
      <p className="mb-3 text-xs text-faint">
        Reach vs. engagement — top-right posts punch above their reach.
      </p>
      <Scatter points={points} xLabel="reach" yLabel="engagement" />
    </Card>
  );
}

function BarList({ data }: { data?: Record<string, number> }) {
  const entries = data
    ? Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];
  if (!entries.length) {
    return <p className="text-sm text-faint">No data yet.</p>;
  }
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="w-24 shrink-0 truncate text-xs text-muted" title={key}>
            {key}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${max ? (value / max) * 100 : 0}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-faint">
            {fmt(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Audience({ snapshot }: { snapshot: AnalyticsResult["snapshot"] }) {
  const { age, gender, country } = snapshot.demographics;
  const empty = !age && !gender && !country;
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">Audience</h2>
      {empty ? (
        <p className="text-sm text-faint">
          Audience demographics need at least 100 followers and may take a few
          days to populate.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
              Gender
            </div>
            {gender ? (
              <Donut
                segments={Object.entries(gender)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, value]) => ({ label, value }))}
                size={104}
                thickness={14}
                ariaLabel="Audience by gender"
              />
            ) : (
              <p className="text-sm text-faint">No data yet.</p>
            )}
          </div>
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
              Age
            </div>
            <BarList data={age} />
          </div>
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
              Top countries
            </div>
            <BarList data={country} />
          </div>
        </div>
      )}
    </Card>
  );
}

function TopPosts({ posts }: { posts: AnalyticsPost[] }) {
  const top = [...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 10);
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">Top posts</h2>
      {top.length === 0 ? (
        <p className="text-sm text-faint">No posts found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="py-2 pr-3 font-medium">Post</th>
                <th className="px-3 py-2 text-right font-medium">Reach</th>
                <th className="px-3 py-2 text-right font-medium">Likes</th>
                <th className="px-3 py-2 text-right font-medium">Comments</th>
                <th className="px-3 py-2 text-right font-medium">Saves</th>
                <th className="px-3 py-2 text-right font-medium">Engagement</th>
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <tr
                  key={p.id}
                  className="animate-fade-up border-b border-line/60 last:border-0"
                  style={staggerStyle(i, { step: 45 })}
                >
                  <td className="py-2.5 pr-3">
                    <div className="max-w-[260px] truncate text-ink">
                      {p.caption?.trim() || (
                        <span className="text-faint">(no caption)</span>
                      )}
                    </div>
                    <div className="text-xs text-faint">{p.mediaType}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(p.reach)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(p.likeCount)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(p.commentsCount)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(p.saved)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                    {fmt(engagement(p))}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-accent hover:text-accent-soft-fg"
                        aria-label="Open post on Instagram"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const PRIORITY_CLS: Record<string, string> = {
  high: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
  low: "bg-hover text-muted",
};

function InsightsPanel({ brandId }: { brandId: string }) {
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setNote(null);
    try {
      setInsights(await api.igAnalyticsInsights(brandId));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-accent-soft-fg">
            <Sparkles className="h-4 w-4" aria-hidden />
            AI insights
          </h2>
          <p className="mt-1 text-xs text-muted">
            Interpret these metrics in your brand voice — insights, an action
            plan, suggestions, and content ideas. Uses your workspace's Claude
            key.{" "}
            <Link
              to="/brain"
              className="font-medium text-accent underline underline-offset-2"
            >
              See patterns in Brand Brain
            </Link>
          </p>
        </div>
        <Button size="sm" onClick={generate} disabled={busy} className="shrink-0">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Generating…
            </>
          ) : insights ? (
            "Regenerate"
          ) : (
            "Generate insights"
          )}
        </Button>
      </div>

      {note && <p className="mt-3 text-sm text-muted">{note}</p>}

      {insights && (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <Section title="Insights">
            <ul className="space-y-3">
              {insights.insights.map((it, i) => (
                <li key={i} className="animate-fade-up" style={staggerStyle(i)}>
                  <div className="text-sm font-medium text-ink">{it.title}</div>
                  <div className="text-sm text-muted">{it.detail}</div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Action plan">
            <ul className="space-y-3">
              {insights.actionPlan.map((a, i) => (
                <li
                  key={i}
                  className="flex animate-fade-up gap-2.5"
                  style={staggerStyle(i)}
                >
                  <span
                    className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                      PRIORITY_CLS[a.priority] ?? PRIORITY_CLS.low
                    }`}
                  >
                    {a.priority}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-ink">{a.action}</div>
                    <div className="text-sm text-muted">{a.why}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Suggestions">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted marker:text-faint">
              {insights.suggestions.map((s, i) => (
                <li key={i} className="animate-fade-up" style={staggerStyle(i)}>
                  {s}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Content ideas">
            <ul className="space-y-3">
              {insights.contentIdeas.map((c, i) => (
                <li key={i} className="animate-fade-up" style={staggerStyle(i)}>
                  <div className="text-sm text-ink">{c.idea}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                    {c.format && (
                      <span className="rounded-full bg-hover px-2 py-0.5 text-muted">
                        {c.format}
                      </span>
                    )}
                    {c.pillar && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-soft-fg">
                        {c.pillar}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
        {title}
      </h3>
      {children}
    </div>
  );
}

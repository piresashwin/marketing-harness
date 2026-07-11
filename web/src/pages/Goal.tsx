import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import {
  api,
  type BrandDetail,
  type GoalPlan,
  type GoalRun,
  type GoalRunSummary,
} from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { Button, Card, Textarea } from "../components/ui";

const FORMAT_LABELS: Record<GoalPlan["steps"][number]["format"], string> = {
  Reel: "Reel",
  Carousel: "Carousel",
  Single: "Single",
  Story: "Story",
};

export function Goal() {
  const { activeBrand, activeBrandId } = useBrand();
  const { me } = useAuth();

  const aiReady = useMemo(
    () => (me?.workspaceConnectors ?? []).some((c) => c.provider === "anthropic"),
    [me],
  );

  const [brandDetail, setBrandDetail] = useState<BrandDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [runs, setRuns] = useState<GoalRunSummary[]>([]);
  const [runsError, setRunsError] = useState(false);

  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<GoalRun | null>(null);
  const [toast, setToast] = useState<{ msg: string; link?: string } | null>(null);

  const loadDetail = useCallback(async () => {
    if (!activeBrandId) return;
    setDetailError(false);
    try {
      setBrandDetail(await api.getBrand(activeBrandId));
    } catch {
      setDetailError(true);
    }
  }, [activeBrandId]);

  const loadRuns = useCallback(async () => {
    if (!activeBrandId) return;
    setRunsError(false);
    try {
      const { runs } = await api.listGoals(activeBrandId);
      setRuns(runs);
    } catch {
      setRunsError(true);
    }
  }, [activeBrandId]);

  useEffect(() => {
    void loadDetail();
    void loadRuns();
  }, [loadDetail, loadRuns]);

  const hasProfile = useMemo(() => {
    if (!brandDetail) return true; // don't nudge until we know
    return brandDetail.pillars.length > 0;
  }, [brandDetail]);

  const planIt = async () => {
    if (!activeBrandId || !goal.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const run = await api.proposeGoal(activeBrandId, goal.trim());
      setActiveRun(run);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const proceed = async () => {
    if (!activeBrandId || !activeRun) return;
    setBusy(true);
    setError(null);
    try {
      const { createdDraftIds } = await api.approveGoal(activeBrandId, activeRun.id);
      setToast({
        msg: `${createdDraftIds.length} draft${createdDraftIds.length === 1 ? "" : "s"} added to your queue`,
        link: "/calendar",
      });
      setActiveRun(null);
      setGoal("");
      void loadRuns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (runId: string) => {
    if (!activeBrandId) return;
    try {
      await api.discardGoal(activeBrandId, runId);
      if (activeRun?.id === runId) setActiveRun(null);
      setRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, status: "discarded" } : r)),
      );
    } catch {
      void loadRuns();
    }
  };

  return (
    <AppShell
      title="Goal"
      subtitle={activeBrand ? activeBrand.name : undefined}
    >
      {activeBrandId == null ? (
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one to plan toward a goal.
        </Card>
      ) : detailError ? (
        <Card className="p-8 text-center text-sm text-red-600 dark:text-red-400">
          Could not load this brand. Try refreshing.
        </Card>
      ) : !hasProfile ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Target className="h-8 w-8 text-faint" aria-hidden />
          <p className="text-sm font-medium text-ink">
            Add a content pillar or two first
          </p>
          <p className="max-w-sm text-xs text-faint">
            Goal plans are grounded in your Brand Profile and content pillars —
            fill those in and the AI's plan will actually fit your brand.
          </p>
          <Link to={activeBrand ? `/brands/${activeBrand.id}/settings` : "/brands"}>
            <Button size="sm" className="mt-1">
              Go to Brand Profile
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-8">
          {toast && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {toast.msg}
              </span>
              {toast.link && (
                <Link
                  to={toast.link}
                  className="shrink-0 font-medium underline underline-offset-2"
                >
                  View queue
                </Link>
              )}
            </div>
          )}

          {activeRun ? (
            <IntentPreview
              run={activeRun}
              busy={busy}
              error={error}
              onProceed={proceed}
              onDiscard={() => discard(activeRun.id)}
            />
          ) : (
            <Kickoff
              aiReady={aiReady}
              goal={goal}
              onGoalChange={setGoal}
              busy={busy}
              error={error}
              onPlanIt={planIt}
            />
          )}

          <RunsLog runs={runs} error={runsError} onDiscard={discard} />
        </div>
      )}
    </AppShell>
  );
}

// ── Kickoff form ──────────────────────────────────────────────────────

function Kickoff({
  aiReady,
  goal,
  onGoalChange,
  busy,
  error,
  onPlanIt,
}: {
  aiReady: boolean;
  goal: string;
  onGoalChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onPlanIt: () => void;
}) {
  return (
    <div className="space-y-6">
      {!aiReady && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span>Connect Claude in Settings to enable goal-driven planning.</span>
          <Link
            to="/settings"
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Settings
          </Link>
        </div>
      )}

      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
            <Target className="h-5 w-5 text-accent-soft-fg" aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold text-ink">What's the outcome?</h2>
            <p className="text-xs text-muted">
              State a goal in plain language — the AI proposes an approvable
              plan of posts toward it.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="goal-input" className="block text-sm font-medium text-ink">
            Goal
          </label>
          <Textarea
            id="goal-input"
            rows={3}
            value={goal}
            onChange={(e) => onGoalChange(e.target.value)}
            placeholder="e.g. grow followers before our fall product launch"
            disabled={busy}
          />
        </div>

        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm font-medium text-ink">Autonomy</p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-accent-line bg-accent-soft px-3.5 py-1.5 text-sm text-accent-soft-fg">
              Draft for my review
            </span>
            <span
              className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-sm text-faint"
              title="Not available yet — nothing auto-publishes"
            >
              Schedule automatically <span className="italic">— soon</span>
            </span>
          </div>
          <p className="text-xs text-faint">
            Every step is added as a draft you finish and approve — nothing is
            generated or posted automatically.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-faint">~$0.02 · your key</p>
          <Button onClick={onPlanIt} disabled={busy || !aiReady || !goal.trim()}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Planning…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Plan it
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ── Intent Preview ──────────────────────────────────────────────────────

function IntentPreview({
  run,
  busy,
  error,
  onProceed,
  onDiscard,
}: {
  run: GoalRun;
  busy: boolean;
  error: string | null;
  onProceed: () => void;
  onDiscard: () => void;
}) {
  return (
    <Card className="p-6 space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-faint">
          Intent Preview
        </p>
        <p className="mt-1 text-sm text-ink">{run.goal}</p>
        <p className="mt-2 text-sm text-muted">{run.plan.summary}</p>
      </div>

      <div className="space-y-3">
        {run.plan.steps.map((step, i) => (
          <div
            key={i}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink">
                {i + 1}. {step.title}
              </p>
              <span className="shrink-0 text-xs text-faint">Day {step.dayOffset + 1}</span>
            </div>
            <p className="mt-1 text-xs text-muted">Why: {step.why}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-line bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
                {FORMAT_LABELS[step.format]}
              </span>
              <span className="text-xs text-faint">{step.pillar}</span>
              {step.time && <span className="text-xs text-faint">{step.time}</span>}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        <Button onClick={onProceed} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Adding…
            </>
          ) : (
            "Proceed"
          )}
        </Button>
      </div>
    </Card>
  );
}

// ── Runs log ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  discarded: "Discarded",
};

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  approved:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  discarded: "bg-hover text-muted",
};

function RunsLog({
  runs,
  error,
  onDiscard,
}: {
  runs: GoalRunSummary[];
  error: boolean;
  onDiscard: (runId: string) => void;
}) {
  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Could not load past goal plans.
      </p>
    );
  }
  if (runs.length === 0) return null;

  return (
    <div>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
        Recent goal plans
      </p>
      <div className="space-y-2">
        {runs.map((run) => (
          <Card key={run.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{run.goal}</p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[run.status] ?? "bg-hover text-muted"
                  }`}
                >
                  {STATUS_LABELS[run.status] ?? run.status}
                </span>
                <span className="text-xs text-faint">{run.stepCount} steps</span>
              </div>
            </div>
            {run.status === "approved" && (
              <button
                onClick={() => onDiscard(run.id)}
                aria-label="Discard plan"
                className="shrink-0 rounded-lg p-2 text-faint transition hover:bg-hover hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

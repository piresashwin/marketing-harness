import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarRange, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api, type ContentPlan, type ContentPlanItem } from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { Button, Card, Chip, Textarea } from "../components/ui";

// ── Pillar colour palette — cycled by index for dot + tint ───────────
const PILLAR_COLORS = [
  "bg-brand-600",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-sky-500",
] as const;

const CADENCE_OPTIONS = [
  { label: "3×/week", value: "3 posts per week" },
  { label: "5×/week", value: "5 posts per week" },
  { label: "Daily", value: "1 post per day" },
] as const;

type CadenceValue = (typeof CADENCE_OPTIONS)[number]["value"];

const FORMAT_LABELS: Record<ContentPlanItem["format"], string> = {
  Reel: "Reel",
  Carousel: "Carousel",
  Single: "Single",
  Story: "Story",
};

// ── Plan page ─────────────────────────────────────────────────────────

export function Plan() {
  const { activeBrand, activeBrandId } = useBrand();
  const { me } = useAuth();
  const navigate = useNavigate();

  const aiReady = useMemo(
    () => (me?.workspaceConnectors ?? []).some((c) => c.provider === "anthropic"),
    [me],
  );

  const [note, setNote] = useState("");
  const [cadence, setCadence] = useState<CadenceValue>("3 posts per week");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);

  const generate = async () => {
    if (!activeBrandId) return;
    setBusy(true);
    setError(null);
    const combined = [note.trim(), `Cadence: ${cadence}`]
      .filter(Boolean)
      .join(". ");
    try {
      const result = await api.aiContentPlan(activeBrandId, { note: combined });
      setPlan(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPlan(null);
    setError(null);
  };

  return (
    <AppShell
      title="Content Plan"
      subtitle={activeBrand ? activeBrand.name : undefined}
      actions={
        plan ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Regenerate
          </Button>
        ) : undefined
      }
    >
      {activeBrandId == null ? (
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one to generate a content plan.
        </Card>
      ) : plan ? (
        <PlanView
          plan={plan}
          onNavigateCompose={(item) => {
            navigate("/compose", { state: { idea: item.hook } });
          }}
        />
      ) : (
        <Kickoff
          aiReady={aiReady}
          note={note}
          onNoteChange={setNote}
          cadence={cadence}
          onCadenceChange={setCadence}
          busy={busy}
          error={error}
          onGenerate={generate}
        />
      )}
    </AppShell>
  );
}

// ── Kickoff form ──────────────────────────────────────────────────────

function Kickoff({
  aiReady,
  note,
  onNoteChange,
  cadence,
  onCadenceChange,
  busy,
  error,
  onGenerate,
}: {
  aiReady: boolean;
  note: string;
  onNoteChange: (v: string) => void;
  cadence: CadenceValue;
  onCadenceChange: (v: CadenceValue) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-6">
      {!aiReady && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span>Connect Claude in Settings to enable AI content planning.</span>
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
            <CalendarRange className="h-5 w-5 text-accent-soft-fg" aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold text-ink">Draft my 2-week plan</h2>
            <p className="text-xs text-muted">
              The AI uses your brand profile and content pillars to build a
              realistic, on-brand schedule.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="plan-note"
            className="block text-sm font-medium text-ink"
          >
            Anything coming up?{" "}
            <span className="font-normal text-faint">(optional)</span>
          </label>
          <Textarea
            id="plan-note"
            rows={3}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="e.g. product launch on day 5, seasonal sale, trade show next week…"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Posting cadence</p>
          <div className="flex flex-wrap gap-2">
            {CADENCE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={cadence === opt.value}
                onClick={() => onCadenceChange(opt.value)}
              />
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={onGenerate}
            disabled={busy || !aiReady}
          >
            {busy ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
                Drafting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Draft my plan
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ── Plan view ─────────────────────────────────────────────────────────

function PlanView({
  plan,
  onNavigateCompose,
}: {
  plan: ContentPlan;
  onNavigateCompose: (item: ContentPlanItem) => void;
}) {
  // Build a stable pillar → colour index map from the plan's items.
  const pillarIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of plan.items) {
      if (!map.has(item.pillar)) map.set(item.pillar, map.size);
    }
    return map;
  }, [plan.items]);

  const pillarsInPlan = useMemo(
    () => Array.from(pillarIndex.keys()),
    [pillarIndex],
  );

  // Group items by day offset so we can render a day header per group.
  const byDay = useMemo(() => {
    const map = new Map<number, ContentPlanItem[]>();
    for (const item of plan.items) {
      const arr = map.get(item.dayOffset) ?? [];
      arr.push(item);
      map.set(item.dayOffset, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [plan.items]);

  return (
    <div className="space-y-6">
      {/* Pillar legend */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
          Content pillars
        </p>
        <div className="flex flex-wrap gap-3">
          {pillarsInPlan.map((name) => {
            const idx = pillarIndex.get(name) ?? 0;
            const dot = PILLAR_COLORS[idx % PILLAR_COLORS.length];
            return (
              <span key={name} className="flex items-center gap-1.5 text-sm text-ink">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`}
                  aria-hidden
                />
                {name}
              </span>
            );
          })}
        </div>
      </Card>

      {/* Items grouped by day */}
      <div className="space-y-4">
        {byDay.map(([day, items]) => (
          <div key={day}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
              Day {day + 1}
            </p>
            <div className="space-y-2">
              {items.map((item, i) => (
                <PlanItemRow
                  key={`${day}-${i}`}
                  item={item}
                  colorClass={
                    PILLAR_COLORS[
                      (pillarIndex.get(item.pillar) ?? 0) % PILLAR_COLORS.length
                    ]
                  }
                  onSendToCompose={() => onNavigateCompose(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanItemRow({
  item,
  colorClass,
  onSendToCompose,
}: {
  item: ContentPlanItem;
  colorClass: string;
  onSendToCompose: () => void;
}) {
  return (
    <Card className="flex items-start gap-3 px-4 py-3">
      {/* Pillar dot */}
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`}
        aria-hidden
      />

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
            {FORMAT_LABELS[item.format]}
          </span>
          <span className="text-xs text-faint">{item.pillar}</span>
          {item.time && (
            <span className="text-xs text-faint">{item.time}</span>
          )}
        </div>
        <p className="text-sm text-ink">{item.hook}</p>
      </div>

      {/* Send to compose */}
      <button
        type="button"
        onClick={onSendToCompose}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent outline-none transition hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none"
      >
        Compose
      </button>
    </Card>
  );
}

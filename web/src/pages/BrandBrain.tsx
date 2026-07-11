import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Brain,
  Check,
  Loader2,
  Plus,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  api,
  type Brain as BrainData,
  type BrainCandidate,
  type BrainExample,
  type BrainPattern,
  type BrainSuggestion,
} from "../api";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
} from "../components/ui";

const Spinner = () => (
  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
);

type LoadError = "no_analytics" | "generic" | null;

function errCode(e: unknown): LoadError {
  const code = (e as { body?: { error?: string } }).body?.error;
  return code === "no_analytics" ? "no_analytics" : "generic";
}

export function BrandBrain() {
  const { activeBrand, activeBrandId } = useBrand();
  const brandName = activeBrand?.name ?? "your brand";

  const [brain, setBrain] = useState<BrainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError>(null);
  const [relearning, setRelearning] = useState(false);

  const load = useCallback(async () => {
    if (activeBrandId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBrain(await api.getBrain(activeBrandId));
    } catch (e) {
      setError(errCode(e));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const relearn = async () => {
    if (activeBrandId == null || relearning) return;
    setRelearning(true);
    setError(null);
    try {
      setBrain(await api.relearnBrain(activeBrandId));
    } catch (e) {
      setError(errCode(e));
    } finally {
      setRelearning(false);
    }
  };

  return (
    <AppShell title="Brand Brain" subtitle={brandName}>
      {activeBrandId == null ? (
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one first.
        </Card>
      ) : loading ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-faint">
          <Spinner />
          Loading brand brain…
        </Card>
      ) : error === "generic" ? (
        <Card className="p-8 text-center text-sm text-muted">
          Couldn't load the brand brain. Try refreshing shortly.
        </Card>
      ) : !brain || !brain.hasAnalytics || error === "no_analytics" ? (
        <NoAnalyticsState brandId={activeBrandId} onRelearn={relearn} relearning={relearning} />
      ) : (
        <div className="space-y-8">
          <HeaderRow
            brandName={brandName}
            lastLearnedAt={brain.lastLearnedAt}
            relearning={relearning}
            onRelearn={relearn}
          />
          <StrengthCard brain={brain} />
          <PatternsSection
            brandId={activeBrandId}
            patterns={brain.patterns}
            onUpdate={setBrain}
          />
          <ExamplesSection
            brandId={activeBrandId}
            examples={brain.examples}
            candidates={brain.candidates}
            onUpdate={setBrain}
          />
          <SuggestionsSection
            brandId={activeBrandId}
            suggestions={brain.suggestions}
            onUpdate={setBrain}
          />
        </div>
      )}
    </AppShell>
  );
}

// ── Empty state (no analytics yet) ──────────────────────────────────────

function NoAnalyticsState({
  brandId,
  onRelearn,
  relearning,
}: {
  brandId: string;
  onRelearn: () => void;
  relearning: boolean;
}) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg">
        <Brain className="h-5 w-5" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-ink">Nothing learned yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Brand Brain learns from your Instagram results — connect Instagram and
        pull analytics first, then come back to re-learn from them.
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Link to="/analytics">
          <Button>Go to Analytics</Button>
        </Link>
        <Button variant="secondary" onClick={onRelearn} disabled={relearning || !brandId}>
          {relearning ? <Spinner /> : <Sparkles className="h-4 w-4" aria-hidden />}
          Try re-learn
        </Button>
      </div>
    </Card>
  );
}

// ── Header / strength ────────────────────────────────────────────────────

function HeaderRow({
  brandName,
  lastLearnedAt,
  relearning,
  onRelearn,
}: {
  brandName: string;
  lastLearnedAt: string | null;
  relearning: boolean;
  onRelearn: () => void;
}) {
  return (
    <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-muted">
          What Harness has learned about {brandName} from your results — it
          sharpens every caption and plan.
        </p>
        <p className="mt-1.5 text-xs text-faint" aria-live="polite">
          {lastLearnedAt
            ? `Last learned from analytics ${new Date(lastLearnedAt).toLocaleString()}`
            : "Not learned yet"}
        </p>
      </div>
      <Button onClick={onRelearn} disabled={relearning} className="shrink-0">
        {relearning ? <Spinner /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {relearning ? "Analyzing your last 30 days…" : "Re-learn from latest analytics"}
      </Button>
    </Card>
  );
}

function StrengthCard({ brain }: { brain: BrainData }) {
  const learnedCount =
    brain.patterns.length + brain.suggestions.length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">Learning strength</h2>
        </div>
        <span className="text-sm font-semibold tabular-nums text-muted">
          {brain.strength}%
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${brain.strength}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-faint">
        {learnedCount} learned item{learnedCount === 1 ? "" : "s"} ·{" "}
        {brain.examples.length} voice example{brain.examples.length === 1 ? "" : "s"}. Add
        more top posts as examples to sharpen the brain further.
      </p>
    </Card>
  );
}

// ── Learned patterns ──────────────────────────────────────────────────────

function PatternsSection({
  brandId,
  patterns,
  onUpdate,
}: {
  brandId: string;
  patterns: BrainPattern[];
  onUpdate: (b: BrainData) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (fn: () => Promise<BrainData>, id: string) => {
    setBusyId(id);
    try {
      onUpdate(await fn());
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-ink">Learned patterns</h2>
      {patterns.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          No patterns right now — re-learn from analytics to find some.
        </Card>
      ) : (
        <div className="space-y-3">
          {patterns.map((p) => (
            <PatternCard
              key={p.id}
              pattern={p}
              busy={busyId === p.id}
              onApply={() => run(() => api.brainItemApply(brandId, p.id), p.id)}
              onUndo={() => run(() => api.brainItemUndo(brandId, p.id), p.id)}
              onDismiss={() => run(() => api.brainItemDismiss(brandId, p.id), p.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PatternCard({
  pattern,
  busy,
  onApply,
  onUndo,
  onDismiss,
}: {
  pattern: BrainPattern;
  busy: boolean;
  onApply: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  if (pattern.status === "dismissed") return null;

  if (pattern.status === "applied") {
    return (
      <Card className="flex items-center justify-between gap-4 p-4 opacity-70">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <Check className="h-4 w-4 text-emerald-500" aria-hidden /> {pattern.title} —
            Applied
          </p>
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-100 disabled:opacity-60"
        >
          {busy ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />} Undo
        </button>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{pattern.title}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            pattern.impact === "High"
              ? "bg-accent-soft text-accent-soft-fg"
              : "bg-hover text-muted"
          }`}
        >
          {pattern.impact} impact
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{pattern.evidence}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onApply} disabled={busy}>
          {busy && <Spinner />} Apply to profile
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

// ── Voice examples ───────────────────────────────────────────────────────

function ExamplesSection({
  brandId,
  examples,
  candidates,
  onUpdate,
}: {
  brandId: string;
  examples: BrainExample[];
  candidates: BrainCandidate[];
  onUpdate: (b: BrainData) => void;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = examples.filter((e) => e.status === "applied");

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      onUpdate(await api.brainItemDismiss(brandId, id));
    } finally {
      setRemovingId(null);
    }
  };

  const annotate = async (id: string, annotation: string) => {
    onUpdate(await api.updateBrainExample(brandId, id, annotation));
  };

  const addCandidate = async (c: BrainCandidate) => {
    setAdding(true);
    try {
      onUpdate(
        await api.addBrainExample(brandId, {
          caption: c.caption,
          metric: c.metric,
          annotation: "",
        }),
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Voice examples (Body of Work)</h2>
        <span className="text-xs text-faint">Top posts that teach the AI your voice</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((e) => (
          <VoiceExampleCard
            key={e.id}
            example={e}
            removing={removingId === e.id}
            onRemove={() => remove(e.id)}
            onAnnotate={(v) => annotate(e.id, v)}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={adding || candidates.length === 0}
              className="flex min-h-[13rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-medium text-faint outline-none transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-brand-100 disabled:pointer-events-none disabled:opacity-60"
            >
              {adding ? <Spinner /> : <Plus className="h-5 w-5" aria-hidden />}
              {candidates.length === 0
                ? "No more top posts to add"
                : "Add a top post as an example"}
            </button>
          </DropdownMenuTrigger>
          {candidates.length > 0 && (
            <DropdownMenuContent className="max-h-80 overflow-y-auto">
              {candidates.map((c, i) => (
                <DropdownMenuItem
                  key={i}
                  onSelect={() => void addCandidate(c)}
                  className="flex-col items-start gap-1"
                >
                  <span className="line-clamp-2 text-sm text-ink">{c.caption}</span>
                  <span className="text-xs text-faint">{c.metric}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>
    </section>
  );
}

function VoiceExampleCard({
  example,
  removing,
  onRemove,
  onAnnotate,
}: {
  example: BrainExample;
  removing: boolean;
  onRemove: () => void;
  onAnnotate: (v: string) => void;
}) {
  const [draft, setDraft] = useState(example.annotation);

  return (
    <Card className="relative flex flex-col p-0">
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label="Remove example"
        className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-faint shadow-sm outline-none transition hover:text-red-600 focus-visible:ring-2 focus-visible:ring-brand-100 disabled:opacity-60"
      >
        {removing ? <Spinner /> : <X className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <div
        className="h-24 w-full rounded-t-2xl bg-gradient-to-br from-accent-soft to-line"
        aria-hidden
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="line-clamp-2 text-sm text-ink">{example.caption}</p>
        {example.metric && (
          <span className="w-fit rounded-full bg-hover px-2 py-0.5 text-xs font-medium text-muted">
            {example.metric}
          </span>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== example.annotation && onAnnotate(draft)}
          rows={2}
          className="mt-1 text-xs"
          aria-label="Why this example works"
          placeholder="Why this works…"
        />
      </div>
    </Card>
  );
}

// ── Suggested profile updates ──────────────────────────────────────────

function SuggestionsSection({
  brandId,
  suggestions,
  onUpdate,
}: {
  brandId: string;
  suggestions: BrainSuggestion[];
  onUpdate: (b: BrainData) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (fn: () => Promise<BrainData>, id: string) => {
    setBusyId(id);
    try {
      onUpdate(await fn());
    } finally {
      setBusyId(null);
    }
  };

  const visible = suggestions.filter((s) => s.status !== "dismissed");

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-ink">Suggested profile updates</h2>
      <Card className="divide-y divide-line p-0">
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">No pending suggestions.</p>
        ) : (
          visible.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p
                  className={`text-sm ${
                    s.status === "applied" ? "text-faint line-through" : "text-ink"
                  }`}
                >
                  {s.title}
                </p>
                {s.description && (
                  <p className="mt-0.5 text-xs text-muted">{s.description}</p>
                )}
              </div>
              {s.status === "applied" ? (
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" aria-hidden /> Applied
                </span>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => run(() => api.brainItemApply(brandId, s.id), s.id)}
                    disabled={busyId === s.id}
                  >
                    {busyId === s.id && <Spinner />} Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => api.brainItemDismiss(brandId, s.id), s.id)}
                    disabled={busyId === s.id}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
        <p className="px-5 py-3 text-xs text-faint">
          Approved suggestions feed straight into your captions and plans.
        </p>
      </Card>
    </section>
  );
}

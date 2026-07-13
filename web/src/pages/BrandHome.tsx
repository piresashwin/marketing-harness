import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Brain as BrainIcon,
  CalendarClock,
  Camera,
  Check,
  ClipboardCheck,
  ImagePlus,
  PenLine,
  Target,
  UserRound,
} from "lucide-react";
import {
  api,
  type Brain,
  type BrandDetail,
  type DraftPost,
  type GoalRunSummary,
  type IgStatus,
  type ReviewPost,
  type ScheduledPost,
} from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { staggerStyle } from "../components/motion";
import { Card, StatusPill } from "../components/ui";

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

/** Profile is "set up enough" for the checklist below this strength. */
const PROFILE_THRESHOLD = 60;

export function BrandHome() {
  const { me } = useAuth();
  const { activeBrand, activeBrandId } = useBrand();
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [goals, setGoals] = useState<{ runs: GoalRunSummary[]; drafts: DraftPost[] }>({
    runs: [],
    drafts: [],
  });
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewPost[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
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
      const [d, status, g, q, rq, b] = await Promise.all([
        api.getBrand(activeBrandId),
        api.igStatus(activeBrandId).catch(() => ({ connected: false }) as IgStatus),
        api.listGoals(activeBrandId).catch(() => ({ runs: [], drafts: [] })),
        api.listQueue(activeBrandId).catch(() => []),
        api.listReviewQueue(activeBrandId).catch(() => []),
        api.getBrain(activeBrandId).catch(() => null),
      ]);
      setDetail(d);
      setIg(status);
      setGoals(g);
      setScheduled(q);
      setReviewQueue(rq);
      setBrain(b);
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

  // Setup checklist — derived live from real state, nothing persisted.
  const checklist = {
    profile: strength >= PROFILE_THRESHOLD,
    claude: aiReady,
    instagram: ig?.connected ?? false,
    firstPlan:
      goals.runs.length > 0 || goals.drafts.length > 0 || scheduled.length > 0,
  };
  const setupComplete = Object.values(checklist).every(Boolean);

  const nextScheduled = scheduled.find((p) => p.scheduledAt != null) ?? null;
  const activeSuggestion =
    brain?.suggestions.find((s) => s.status === "active") ?? null;

  return (
    <AppShell title="Home" subtitle={activeBrand?.name}>
      <div className="space-y-8">
        <header>
          <p className="text-sm text-muted">Welcome back</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {brandName}
          </h1>
        </header>

        {!loading && !setupComplete && (
          <SetupChecklist
            checklist={checklist}
            strength={strength}
            igUsername={ig?.username}
            brandId={activeBrandId}
          />
        )}

        <section aria-label="Content loop status">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-faint">
            Your content loop
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <LoopTile
              index={0}
              to="/calendar"
              icon={ClipboardCheck}
              label="Needs review"
              value={loading ? "—" : String(reviewQueue.length)}
              hint={reviewQueue.length > 0 ? "Approve to publish" : "All clear"}
              highlight={reviewQueue.length > 0}
            />
            <LoopTile
              index={1}
              to="/calendar"
              icon={ImagePlus}
              label="Drafts awaiting media"
              value={loading ? "—" : String(goals.drafts.length)}
              hint={
                goals.drafts.length > 0 ? "Finish them in Compose" : "No open drafts"
              }
            />
            <LoopTile
              index={2}
              to="/calendar"
              icon={CalendarClock}
              label="Next scheduled post"
              value={
                loading
                  ? "—"
                  : nextScheduled?.scheduledAt
                    ? new Date(nextScheduled.scheduledAt).toLocaleString(undefined, {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Nothing scheduled"
              }
              hint={nextScheduled ? "View the queue" : "Plan or compose a post"}
            />
            <LoopTile
              index={3}
              to="/brain"
              icon={BrainIcon}
              label="Brand Brain"
              value={
                loading
                  ? "—"
                  : activeSuggestion
                    ? activeSuggestion.title
                    : "No suggestions yet"
              }
              hint={activeSuggestion ? "Review suggestion" : "Learns from analytics"}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NextStep
            index={0}
            to="/compose"
            icon={PenLine}
            title="Compose a post"
            body="Draft a caption in your brand voice and publish it."
            cta="Open composer"
          />
          <NextStep
            index={1}
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

function SetupChecklist({
  checklist,
  strength,
  igUsername,
  brandId,
}: {
  checklist: { profile: boolean; claude: boolean; instagram: boolean; firstPlan: boolean };
  strength: number;
  igUsername?: string;
  brandId: string | null;
}) {
  const done = Object.values(checklist).filter(Boolean).length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-ink">Set up your loop</h2>
          <p className="mt-0.5 text-sm text-muted">
            Four steps and the harness can plan, draft and publish for you.
          </p>
        </div>
        <span className="rounded-full bg-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-muted">
          {done}/4
        </span>
      </div>
      <ul className="mt-4 divide-y divide-line">
        <ChecklistRow
          done={checklist.profile}
          icon={UserRound}
          title="Shape your brand profile"
          detail={
            checklist.profile
              ? "Your profile is in good shape."
              : "Define your belief, voice and audience."
          }
          to={brandId != null ? `/brands/${brandId}/settings` : "/brands"}
          cta={strength > 0 ? "Continue" : "Get started"}
        >
          {!checklist.profile && (
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${strength}%` }}
                />
              </span>
              <span className="text-xs font-semibold tabular-nums text-muted">
                {strength}%
              </span>
            </span>
          )}
        </ChecklistRow>
        <ChecklistRow
          done={checklist.claude}
          icon={Bot}
          title="Connect Claude"
          detail={
            checklist.claude
              ? "AI drafting is ready."
              : "Bring your Anthropic key to draft and refine content."
          }
          to="/settings"
          state={{ section: "providers" }}
          cta="Connect"
        />
        <ChecklistRow
          done={checklist.instagram}
          icon={Camera}
          title="Connect Instagram"
          detail={
            checklist.instagram
              ? `Connected as @${igUsername ?? "—"}.`
              : "Publish straight from Harness."
          }
          to="/settings"
          state={{ section: "instagram" }}
          cta="Connect"
        >
          <StatusPill connected={checklist.instagram} />
        </ChecklistRow>
        <ChecklistRow
          done={checklist.firstPlan}
          icon={Target}
          title="Set your first goal"
          detail={
            checklist.firstPlan
              ? "The loop is running."
              : "State an outcome — the AI plans the content to get there."
          }
          to="/goal"
          cta="Set a goal"
        />
      </ul>
    </Card>
  );
}

function ChecklistRow({
  done,
  icon: Icon,
  title,
  detail,
  to,
  state,
  cta,
  children,
}: {
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  to: string;
  state?: Record<string, unknown>;
  cta: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          done
            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "bg-accent-soft text-accent-soft-fg"
        }`}
      >
        {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${done ? "text-muted line-through decoration-line" : "text-ink"}`}>
          {title}
        </span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {children}
      {!done && (
        <Link
          to={to}
          state={state}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
        >
          {cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </li>
  );
}

function LoopTile({
  index,
  to,
  icon: Icon,
  label,
  value,
  hint,
  highlight = false,
}: {
  index: number;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group block animate-fade-up focus-visible:outline-none"
      style={staggerStyle(index)}
    >
      <Card
        className={`flex h-full flex-col p-4 transition group-hover:border-line-strong group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-100 ${
          highlight ? "border-accent-line" : ""
        }`}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="mt-2 truncate text-lg font-semibold tabular-nums text-ink">
          {value}
        </span>
        <span className="mt-1 text-xs text-faint">{hint}</span>
      </Card>
    </Link>
  );
}

function NextStep({
  index,
  to,
  icon: Icon,
  title,
  body,
  cta,
}: {
  index: number;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="group block animate-fade-up focus-visible:outline-none"
      style={staggerStyle(index)}
    >
      <Card className="flex h-full flex-col p-5 transition group-hover:border-line-strong group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-100">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hover text-muted">
          <Icon className="h-5 w-5" />
        </span>
        <div className="mt-4 flex-1">
          <h2 className="font-medium text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </div>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          {cta}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </Card>
    </Link>
  );
}

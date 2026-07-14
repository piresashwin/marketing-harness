import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type BrandBranding,
  type BrandColor,
  type BrandDetail,
  type BrandVoice,
  type DraftProfile,
  type Pillar,
  type PlatformKey,
  type PlatformSetting,
  type ProfileField,
  type SuggestedPillar,
} from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { Reveal } from "../components/motion";
import {
  Button,
  Card,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  FullScreenDialog,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "../components/ui";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Loader2,
  PenLine,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

// Shared icon helpers — lucide, sized to context.
const Spinner = () => (
  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
);

// ── Autosave ──────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Debounced autosave. `key` is a serialization of the saved value — saving runs
 * when it changes (never on first mount, so loading data doesn't trigger a
 * write). The latest value is captured per-change so the save closure is fresh.
 */
function useAutosave(key: string, save: () => Promise<void>): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveRef.current().then(
        () => setState("saved"),
        () => setState("error"),
      );
    }, 700);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

function mergeSaveState(a: SaveState, b: SaveState): SaveState {
  if (a === "error" || b === "error") return "error";
  if (a === "saving" || b === "saving") return "saving";
  if (a === "saved" || b === "saved") return "saved";
  return "idle";
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const map = {
    saving: { cls: "text-muted", body: "Saving…", icon: <Spinner /> },
    saved: { cls: "text-emerald-500", body: "Saved", icon: <Check className="h-3.5 w-3.5" /> },
    error: { cls: "text-red-600", body: "Couldn't save", icon: null },
  } as const;
  const m = map[state];
  return (
    <span className={`flex items-center gap-1.5 text-sm ${m.cls}`} role="status" aria-live="polite">
      {m.icon}
      <span className="hidden sm:inline">{m.body}</span>
    </span>
  );
}

// ── Page (route) ──────────────────────────────────────────────────────

export function BrandSettings() {
  const { id } = useParams<{ id: string }>();
  const brandId = id ?? null;
  const navigate = useNavigate();
  const { brands } = useBrand();
  const location = useLocation();
  // Set when arriving from brand creation (welcome / dialog): the one-sentence
  // seed to draft from, and a flag that this is the guided first run.
  const navState = (location.state ?? {}) as {
    seed?: string;
    sourceUrl?: string;
    onboarding?: boolean;
  };

  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [platforms, setPlatforms] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (brandId == null) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [d, p] = await Promise.all([
        api.getBrand(brandId),
        api.getPlatformSettings(brandId),
      ]);
      setDetail(d);
      setPlatforms(p.platforms);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Closing the take-over returns to the brand home after onboarding (the guided
  // finish), otherwise back to wherever it was opened from.
  const close = useCallback(() => {
    if (navState.onboarding) navigate("/home");
    else navigate(-1);
  }, [navState.onboarding, navigate]);

  const brandName =
    detail?.brand.name ?? brands.find((b) => b.id === brandId)?.name ?? "Brand";

  if (loading || loadError || !detail || brandId == null) {
    return (
      <FullScreenDialog
        open
        onOpenChange={(o) => {
          if (!o) close();
        }}
        eyebrow="Brand profile"
        title={brandName}
      >
        <div className="flex min-h-full items-center justify-center p-8">
          {loading ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : (
            <div className="text-center">
              <p className="text-sm text-muted">Couldn't load this brand.</p>
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </FullScreenDialog>
    );
  }

  return (
    <ProfileEditor
      key={brandId}
      brandId={brandId}
      detail={detail}
      platforms={platforms}
      reload={load}
      initialSeed={navState.seed}
      initialSourceUrl={navState.sourceUrl}
      onboarding={!!navState.onboarding}
      onClose={close}
    />
  );
}

// ── Editor ────────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  "Friendly", "Bold", "Witty", "Warm", "Direct",
  "Minimal", "Playful", "Premium", "Honest",
];

const STEP_DEFS = [
  { key: "why", roman: "i", label: "Why", sub: "The belief" },
  { key: "how", roman: "ii", label: "How", sub: "Voice & visuals" },
  { key: "what", roman: "iii", label: "What", sub: "Product & pillars" },
  { key: "channels", roman: "iv", label: "Channels", sub: "Publishing & more" },
] as const;

interface DraftPillar {
  key: string;
  name: string;
  description: string;
  ratio: string;
}
let pillarKeySeq = 0;
function toDraftPillar(p: Pillar): DraftPillar {
  return {
    key: `p${p.id}`,
    name: p.name,
    description: p.description ?? "",
    ratio: p.ratio == null ? "" : String(p.ratio),
  };
}

function initialPalette(branding: BrandBranding): BrandColor[] {
  if (Array.isArray(branding.colors) && branding.colors.length) {
    return branding.colors.map((c) => ({ hex: c.hex, name: c.name }));
  }
  // Back-compat: seed from the old discrete color fields if present.
  const legacy: BrandColor[] = [];
  if (branding.primaryColor) legacy.push({ hex: branding.primaryColor, name: "Primary" });
  if (branding.secondaryColor) legacy.push({ hex: branding.secondaryColor, name: "Secondary" });
  if (branding.accentColor) legacy.push({ hex: branding.accentColor, name: "Accent" });
  return legacy;
}

function ProfileEditor({
  brandId,
  detail,
  platforms,
  reload,
  initialSeed,
  initialSourceUrl,
  onboarding = false,
  onClose,
}: {
  brandId: string;
  detail: BrandDetail;
  platforms: PlatformSetting[];
  reload: () => Promise<void>;
  initialSeed?: string;
  initialSourceUrl?: string;
  onboarding?: boolean;
  onClose: () => void;
}) {
  const { me } = useAuth();
  const aiReady = useMemo(
    () => (me?.workspaceConnectors ?? []).some((c) => c.provider === "anthropic"),
    [me],
  );

  const s = detail.settings;
  const voice0 = s.voice ?? {};
  const branding0 = s.branding ?? {};

  // ── editable state ──
  const [why, setWhy] = useState(s.why ?? "");
  const [tones, setTones] = useState<string[]>(
    Array.isArray(voice0.tone) ? (voice0.tone as string[]) : [],
  );
  const [are, setAre] = useState<string[]>(Array.isArray(voice0.are) ? voice0.are : []);
  const [never, setNever] = useState<string[]>(Array.isArray(voice0.never) ? voice0.never : []);
  const [guidelines, setGuidelines] = useState(
    typeof voice0.guidelines === "string" ? voice0.guidelines : "",
  );
  const [visual, setVisual] = useState(
    typeof branding0.visual === "string" ? branding0.visual : (branding0.visualStyle ?? ""),
  );
  const [colors, setColors] = useState<BrandColor[]>(initialPalette(branding0));
  const [logoUrl, setLogoUrl] = useState(branding0.logoUrl ?? "");
  const [font, setFont] = useState(branding0.font ?? "");
  const [description, setDescription] = useState(s.description ?? "");
  const [audience, setAudience] = useState(s.audience ?? "");
  const [pillars, setPillars] = useState<DraftPillar[]>(detail.pillars.map(toDraftPillar));

  // Empty profiles open on the draft hero (unless dismissed / just drafted).
  const startedEmpty =
    !s.why && !s.description && !s.audience && detail.pillars.length === 0 && tones.length === 0;
  const [showHero, setShowHero] = useState(startedEmpty);
  const [step, setStep] = useState(0);

  // Live emptiness — drives the re-draft callout and the overwrite warning
  // when the hero is reopened over a profile that already has answers.
  const profileBlank =
    !why.trim() &&
    !description.trim() &&
    !audience.trim() &&
    pillars.length === 0 &&
    tones.length === 0;

  // ── autosave: settings ──
  const settingsPayload = useMemo(() => {
    const voice: BrandVoice = {
      ...voice0,
      tone: tones,
      are: are.length ? are : undefined,
      never: never.length ? never : undefined,
      guidelines: guidelines.trim() || undefined,
    };
    const branding: BrandBranding = {
      ...branding0,
      visual: visual.trim() || undefined,
      visualStyle: visual.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
      font: font.trim() || undefined,
      colors: colors.length ? colors : undefined,
    };
    return {
      why: why.trim(),
      description: description.trim(),
      audience: audience.trim(),
      voice,
      branding,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [why, tones, are, never, guidelines, visual, colors, logoUrl, font, description, audience]);

  const settingsState = useAutosave(JSON.stringify(settingsPayload), async () => {
    await api.patchBrand(brandId, settingsPayload);
  });

  // ── autosave: pillars (only named rows persist) ──
  const pillarsPayload = useMemo(
    () =>
      pillars
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          description: p.description.trim() || undefined,
          ratio: p.ratio.trim() ? Number(p.ratio) : undefined,
        })),
    [pillars],
  );
  const pillarsState = useAutosave(JSON.stringify(pillarsPayload), async () => {
    await api.putPillars(brandId, pillarsPayload);
  });

  const saveState = mergeSaveState(settingsState, pillarsState);

  // ── apply an AI-drafted profile ──
  const applyDraft = (d: DraftProfile) => {
    if (d.belief) setWhy(d.belief);
    if (d.tone.length) setTones(d.tone.filter((t) => TONE_OPTIONS.includes(t)));
    if (d.voiceGuidelines) setGuidelines(d.voiceGuidelines);
    if (d.product) setDescription(d.product);
    if (d.audience) setAudience(d.audience);
    if (d.visual) setVisual(d.visual);
    if (d.pillars.length) {
      setPillars(
        d.pillars.map((p) => ({
          key: `new${pillarKeySeq++}`,
          name: p.name,
          description: p.description,
          ratio: p.ratio == null ? "" : String(p.ratio),
        })),
      );
    }
    setStep(0);
    setShowHero(false);
  };

  const strength = useMemo(() => {
    const checks = [
      why.trim().length > 20,
      tones.length > 0,
      are.length > 0 || guidelines.trim().length > 15,
      description.trim().length > 15,
      audience.trim().length > 15,
      pillarsPayload.length >= 3,
    ];
    const done = checks.filter(Boolean).length;
    return { pct: Math.round((done / checks.length) * 100), checks };
  }, [why, tones, are, guidelines, description, audience, pillarsPayload]);

  const isLast = step === STEP_DEFS.length - 1;

  const headerActions = (
    <>
      <span className="hidden items-center gap-2 sm:flex" title={`Profile ${strength.pct}% complete`}>
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${strength.pct}%` }}
          />
        </span>
        <span className="text-xs font-semibold tabular-nums text-muted">{strength.pct}%</span>
      </span>
      <SaveStatus state={saveState} />
    </>
  );

  const footer = (
    <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
      <Button
        variant="ghost"
        onClick={() => setStep((n) => Math.max(0, n - 1))}
        disabled={step === 0}
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <span className="text-xs tabular-nums text-faint">
        Step {step + 1} of {STEP_DEFS.length}
      </span>
      {isLast ? (
        <Button onClick={onClose}>
          {onboarding ? "Go to brand home" : "Done"} <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        <Button onClick={() => setStep((n) => Math.min(STEP_DEFS.length - 1, n + 1))}>
          Next <ArrowRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  return (
    <FullScreenDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      eyebrow="Brand profile"
      title={detail.brand.name}
      headerActions={showHero ? <SaveStatus state={saveState} /> : headerActions}
      footer={showHero ? undefined : footer}
    >
      {showHero ? (
        <div className="flex min-h-full items-center justify-center px-6 py-16">
          <DraftHero
            brandId={brandId}
            aiReady={aiReady}
            onDrafted={applyDraft}
            onSkip={() => setShowHero(false)}
            initialSeed={initialSeed}
            initialSourceUrl={initialSourceUrl}
            autoStart={onboarding}
            warnOverwrite={!profileBlank}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl px-6 py-10 md:py-14">
          <StepNav step={step} setStep={setStep} />

          {!aiReady && (
            <div className="mt-8 flex items-center gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>
                Connect Claude in{" "}
                <Link to="/settings" className="font-semibold underline">
                  Settings
                </Link>{" "}
                to draft and refine your profile with AI.
              </span>
            </div>
          )}

          <Reveal key={step} className="mt-12">
            {step === 0 && (
              <>
                {!profileBlank && (
                  <div className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
                    <span className="flex items-center gap-2.5 text-sm text-accent-soft-fg">
                      <Sparkles className="h-4 w-4 shrink-0" />
                      Want a fresh take? Draft this profile from your website, a
                      sentence, or Instagram.
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowHero(true)}
                      className="shrink-0 text-sm font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-100"
                    >
                      Draft with AI →
                    </button>
                  </div>
                )}
                <StepHeader
                  roman="i"
                  eyebrow="Why"
                  title="The belief that drives everything"
                  desc="Not what you sell — why it matters. This anchors every caption the AI writes."
                />
                <RefineField
                  brandId={brandId}
                  field="belief"
                  aiReady={aiReady}
                  value={why}
                  onChange={setWhy}
                  rows={5}
                  serif
                  placeholder="e.g. We believe great design shouldn't be a luxury reserved for those with agency budgets."
                />
              </>
            )}

            {step === 1 && (
              <>
                <StepHeader
                  roman="ii"
                  eyebrow="How"
                  title="How you sound & look"
                  desc="The personality behind every post. Tap the tones that fit, then refine the guidance in your own words."
                />
                <div className="space-y-10">
                  <div>
                    <FieldLabel>Tone</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {TONE_OPTIONS.map((t) => (
                        <Chip
                          key={t}
                          label={t}
                          active={tones.includes(t)}
                          onClick={() =>
                            setTones((p) =>
                              p.includes(t) ? p.filter((x) => x !== t) : [...p, t],
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <WordList
                      label="Words that describe you"
                      hint='Press Enter to add. E.g. "human", "direct".'
                      values={are}
                      onChange={setAre}
                    />
                    <WordList
                      label="Words you'd never use"
                      hint="Helps the AI avoid a tone that doesn't fit."
                      values={never}
                      onChange={setNever}
                      negative
                    />
                  </div>

                  <div>
                    <FieldLabel>Voice guidelines</FieldLabel>
                    <RefineField
                      brandId={brandId}
                      field="voice"
                      aiReady={aiReady}
                      value={guidelines}
                      onChange={setGuidelines}
                      rows={3}
                      placeholder="Always lead with the useful thing. Never open with corporate buzzwords."
                    />
                  </div>

                  <div>
                    <FieldLabel>Brand colors</FieldLabel>
                    <ColorPalette colors={colors} onChange={setColors} />
                  </div>

                  <div>
                    <FieldLabel>Visual direction</FieldLabel>
                    <RefineField
                      brandId={brandId}
                      field="visual"
                      aiReady={aiReady}
                      value={visual}
                      onChange={setVisual}
                      rows={2}
                      placeholder="Warm tones, generous whitespace, real photography over stock. Type-led, never busy."
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label="Logo URL">
                      {(fid) => (
                        <Input id={fid} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
                      )}
                    </Field>
                    <Field label="Font">
                      {(fid) => (
                        <Input id={fid} value={font} onChange={(e) => setFont(e.target.value)} placeholder="Inter, Söhne…" />
                      )}
                    </Field>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <StepHeader
                  roman="iii"
                  eyebrow="What"
                  title="What you make & who it's for"
                  desc="Your product, your audience, and the handful of themes you'll keep coming back to."
                />
                <div className="space-y-10">
                  <div>
                    <FieldLabel>Product or service</FieldLabel>
                    <RefineField
                      brandId={brandId}
                      field="product"
                      aiReady={aiReady}
                      value={description}
                      onChange={setDescription}
                      rows={3}
                      placeholder="A booking tool that fills the empty hours in an independent's calendar."
                    />
                  </div>

                  <div>
                    <FieldLabel>Audience</FieldLabel>
                    <RefineField
                      brandId={brandId}
                      field="audience"
                      aiReady={aiReady}
                      value={audience}
                      onChange={setAudience}
                      rows={3}
                      placeholder="Independent operators running a one-chair business from their phone."
                    />
                  </div>

                  <div>
                    <PillarsEditor
                      rows={pillars}
                      onChange={setPillars}
                      brandId={brandId}
                      aiReady={aiReady}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <StepHeader
                  roman="iv"
                  eyebrow="Channels"
                  title="Where you publish"
                  desc="Per-platform defaults applied at publish time, plus brand management."
                />
                <div className="space-y-10">
                  <PlatformSection brandId={brandId} platforms={platforms} onSaved={reload} />
                  <DangerZone brandId={brandId} brandName={detail.brand.name} />
                </div>
              </>
            )}
          </Reveal>
        </div>
      )}
    </FullScreenDialog>
  );
}

// ── Stepper chrome ────────────────────────────────────────────────────

function StepNav({
  step,
  setStep,
}: {
  step: number;
  setStep: (n: number) => void;
}) {
  return (
    <nav aria-label="Profile sections" className="flex items-center gap-2">
      {STEP_DEFS.map((s, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <Fragment key={s.key}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={active ? "step" : undefined}
              className="group flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border font-serif text-xs transition ${
                  active
                    ? "border-accent bg-accent text-white"
                    : done
                      ? "border-accent-line bg-accent-soft text-accent-soft-fg"
                      : "border-line-strong text-faint group-hover:border-accent group-hover:text-accent"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : s.roman}
              </span>
              <span className="hidden flex-col text-left leading-tight sm:flex">
                <span className={`text-sm font-medium ${active ? "text-ink" : "text-muted"}`}>
                  {s.label}
                </span>
                <span className="text-[11px] text-faint">{s.sub}</span>
              </span>
            </button>
            {i < STEP_DEFS.length - 1 && (
              <span className="h-px flex-1 bg-line" aria-hidden />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function StepHeader({
  roman,
  eyebrow,
  title,
  desc,
}: {
  roman: string;
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <header className="mb-10">
      <span className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-accent">
        <span className="grid h-5 w-5 place-items-center rounded-full border border-accent-line font-serif text-[10px]">
          {roman}
        </span>
        {eyebrow}
      </span>
      <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink text-balance">
        {title}
      </h2>
      <p className="mt-3 max-w-prose text-muted">{desc}</p>
    </header>
  );
}

// ── Draft hero (empty state) ──────────────────────────────────────────

type DraftSource = "website" | "sentence" | "instagram";

function DraftHero({
  brandId,
  aiReady,
  onDrafted,
  onSkip,
  initialSeed,
  initialSourceUrl,
  autoStart = false,
  warnOverwrite = false,
}: {
  brandId: string;
  aiReady: boolean;
  onDrafted: (d: DraftProfile) => void;
  onSkip: () => void;
  initialSeed?: string;
  initialSourceUrl?: string;
  autoStart?: boolean;
  /** Reopened over a filled profile — drafting will replace existing answers. */
  warnOverwrite?: boolean;
}) {
  const [source, setSource] = useState<DraftSource>(
    initialSourceUrl ? "website" : "sentence",
  );
  const [url, setUrl] = useState(initialSourceUrl ?? "");
  const [seed, setSeed] = useState(initialSeed ?? "");
  const [busy, setBusy] = useState<DraftSource | null>(null);
  const [error, setError] = useState("");
  // null until the status check resolves; controls whether the IG tab shows.
  const [igConnected, setIgConnected] = useState<boolean | null>(null);

  // Run any of the three drafting sources through one busy/error envelope.
  const run = async (which: DraftSource, call: () => Promise<DraftProfile>) => {
    if (busy) return;
    setBusy(which);
    setError("");
    try {
      onDrafted(await call());
    } catch (e) {
      setError((e as Error).message || "Couldn't draft a profile.");
      setBusy(null);
    }
  };

  const draftFromWebsite = (value?: string) => {
    const v = (value ?? url).trim();
    if (!v) return;
    return run("website", () => api.aiExtractProfile(brandId, v));
  };
  const draftFromSeed = (value?: string) => {
    const v = (value ?? seed).trim();
    if (!v) return;
    return run("sentence", () => api.aiDraftProfile(brandId, v));
  };
  const draftFromInstagram = () =>
    run("instagram", () => api.aiProfileFromInstagram(brandId));

  // Whether Instagram is connected — surfaces the IG tab. Cheap, runs once.
  useEffect(() => {
    let alive = true;
    api
      .igStatus(brandId)
      .then((s) => alive && setIgConnected(s.connected))
      .catch(() => alive && setIgConnected(false));
    return () => {
      alive = false;
    };
  }, [brandId]);

  // Arriving from brand creation with a source + AI connected: draft immediately
  // so the user lands on a profile that's already coming to life. Runs once.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoStart || !aiReady || autoRan.current) return;
    if ((initialSourceUrl ?? "").trim()) {
      autoRan.current = true;
      void draftFromWebsite(initialSourceUrl);
    } else if ((initialSeed ?? "").trim()) {
      autoRan.current = true;
      void draftFromSeed(initialSeed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TABS: { key: DraftSource; label: string; icon: typeof Globe }[] = [
    { key: "website", label: "Website", icon: Globe },
    { key: "sentence", label: "A sentence", icon: PenLine },
    ...(igConnected ? [{ key: "instagram" as const, label: "Instagram", icon: Camera }] : []),
  ];

  return (
    <div className="mx-auto max-w-xl text-center">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-accent">
        Brand profile
      </p>
      <h2 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink text-balance">
        Let's give your brand a foundation worth building on.
      </h2>
      <p className="mx-auto mt-4 max-w-md text-muted">
        Pull it from your website or Instagram, or describe it in a sentence —
        we'll draft a full profile for you to shape.
      </p>

      {warnOverwrite && (
        <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
          Applying a draft replaces your current answers for the fields it
          fills.
        </p>
      )}

      <div className="mt-8 inline-flex rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = source === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setSource(t.key);
                setError("");
              }}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {source === "website" && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-2 text-left shadow-sm">
          <div className="flex items-center gap-2 px-2 pt-1">
            <Globe className="h-4 w-4 shrink-0 text-faint" />
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && aiReady && !busy && void draftFromWebsite()
              }
              className="border-0 bg-transparent px-0 text-base focus:ring-0"
              placeholder="yourbrand.com"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1">
            <span className="text-xs text-faint">
              We read your public homepage. Nothing is published.
            </span>
            <Button
              onClick={() => void draftFromWebsite()}
              disabled={!aiReady || !!busy || !url.trim()}
            >
              {busy === "website" ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {busy === "website" ? "Reading your site…" : "Import & draft"}
            </Button>
          </div>
        </div>
      )}

      {source === "sentence" && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-2 text-left shadow-sm">
          <Textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            rows={2}
            className="border-0 text-base focus:ring-0"
            placeholder="In a sentence — what are you building, and who is it for?"
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1">
            <span className="text-xs text-faint">
              e.g. “A booking app that helps indie barbers fill empty chairs.”
            </span>
            <Button
              onClick={() => void draftFromSeed()}
              disabled={!aiReady || !!busy || !seed.trim()}
            >
              {busy === "sentence" ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {busy === "sentence" ? "Drafting…" : "Draft my profile"}
            </Button>
          </div>
        </div>
      )}

      {source === "instagram" && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5 text-left shadow-sm">
          <p className="text-sm text-muted">
            We'll read your connected account's bio and recent post captions to
            draft a profile in your existing voice.
          </p>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void draftFromInstagram()}
              disabled={!aiReady || !!busy}
            >
              {busy === "instagram" ? <Spinner /> : <Camera className="h-4 w-4" />}
              {busy === "instagram" ? "Reading Instagram…" : "Draft from Instagram"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!aiReady && (
        <p className="mt-3 text-sm text-faint">
          Connect Claude in Settings to use AI drafting.
        </p>
      )}

      <p className="mt-6 text-sm text-muted">
        {warnOverwrite ? "Keep what you have?" : "Prefer to start from scratch?"}{" "}
        <button onClick={onSkip} className="font-semibold text-accent hover:underline">
          {warnOverwrite ? "Back to editing →" : "Fill it in myself →"}
        </button>
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

// ── Refinable field (inline AI icon + proposal) ───────────────────────

const STEERS = ["Bolder", "Shorter", "Warmer", "More specific"];

function RefineField({
  brandId,
  field,
  aiReady,
  value,
  onChange,
  rows = 3,
  serif = false,
  placeholder,
}: {
  brandId: string;
  field: ProfileField;
  aiReady: boolean;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  serif?: boolean;
  placeholder?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = async (steer?: string) => {
    setBusy(true);
    setError("");
    try {
      const { text } = await api.aiRefineField(brandId, field, value, steer);
      setProposal(text);
    } catch (e) {
      setError((e as Error).message || "AI assist failed.");
      setProposal(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className={`pr-12 ${serif ? "font-serif text-xl leading-relaxed" : ""}`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={!aiReady || busy}
          aria-label="Refine with AI"
          title={aiReady ? "Refine with AI" : "Connect Claude in Settings"}
          className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-lg border border-accent-line bg-surface text-accent shadow-sm outline-none transition hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-brand-100 disabled:opacity-40"
        >
          {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}

      {(proposal !== null || busy) && (
        <div className="mt-2.5 overflow-hidden rounded-xl border border-accent-line bg-surface shadow-sm">
          <div className="border-b border-accent-line px-4 py-2 text-xs font-bold uppercase tracking-wide text-accent-soft-fg">
            AI suggestion
          </div>
          <div className={`px-4 py-3 text-ink ${serif ? "font-serif text-lg leading-relaxed" : "text-sm"}`}>
            {busy ? <span className="text-faint">Thinking…</span> : proposal}
          </div>
          {!busy && proposal !== null && (
            <div className="space-y-2.5 px-4 pb-3.5">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onChange(proposal);
                    setProposal(null);
                  }}
                >
                  Use this
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void run()}>
                  Try another
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
                  Keep mine
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STEERS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => void run(st.toLowerCase())}
                    className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition hover:border-accent hover:text-accent-soft-fg focus-visible:ring-2 focus-visible:ring-brand-100"
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Word-list chip editor ─────────────────────────────────────────────

function WordList({
  label,
  hint,
  values,
  onChange,
  negative = false,
  max = 6,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  negative?: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const commit = () => {
    const w = draft.trim();
    if (!w || values.includes(w) || values.length >= max) return;
    onChange([...values, w]);
    setDraft("");
  };
  const chipCls = negative
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-accent-line bg-accent-soft text-accent-soft-fg";
  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </label>
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        {values.map((w) => (
          <span key={w} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm ${chipCls}`}>
            {w}
            <button
              type="button"
              aria-label={`Remove ${w}`}
              onClick={() => onChange(values.filter((v) => v !== w))}
              className="rounded-full opacity-70 outline-none transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {values.length < max && (
          <input
            id={inputId}
            className="min-w-[7rem] flex-1 border-0 bg-transparent text-sm text-ink placeholder:text-faint outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Backspace" && draft === "" && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={commit}
            placeholder={values.length === 0 ? (negative ? "never…" : "add a word…") : ""}
          />
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

// ── Color palette ─────────────────────────────────────────────────────

function normalizeHex(v: string): string {
  const t = v.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

function ColorPalette({
  colors,
  onChange,
}: {
  colors: BrandColor[];
  onChange: (c: BrandColor[]) => void;
}) {
  const update = (i: number, patch: Partial<BrandColor>) =>
    onChange(colors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-wrap items-start gap-3.5">
      {colors.map((c, i) => (
        <div key={i} className="group relative flex flex-col items-center gap-1.5">
          <label className="relative block h-12 w-12 cursor-pointer overflow-hidden rounded-xl border border-line">
            <span aria-hidden className="block h-full w-full" style={{ background: normalizeHex(c.hex) }} />
            <input
              type="color"
              value={normalizeHex(c.hex)}
              onChange={(e) => update(i, { hex: e.target.value })}
              className="absolute -inset-1 cursor-pointer opacity-0"
              aria-label="Pick color"
            />
          </label>
          <input
            value={c.name ?? ""}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Name"
            className="w-14 border-0 bg-transparent text-center text-[11px] text-muted outline-none focus:text-ink"
            aria-label="Color name"
          />
          <button
            type="button"
            aria-label="Remove color"
            onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
            className="absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full border border-line bg-surface text-faint opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-red-600"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...colors, { hex: "#94a3b8", name: "" }])}
        aria-label="Add color"
        className="grid h-12 w-12 place-items-center rounded-xl border border-dashed border-line-strong text-faint outline-none transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-brand-100"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

// ── Content pillars editor ────────────────────────────────────────────

function ratioSum(rows: DraftPillar[]): number {
  return rows.reduce((acc, r) => {
    const n = Number(r.ratio);
    return acc + (isNaN(n) ? 0 : n);
  }, 0);
}

/** Merge AI-suggested pillars into the existing draft rows: dedupe by
 * case-insensitive trimmed name, cap the total at 12. */
function mergeSuggestedPillars(
  rows: DraftPillar[],
  suggested: SuggestedPillar[],
): DraftPillar[] {
  const seen = new Set(
    rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean),
  );
  const merged = [...rows];
  for (const p of suggested) {
    if (merged.length >= 12) break;
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      key: `new${pillarKeySeq++}`,
      name: p.name,
      description: p.description ?? "",
      ratio: p.ratio == null ? "" : String(p.ratio),
    });
  }
  return merged;
}

type SuggestSource = "profile" | "website" | "note";
const SUGGEST_TABS: { key: SuggestSource; label: string; icon: typeof Globe }[] = [
  { key: "profile", label: "From profile", icon: FileText },
  { key: "website", label: "From website", icon: Globe },
  { key: "note", label: "From a description", icon: PenLine },
];

function SuggestPillarsButton({
  brandId,
  aiReady,
  full,
  rows,
  onChange,
}: {
  brandId: string;
  aiReady: boolean;
  full: boolean;
  rows: DraftPillar[];
  onChange: (r: DraftPillar[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SuggestSource>("profile");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (body: { url?: string; note?: string }) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { pillars } = await api.suggestPillars(brandId, body);
      onChange(mergeSuggestedPillars(rows, pillars));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message || "Couldn't suggest pillars.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" disabled={!aiReady || full}>
          <Sparkles className="h-4 w-4" /> Suggest with AI
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {SUGGEST_TABS.map((t) => {
            const Icon = t.icon;
            const active = source === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setSource(t.key);
                  setError("");
                }}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 ${
                  active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          {source === "profile" && (
            <div>
              <p className="text-sm text-muted">
                Generate pillars from the brand profile you've already written.
              </p>
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={() => void run({})} disabled={busy}>
                  {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                  {busy ? "Suggesting…" : "Suggest"}
                </Button>
              </div>
            </div>
          )}
          {source === "website" && (
            <div>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourbrand.com"
                onKeyDown={(e) =>
                  e.key === "Enter" && !busy && url.trim() && void run({ url: url.trim() })
                }
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void run({ url: url.trim() })}
                  disabled={busy || !url.trim()}
                >
                  {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                  {busy ? "Reading your site…" : "Suggest"}
                </Button>
              </div>
            </div>
          )}
          {source === "note" && (
            <div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Describe the kinds of content you want to post…"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void run({ note: note.trim() })}
                  disabled={busy || !note.trim()}
                >
                  {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                  {busy ? "Suggesting…" : "Suggest"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {!aiReady && (
          <p className="mt-2 text-xs text-faint">Connect Claude in Settings to use AI suggestions.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PillarsEditor({
  rows,
  onChange,
  brandId,
  aiReady,
}: {
  rows: DraftPillar[];
  onChange: (r: DraftPillar[]) => void;
  brandId: string;
  aiReady: boolean;
}) {
  const update = (key: string, patch: Partial<DraftPillar>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= rows.length) return;
    const next = [...rows];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };

  const sum = ratioSum(rows);
  const hasRatios = rows.some((r) => r.ratio.trim() !== "");
  const ratioOff = hasRatios && sum !== 100;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <FieldLabel>
          Content pillars <span className="ml-1 normal-case text-faint">{rows.length}/12</span>
        </FieldLabel>
        {hasRatios && (
          <span className={`text-xs font-medium ${ratioOff ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} aria-live="polite">
            {ratioOff ? `Ratios sum to ${sum}% (aim for 100%)` : "Ratios sum to 100%"}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-faint">
            No pillars yet — add your first recurring content theme.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={r.key} className="rounded-xl border border-line p-3">
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-1">
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-faint transition hover:bg-hover hover:text-ink disabled:opacity-30">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded p-0.5 text-faint transition hover:bg-hover hover:text-ink disabled:opacity-30">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
                <Input aria-label={`Pillar ${i + 1} name`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Pillar name (e.g. Behind the scenes)" />
                <Input aria-label={`Pillar ${i + 1} ratio percent`} type="number" min={0} max={100} value={r.ratio} onChange={(e) => update(r.key, { ratio: e.target.value })} placeholder="%" />
                <Textarea aria-label={`Pillar ${i + 1} description`} rows={2} className="sm:col-span-2" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} placeholder="What this pillar covers (optional)" />
              </div>
              <button type="button" aria-label="Remove pillar" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} className="rounded-lg p-1.5 text-faint transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length >= 12}
            onClick={() =>
              onChange([...rows, { key: `new${pillarKeySeq++}`, name: "", description: "", ratio: "" }])
            }
          >
            <Plus className="h-4 w-4" /> Add pillar
          </Button>
          <SuggestPillarsButton
            brandId={brandId}
            aiReady={aiReady}
            full={rows.length >= 12}
            rows={rows}
            onChange={onChange}
          />
        </div>
      </div>
    </div>
  );
}

// ── Per-platform overrides (explicit save — secondary surface) ────────

const PLATFORM_TABS: { key: PlatformKey; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "facebook", label: "Facebook" },
];

function PlatformSection({
  brandId,
  platforms,
  onSaved,
}: {
  brandId: string;
  platforms: PlatformSetting[];
  onSaved: () => Promise<void>;
}) {
  const [active, setActive] = useState<PlatformKey>("instagram");
  const byPlatform = (k: PlatformKey): Record<string, unknown> =>
    platforms.find((p) => p.platform === k)?.settings ?? {};

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-ink">Platform settings</h2>
      <p className="mt-1 text-sm text-muted">Defaults applied when publishing to each platform.</p>
      <div role="tablist" aria-label="Platform" className="mt-4 flex gap-1 border-b border-line">
        {PLATFORM_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${
              active === t.key ? "border-accent font-medium text-accent-soft-fg" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        <PlatformForm key={active} brandId={brandId} platform={active} initial={byPlatform(active)} onSaved={onSaved} />
      </div>
    </Card>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface PlatformField {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
}
const PLATFORM_FIELDS: Record<PlatformKey, PlatformField[]> = {
  instagram: [
    { key: "defaultHashtags", label: "Default hashtags", hint: "Appended to captions by default.", placeholder: "#brand #studio #design", multiline: true },
    { key: "firstComment", label: "First comment", hint: "Auto-posted as the first comment.", placeholder: "Drop a comment if this resonates", multiline: true },
  ],
  linkedin: [
    { key: "toneOverride", label: "Tone override", placeholder: "More professional than the brand default" },
    { key: "format", label: "Format", hint: "post or article.", placeholder: "post" },
  ],
  facebook: [{ key: "page", label: "Page", hint: "Facebook Page name or id to publish to.", placeholder: "Your Page" }],
};

function PlatformForm({
  brandId,
  platform,
  initial,
  onSaved,
}: {
  brandId: string;
  platform: PlatformKey;
  initial: Record<string, unknown>;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(initial)) out[k] = str(v);
    return out;
  });
  const [state, setState] = useState<SaveState>("idle");
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setState("saving");
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) settings[k] = v.trim();
    try {
      await api.putPlatformSettings(brandId, platform, settings);
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-4">
      {PLATFORM_FIELDS[platform].map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {(fid) =>
            f.multiline ? (
              <Textarea id={fid} rows={2} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
            ) : (
              <Input id={fid} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
            )
          }
        </Field>
      ))}
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save platform settings"}
        </Button>
        {state === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400" role="status">Saved</span>}
        {state === "error" && <span className="text-sm text-red-600" role="alert">Couldn't save — try again.</span>}
      </div>
    </div>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────

function DangerZone({ brandId, brandName }: { brandId: string; brandName: string }) {
  const navigate = useNavigate();
  const { brands, activeBrandId, switchBrand, refresh } = useBrand();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = typed.trim() === brandName;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTyped("");
      setError("");
    }
  };

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteBrand(brandId, true);
      const wasActive = activeBrandId === brandId;
      const fallback = brands.find((b) => b.id !== brandId);
      if (wasActive && fallback) await switchBrand(fallback.id);
      else await refresh();
      navigate("/brands", { replace: true });
    } catch (e) {
      setError((e as Error).message || "Couldn't delete this brand.");
      setBusy(false);
    }
  };

  return (
    <Card className="border-red-200 p-6">
      <h2 className="text-base font-semibold text-red-600">Danger zone</h2>
      <p className="mt-1 text-sm text-muted">
        Permanently delete this brand, its settings, connected accounts, posts, and media. This cannot be undone.
      </p>
      <div className="mt-4">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button variant="danger">Delete brand</Button>
          </DialogTrigger>
          <DialogContent title="Delete brand" description={`This permanently deletes "${brandName}" and all of its data. This cannot be undone.`}>
            <div className="space-y-4">
              <Field label="Type the brand name to confirm" hint={`Enter "${brandName}" exactly.`}>
                {(fid) => <Input id={fid} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={brandName} />}
              </Field>
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="secondary" disabled={busy}>Cancel</Button>
                </DialogClose>
                <Button variant="danger" onClick={() => void confirm()} disabled={!matches || busy}>
                  {busy ? "Deleting…" : "Delete brand"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AtSign,
  Bot,
  Camera,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Mic,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  api,
  type GenerationCapability,
  type GenerationDefaults,
  type IgStatus,
  type WorkspaceProvider,
} from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Input,
  StatusPill,
  inputCls,
} from "../components/ui";

type SectionId = "providers" | "instagram" | "data";

const SECTIONS: {
  id: SectionId;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "providers", label: "AI providers", sub: "Bring your own keys", icon: Bot },
  { id: "instagram", label: "Instagram", sub: "Per-brand connection", icon: AtSign },
  { id: "data", label: "Data & privacy", sub: "Export or delete", icon: ShieldAlert },
];

export function Settings() {
  const { refresh } = useAuth();
  const { activeWorkspaceId, activeBrand, activeBrandId } = useBrand();
  // Deep-links (e.g. Home's setup checklist) can land on a specific section.
  const { state } = useLocation();
  const requested = (state as { section?: SectionId } | null)?.section;
  const [active, setActive] = useState<SectionId>(
    requested && SECTIONS.some((s) => s.id === requested) ? requested : "providers",
  );

  return (
    <AppShell title="Settings" subtitle="Workspace & connectors" bleed>
      <div className="px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 border-b border-line pb-6">
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
              Settings
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              Manage your workspace keys, connected accounts, and account data.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
            <SettingsNav active={active} onChange={setActive} />

            <div className="min-w-0 max-w-2xl">
              {active === "providers" && (
                <SectionPanel
                  icon={Bot}
                  eyebrow="Workspace"
                  title="AI providers"
                  desc="Bring your own keys. Stored encrypted — we never show them back."
                >
                  <AiProviders workspaceId={activeWorkspaceId} reload={refresh} />
                </SectionPanel>
              )}

              {active === "instagram" && (
                <SectionPanel
                  icon={AtSign}
                  eyebrow="Connection"
                  title="Instagram"
                  desc={`Connected per brand${
                    activeBrand ? ` — currently ${activeBrand.name}.` : "."
                  }`}
                >
                  <InstagramConnector brandId={activeBrandId} />
                </SectionPanel>
              )}

              {active === "data" && (
                <div className="space-y-12">
                  <SectionPanel
                    icon={Download}
                    eyebrow="Account"
                    title="Export my data"
                    desc="Download everything we hold for your account as a JSON file."
                  >
                    <ExportData />
                  </SectionPanel>

                  <SectionPanel
                    icon={ShieldAlert}
                    eyebrow="Privacy"
                    title="Danger zone"
                    desc="Irreversible actions. Proceed with care."
                    danger
                  >
                    <DeleteAccount />
                  </SectionPanel>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsNav({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1.5 overflow-x-auto pb-1 lg:sticky lg:top-24 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
    >
      <p className="mb-1 hidden px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-faint lg:block">
        Settings
      </p>
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(s.id)}
            className={`group flex shrink-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 ${
              isActive
                ? "bg-accent-soft text-accent-soft-fg"
                : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${
                isActive
                  ? "bg-accent text-white shadow-sm"
                  : "bg-hover text-muted group-hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">{s.label}</span>
              <span className="hidden text-[11px] text-faint lg:block">{s.sub}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function SectionPanel({
  icon: Icon,
  eyebrow,
  title,
  desc,
  danger = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  desc: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${
              danger
                ? "bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30"
                : "bg-accent-soft text-accent-soft-fg ring-accent-line"
            }`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p
              className={`text-[11px] font-bold uppercase tracking-[0.14em] ${
                danger ? "text-red-600 dark:text-red-400" : "text-accent"
              }`}
            >
              {eyebrow}
            </p>
            <h2
              className={`text-lg font-semibold tracking-tight ${
                danger ? "text-red-600 dark:text-red-400" : "text-ink"
              }`}
            >
              {title}
            </h2>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">{desc}</p>
        <div
          className={`mt-4 h-px bg-gradient-to-r to-transparent ${
            danger ? "from-red-200 dark:from-red-500/40" : "from-line-strong via-line"
          }`}
        />
      </header>
      {children}
    </section>
  );
}

function ExportData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await api.exportAccount();
    } catch {
      setError("Couldn't generate your export — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-ink">Account data export</div>
        <div className="text-xs text-faint">
          Brands, settings, and posts. No keys or secrets are included.
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        onClick={() => void run()}
        disabled={busy}
        className="shrink-0"
      >
        {busy ? "Preparing…" : "Export my data"}
      </Button>
    </Card>
  );
}

function DeleteAccount() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const email = me?.user.email ?? "";

  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setConfirmEmail("");
      setError("");
    }
  };

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount(confirmEmail.trim());
      // Session is cleared server-side; drop client auth state and leave.
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setError((e as Error).message || "Couldn't delete your account.");
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-red-200 dark:border-red-500/30 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-ink">Delete account</div>
        <div className="text-xs text-faint">
          Permanently removes your account, brands, connected accounts, and
          media. This cannot be undone.
        </div>
      </div>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button variant="danger" className="shrink-0">
            Delete account
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Delete account"
          description="This permanently deletes your account and all associated data. This cannot be undone."
        >
          <div className="space-y-4">
            <Field
              label="Type your email to confirm"
              hint="This must match the email on your account."
            >
              {(fid) => (
                <Input
                  id={fid}
                  type="email"
                  autoComplete="off"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={email}
                />
              )}
            </Field>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                onClick={() => void confirm()}
                disabled={!matches || busy}
              >
                {busy ? "Deleting…" : "Delete account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const AI_PROVIDERS: {
  provider: WorkspaceProvider;
  label: string;
  hint: string;
  keyFormat: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    provider: "anthropic",
    label: "Claude (Anthropic)",
    hint: "Powers AI caption assist and analytics insights.",
    keyFormat: "sk-ant-…",
    icon: Bot,
  },
  {
    provider: "higgsfield",
    label: "Higgsfield",
    hint: "Image & video generation, via the Higgsfield MCP.",
    keyFormat: "your API key",
    icon: Clapperboard,
  },
  {
    provider: "fal",
    label: "fal.ai",
    hint: "Server-side image (FLUX) & video (Kling) generation for posts and the agent.",
    keyFormat: "key_id:key_secret",
    icon: ImagePlus,
  },
  {
    provider: "elevenlabs",
    label: "ElevenLabs",
    hint: "Voiceover audio (text-to-speech) for Reels and slideshows.",
    keyFormat: "sk_…",
    icon: Mic,
  },
];

function AiProviders({
  workspaceId,
  reload,
}: {
  workspaceId: string | null;
  reload: () => Promise<void>;
}) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (workspaceId == null) {
      setLoading(false);
      return;
    }
    setError(false);
    try {
      const { connectors } = await api.listWorkspaceConnectors(workspaceId);
      const map: Record<string, string> = {};
      for (const c of connectors) map[c.provider] = c.status;
      setStatuses(map);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (workspaceId == null) {
    return (
      <Card className="p-6 text-sm text-faint">No active workspace.</Card>
    );
  }
  if (loading) {
    return <Card className="p-6 text-sm text-faint">Loading…</Card>;
  }
  if (error) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-muted">Couldn't load providers.</p>
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {AI_PROVIDERS.map((p) => (
        <ProviderCard
          key={p.provider}
          workspaceId={workspaceId}
          provider={p.provider}
          label={p.label}
          hint={p.hint}
          keyFormat={p.keyFormat}
          icon={p.icon}
          connected={statuses[p.provider] === "connected"}
          onChange={async () => {
            await load();
            await reload();
          }}
        />
      ))}
      <GenerationDefaultsCard workspaceId={workspaceId} statuses={statuses} />
    </div>
  );
}

// Per-capability provider + model options, mirrored from the backend's
// CAPABILITY_PROVIDERS and each connector's model allowlist.
const GEN_CAPABILITIES: {
  cap: GenerationCapability;
  label: string;
  providers: { provider: WorkspaceProvider; label: string }[];
  models: Partial<Record<WorkspaceProvider, { id: string; label: string }[]>>;
}[] = [
  {
    cap: "image",
    label: "Image generation",
    providers: [{ provider: "fal", label: "fal.ai (FLUX)" }],
    models: {
      fal: [
        { id: "fal-ai/flux/dev", label: "FLUX dev — balanced (default)" },
        { id: "fal-ai/flux/schnell", label: "FLUX schnell — fast & cheap" },
        { id: "fal-ai/flux-pro/v1.1", label: "FLUX1.1 pro — premium" },
      ],
    },
  },
  {
    cap: "video",
    label: "Video generation",
    providers: [{ provider: "fal", label: "fal.ai (Kling)" }],
    models: {
      fal: [
        {
          id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
          label: "Kling 2.5 turbo — price/perf (default)",
        },
        {
          id: "fal-ai/kling-video/v3/standard/text-to-video",
          label: "Kling 3 standard — higher quality",
        },
      ],
    },
  },
  {
    cap: "voice",
    label: "Voice (TTS)",
    providers: [{ provider: "elevenlabs", label: "ElevenLabs" }],
    models: {
      elevenlabs: [
        { id: "eleven_multilingual_v2", label: "Multilingual v2 (default)" },
        { id: "eleven_flash_v2_5", label: "Flash v2.5 — fast & cheap" },
        { id: "eleven_v3", label: "Eleven v3 — most expressive" },
      ],
    },
  },
];

function GenerationDefaultsCard({
  workspaceId,
  statuses,
}: {
  workspaceId: string;
  statuses: Record<string, string>;
}) {
  const [defaults, setDefaults] = useState<GenerationDefaults>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getGenerationDefaults(workspaceId)
      .then(({ defaults }) => {
        if (!cancelled) setDefaults(defaults);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load generation defaults.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const save = async (
    cap: GenerationCapability,
    value: { provider: WorkspaceProvider; model?: string } | null,
  ) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.setGenerationDefault(workspaceId, cap, value);
      setDefaults(res.defaults);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3 p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg ring-1 ring-accent-line">
          <SlidersHorizontal className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-ink">Generation defaults</h3>
          <p className="mt-0.5 text-xs text-faint">
            Which provider handles each kind of generation when a request
            doesn't name one.
          </p>
        </div>
      </div>
      <div className="space-y-3 border-t border-line bg-canvas px-5 py-4">
        {GEN_CAPABILITIES.map(({ cap, label, providers, models }) => {
          const connected = providers.filter(
            (p) => statuses[p.provider] === "connected",
          );
          const current = defaults[cap];
          // A default pointing at a since-disconnected provider counts as unset.
          const currentProvider =
            current && statuses[current.provider] === "connected"
              ? current.provider
              : "";
          const modelOptions = currentProvider
            ? models[currentProvider] ?? []
            : [];
          return (
            <div key={cap} className="flex flex-wrap items-center gap-3">
              <span className="w-36 text-sm text-muted">{label}</span>
              {connected.length === 0 ? (
                <span className="text-sm text-faint">
                  Connect {providers.map((p) => p.label).join(" or ")} above to
                  enable.
                </span>
              ) : (
                <>
                  <select
                    className={`${inputCls} w-auto`}
                    value={currentProvider}
                    disabled={busy}
                    aria-label={`Default ${label.toLowerCase()} provider`}
                    onChange={(e) => {
                      const provider = e.target.value as WorkspaceProvider | "";
                      void save(cap, provider ? { provider } : null);
                    }}
                  >
                    <option value="">Auto (only connected provider)</option>
                    {connected.map((p) => (
                      <option key={p.provider} value={p.provider}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {currentProvider && modelOptions.length > 0 && (
                    <select
                      className={`${inputCls} w-auto`}
                      value={current?.model ?? modelOptions[0].id}
                      disabled={busy}
                      aria-label={`Default ${label.toLowerCase()} model`}
                      onChange={(e) =>
                        void save(cap, {
                          provider: currentProvider,
                          model: e.target.value,
                        })
                      }
                    >
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          );
        })}
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function ProviderCard({
  workspaceId,
  provider,
  label,
  hint,
  keyFormat,
  icon: Icon,
  connected,
  onChange,
}: {
  workspaceId: string;
  provider: WorkspaceProvider;
  label: string;
  hint: string;
  keyFormat: string;
  icon: React.ComponentType<{ className?: string }>;
  connected: boolean;
  onChange: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Show the key field when nothing is stored yet, or when replacing a key.
  const showInput = !connected || editing;

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.setWorkspaceConnector(workspaceId, provider, key.trim());
      setKey("");
      setReveal(false);
      setEditing(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await api.deleteWorkspaceConnector(workspaceId, provider);
      setEditing(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setKey("");
    setReveal(false);
    setError("");
  };

  return (
    <Card
      className={`overflow-hidden transition ${
        connected ? "ring-1 ring-emerald-200/70 dark:ring-emerald-500/20" : ""
      }`}
    >
      <div className="flex items-start gap-3 p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg ring-1 ring-accent-line">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-medium text-ink">{label}</h3>
            {connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" /> Connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-faint">{hint}</p>
        </div>
      </div>

      {/* Body: stored-key summary, or the key-entry form */}
      <div className="border-t border-line bg-canvas px-5 py-4">
        {!showInput ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
              <KeyRound className="h-4 w-4 shrink-0 text-faint" />
              <span className="font-mono tracking-[0.2em] text-faint">••••••••</span>
              <span className="hidden text-xs text-faint sm:inline">
                · stored encrypted
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={busy}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Replace
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={remove}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" /> {busy ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  aria-label={`${label} API key`}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save();
                  }}
                  placeholder={`Paste ${keyFormat}`}
                  className="pl-9 pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide key" : "Show key"}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={save}
                  disabled={busy || !key.trim()}
                  className="shrink-0"
                >
                  {busy ? "Saving…" : "Save key"}
                </Button>
                {connected && editing && (
                  <Button
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={busy}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-faint">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              Encrypted with AES-256 before it's stored. We never show it again.
            </p>
          </div>
        )}
        {error && (
          <p className="mt-2.5 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function InstagramConnector({ brandId }: { brandId: string | null }) {
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (brandId == null) {
      setIg({ connected: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setIg(await api.igStatus(brandId));
    } catch {
      setIg({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (brandId == null) {
      setError("No active brand — create one first.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const { url } = await api.igConnectUrl(brandId);
      const win = window.open(url, "_blank");
      const onFocus = () => {
        void load();
        window.removeEventListener("focus", onFocus);
      };
      window.addEventListener("focus", onFocus);
      if (!win) setError("Popup blocked — allow popups and retry.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-amber-400 text-white shadow-sm">
            <Camera className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink">Instagram</div>
            <div className="truncate text-xs text-faint">
              {loading
                ? "Checking…"
                : ig?.connected
                  ? `Connected as @${ig.username ?? "—"}`
                  : "Business / Creator account"}
            </div>
          </div>
        </div>
        {!loading &&
          (ig?.connected ? (
            <StatusPill connected />
          ) : (
            <Button
              onClick={connect}
              disabled={connecting || brandId == null}
              size="sm"
            >
              {connecting ? "Opening…" : "Connect"}
            </Button>
          ))}
      </div>
      {ig?.connected && ig.tokenExpiresAt && (
        <p className="mt-3 text-xs text-faint">
          Token valid until{" "}
          {new Date(ig.tokenExpiresAt).toLocaleDateString()}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

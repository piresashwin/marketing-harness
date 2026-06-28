import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type BrandBranding,
  type BrandDetail,
  type BrandVoice,
  type Pillar,
  type PlatformKey,
  type PlatformSetting,
} from "../api";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import {
  Button,
  Card,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Input,
  Textarea,
} from "../components/ui";

const TONES = [
  "Friendly",
  "Professional",
  "Playful",
  "Bold",
  "Minimal",
  "Inspirational",
  "Witty",
  "Luxury",
];

type SaveState = "idle" | "saving" | "saved" | "error";

function SaveButton({
  state,
  onClick,
  label = "Save changes",
}: {
  state: SaveState;
  onClick: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button onClick={onClick} disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : label}
      </Button>
      {state === "saved" && (
        <span className="text-sm text-emerald-600" role="status">
          Saved
        </span>
      )}
      {state === "error" && (
        <span className="text-sm text-red-600" role="alert">
          Couldn’t save — try again.
        </span>
      )}
    </div>
  );
}

export function BrandSettings() {
  const { id } = useParams<{ id: string }>();
  const brandId = id ?? null;
  const { brands } = useBrand();

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

  const brandName =
    detail?.brand.name ?? brands.find((b) => b.id === brandId)?.name ?? "Brand";

  return (
    <AppShell title="Brand settings" subtitle={brandName}>
      <div className="mb-5">
        <Link
          to="/brands"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← All brands
        </Link>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading…</Card>
      ) : loadError || !detail || brandId == null ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-500">Couldn’t load this brand.</p>
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <IdentitySection
            brandId={brandId}
            settings={detail.settings}
            onSaved={load}
          />
          <PillarsSection
            brandId={brandId}
            pillars={detail.pillars}
            onSaved={load}
          />
          <PlatformSection
            brandId={brandId}
            platforms={platforms}
            onSaved={load}
          />
          <DangerZone brandId={brandId} brandName={detail.brand.name} />
        </div>
      )}
    </AppShell>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────
function DangerZone({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
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
      if (wasActive && fallback) {
        // Point the active context at a surviving brand before refreshing.
        await switchBrand(fallback.id);
      } else {
        await refresh();
      }
      navigate("/brands", { replace: true });
    } catch (e) {
      setError((e as Error).message || "Couldn’t delete this brand.");
      setBusy(false);
    }
  };

  return (
    <Card className="border-red-200 p-6">
      <h2 className="text-base font-semibold text-red-600">Danger zone</h2>
      <p className="mt-1 text-sm text-slate-500">
        Permanently delete this brand, its settings, connected accounts, posts,
        and media. This cannot be undone.
      </p>
      <div className="mt-4">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button variant="danger">Delete brand</Button>
          </DialogTrigger>
          <DialogContent
            title="Delete brand"
            description={`This permanently deletes “${brandName}” and all of its data. This cannot be undone.`}
          >
            <div className="space-y-4">
              <Field
                label="Type the brand name to confirm"
                hint={`Enter “${brandName}” exactly.`}
              >
                {(fid) => (
                  <Input
                    id={fid}
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={brandName}
                  />
                )}
              </Field>
              {error && (
                <p className="text-sm text-red-600" role="alert">
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

// ── Identity & voice ──────────────────────────────────────────────────
function IdentitySection({
  brandId,
  settings,
  onSaved,
}: {
  brandId: string;
  settings: BrandDetail["settings"];
  onSaved: () => Promise<void>;
}) {
  const [description, setDescription] = useState(settings.description ?? "");
  const [audience, setAudience] = useState(settings.audience ?? "");
  const [tones, setTones] = useState<string[]>(
    Array.isArray(settings.voice?.tone) ? (settings.voice!.tone as string[]) : [],
  );
  const [guidelines, setGuidelines] = useState(
    typeof settings.voice?.guidelines === "string"
      ? settings.voice.guidelines
      : "",
  );
  const branding = settings.branding ?? {};
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(
    branding.secondaryColor ?? "",
  );
  const [accentColor, setAccentColor] = useState(branding.accentColor ?? "");
  const [font, setFont] = useState(branding.font ?? "");
  const [visualStyle, setVisualStyle] = useState(branding.visualStyle ?? "");
  const [state, setState] = useState<SaveState>("idle");

  const toggleTone = (t: string) =>
    setTones((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );

  const save = async () => {
    setState("saving");
    // voice/branding are REPLACED WHOLESALE — preserve any unknown keys we got.
    const voice: BrandVoice = {
      ...settings.voice,
      tone: tones,
      guidelines: guidelines.trim() || undefined,
    };
    const newBranding: BrandBranding = {
      ...settings.branding,
      logoUrl: logoUrl.trim() || undefined,
      primaryColor: primaryColor.trim() || undefined,
      secondaryColor: secondaryColor.trim() || undefined,
      accentColor: accentColor.trim() || undefined,
      font: font.trim() || undefined,
      visualStyle: visualStyle.trim() || undefined,
    };
    try {
      await api.patchBrand(brandId, {
        description: description.trim(),
        audience: audience.trim(),
        voice,
        branding: newBranding,
      });
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">Identity & voice</h2>
      <p className="mt-1 text-sm text-slate-500">
        How the AI describes and writes for this brand.
      </p>

      <div className="mt-5 space-y-5">
        <Field label="Description">
          {(fid) => (
            <Textarea
              id={fid}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this brand does and stands for"
            />
          )}
        </Field>
        <Field label="Audience">
          {(fid) => (
            <Textarea
              id={fid}
              rows={3}
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Who you're speaking to"
            />
          )}
        </Field>

        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">
            Voice
          </span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <Chip
                key={t}
                label={t}
                active={tones.includes(t)}
                onClick={() => toggleTone(t)}
              />
            ))}
          </div>
        </div>
        <Field label="Voice guidelines">
          {(fid) => (
            <Textarea
              id={fid}
              rows={3}
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder="Do's and don'ts, words to avoid, signature phrases…"
            />
          )}
        </Field>

        <div className="border-t border-slate-100 pt-5">
          <span className="mb-3 block text-sm font-semibold text-slate-700">
            Branding
          </span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Logo URL">
              {(fid) => (
                <Input
                  id={fid}
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://…"
                />
              )}
            </Field>
            <Field label="Font">
              {(fid) => (
                <Input
                  id={fid}
                  value={font}
                  onChange={(e) => setFont(e.target.value)}
                  placeholder="Inter, Söhne…"
                />
              )}
            </Field>
            <ColorField
              label="Primary color"
              value={primaryColor}
              onChange={setPrimaryColor}
            />
            <ColorField
              label="Secondary color"
              value={secondaryColor}
              onChange={setSecondaryColor}
            />
            <ColorField
              label="Accent color"
              value={accentColor}
              onChange={setAccentColor}
            />
          </div>
          <div className="mt-4">
            <Field label="Visual style notes">
              {(fid) => (
                <Textarea
                  id={fid}
                  rows={2}
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value)}
                  placeholder="Photography, illustration, mood, composition…"
                />
              )}
            </Field>
          </div>
        </div>

        <SaveButton state={state} onClick={save} />
      </div>
    </Card>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = /^#?[0-9a-fA-F]{3,8}$/.test(value.trim());
  const swatch = value.trim()
    ? value.trim().startsWith("#")
      ? value.trim()
      : `#${value.trim()}`
    : "transparent";
  return (
    <Field label={label}>
      {(fid) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-9 w-9 shrink-0 rounded-lg border border-slate-200"
            style={{ background: valid ? swatch : "transparent" }}
          />
          <Input
            id={fid}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#4f46e5"
          />
        </div>
      )}
    </Field>
  );
}

// ── Content pillars ───────────────────────────────────────────────────
interface DraftPillar {
  key: string;
  name: string;
  description: string;
  ratio: string;
}

let pillarKeySeq = 0;
function toDraft(p: Pillar): DraftPillar {
  return {
    key: `p${p.id}`,
    name: p.name,
    description: p.description ?? "",
    ratio: p.ratio == null ? "" : String(p.ratio),
  };
}

function PillarsSection({
  brandId,
  pillars,
  onSaved,
}: {
  brandId: string;
  pillars: Pillar[];
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<DraftPillar[]>(pillars.map(toDraft));
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  const update = (key: string, patch: Partial<DraftPillar>) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  const remove = (key: string) =>
    setRows((prev) => prev.filter((r) => r.key !== key));
  const add = () =>
    setRows((prev) =>
      prev.length >= 12
        ? prev
        : [
            ...prev,
            {
              key: `new${pillarKeySeq++}`,
              name: "",
              description: "",
              ratio: "",
            },
          ],
    );
  const move = (index: number, dir: -1 | 1) =>
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    if (rows.some((r) => !r.name.trim())) {
      setError("Every pillar needs a name (or remove the empty rows).");
      setState("error");
      return;
    }
    setError("");
    setState("saving");
    try {
      const saved = await api.putPillars(
        brandId,
        rows.map((r) => ({
          name: r.name.trim(),
          description: r.description.trim() || undefined,
          ratio: r.ratio.trim() ? Number(r.ratio) : undefined,
        })),
      );
      setRows(saved.map(toDraft));
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Content pillars
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Recurring themes and how often you post each ({rows.length}/12).
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            No pillars yet. Add one below.
          </p>
        )}
        {rows.map((r, i) => (
          <div
            key={r.key}
            className="rounded-xl border border-slate-200 p-3"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  aria-label="Move up"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded p-0.5 text-slate-400 outline-none hover:bg-slate-100 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-brand-100"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  aria-label="Move down"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="rounded p-0.5 text-slate-400 outline-none hover:bg-slate-100 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-brand-100"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
                <Input
                  aria-label={`Pillar ${i + 1} name`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  placeholder="Pillar name (e.g. Behind the scenes)"
                />
                <div className="flex items-center gap-1">
                  <Input
                    aria-label={`Pillar ${i + 1} ratio percent`}
                    type="number"
                    min={0}
                    max={100}
                    value={r.ratio}
                    onChange={(e) => update(r.key, { ratio: e.target.value })}
                    placeholder="%"
                  />
                </div>
                <Textarea
                  aria-label={`Pillar ${i + 1} description`}
                  rows={2}
                  className="sm:col-span-2"
                  value={r.description}
                  onChange={(e) =>
                    update(r.key, { description: e.target.value })
                  }
                  placeholder="What this pillar covers (optional)"
                />
              </div>
              <button
                aria-label="Remove pillar"
                onClick={() => remove(r.key)}
                className="rounded-lg p-1.5 text-slate-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-brand-100"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        <Button
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={rows.length >= 12}
        >
          ＋ Add pillar
        </Button>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="pt-1">
          <SaveButton state={state} onClick={save} label="Save pillars" />
        </div>
      </div>
    </Card>
  );
}

// ── Per-platform overrides ────────────────────────────────────────────
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
      <h2 className="text-base font-semibold text-slate-900">
        Per-platform overrides
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Defaults applied when publishing to each platform.
      </p>

      <div
        role="tablist"
        aria-label="Platform"
        className="mt-4 flex gap-1 border-b border-slate-200"
      >
        {PLATFORM_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${
              active === t.key
                ? "border-brand-600 font-medium text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <PlatformForm
          key={active}
          brandId={brandId}
          platform={active}
          initial={byPlatform(active)}
          onSaved={onSaved}
        />
      </div>
    </Card>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

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

  const set = (k: string, v: string) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setState("saving");
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) settings[k] = v.trim();
    }
    try {
      await api.putPlatformSettings(brandId, platform, settings);
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  };

  const fields = PLATFORM_FIELDS[platform];

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {(fid) =>
            f.multiline ? (
              <Textarea
                id={fid}
                rows={2}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            ) : (
              <Input
                id={fid}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )
          }
        </Field>
      ))}
      <SaveButton state={state} onClick={save} label="Save platform settings" />
    </div>
  );
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
    {
      key: "defaultHashtags",
      label: "Default hashtags",
      hint: "Appended to captions by default.",
      placeholder: "#brand #studio #design",
      multiline: true,
    },
    {
      key: "firstComment",
      label: "First comment",
      hint: "Auto-posted as the first comment.",
      placeholder: "Drop a 💜 if this resonates",
      multiline: true,
    },
  ],
  linkedin: [
    {
      key: "toneOverride",
      label: "Tone override",
      placeholder: "More professional than the brand default",
    },
    {
      key: "format",
      label: "Format",
      hint: "post or article.",
      placeholder: "post",
    },
  ],
  facebook: [
    {
      key: "page",
      label: "Page",
      hint: "Facebook Page name or id to publish to.",
      placeholder: "Your Page",
    },
  ],
};

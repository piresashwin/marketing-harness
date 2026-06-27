import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const VOICES = [
  "Friendly",
  "Professional",
  "Playful",
  "Bold",
  "Minimal",
  "Inspirational",
  "Witty",
  "Luxury",
];
const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "X", "Facebook", "YouTube"];
const CADENCES = ["Daily", "3× / week", "Weekly", "A few times a month"];

interface Form {
  displayName: string;
  brandName: string;
  website: string;
  industry: string;
  audience: string;
  brandVoice: string[];
  platforms: string[];
  goals: string;
  cadence: string;
}

const STEPS = ["Your brand", "Audience & voice", "Goals"];

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
        active
          ? "border-brand-600 bg-brand-50 text-brand-700"
          : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function Onboarding() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState<Form>({
    displayName: "",
    brandName: "",
    website: "",
    industry: "",
    audience: "",
    brandVoice: [],
    platforms: ["Instagram"],
    goals: "",
    cadence: "Weekly",
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const toggle = (k: "brandVoice" | "platforms", v: string) =>
    setF((prev) => ({
      ...prev,
      [k]: prev[k].includes(v)
        ? prev[k].filter((x) => x !== v)
        : [...prev[k], v],
    }));

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      await api.saveOnboarding({ ...f });
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Let's set up your workspace
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          A few quick questions so the AI can write in your voice.
        </p>
        <div className="mt-5 flex gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div
                className={`h-1.5 rounded-full ${
                  i <= step ? "bg-brand-600" : "bg-slate-200"
                }`}
              />
              <span
                className={`mt-1.5 block text-xs ${
                  i === step ? "font-medium text-brand-700" : "text-slate-400"
                }`}
              >
                {s}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Your name">
              <input
                className={inputCls}
                value={f.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder="Alex Pires"
              />
            </Field>
            <Field label="Brand / business name">
              <input
                className={inputCls}
                value={f.brandName}
                onChange={(e) => set("brandName", e.target.value)}
                placeholder="Zenith Studio"
              />
            </Field>
            <Field label="Website (optional)">
              <input
                className={inputCls}
                value={f.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Industry / niche">
              <input
                className={inputCls}
                value={f.industry}
                onChange={(e) => set("industry", e.target.value)}
                placeholder="Fitness, SaaS, fashion…"
              />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Field label="Who is your audience?">
              <textarea
                className={inputCls}
                rows={3}
                value={f.audience}
                onChange={(e) => set("audience", e.target.value)}
                placeholder="e.g. busy founders aged 25–40 who care about design"
              />
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Brand voice
              </span>
              <div className="flex flex-wrap gap-2">
                {VOICES.map((v) => (
                  <Chip
                    key={v}
                    label={v}
                    active={f.brandVoice.includes(v)}
                    onClick={() => toggle("brandVoice", v)}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Platforms you post on
              </span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <Chip
                    key={p}
                    label={p}
                    active={f.platforms.includes(p)}
                    onClick={() => toggle("platforms", p)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Field label="What are your goals?">
              <textarea
                className={inputCls}
                rows={3}
                value={f.goals}
                onChange={(e) => set("goals", e.target.value)}
                placeholder="Grow followers, drive sign-ups, build a community…"
              />
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Posting cadence
              </span>
              <div className="flex flex-wrap gap-2">
                {CADENCES.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={f.cadence === c}
                    onClick={() => set("cadence", c)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-0"
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Finish & go to dashboard"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

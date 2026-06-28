import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type IgStatus } from "../api";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { Button, Card, Textarea } from "../components/ui";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Compose() {
  const { activeBrand, activeBrandId } = useBrand();
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [igError, setIgError] = useState(false);

  const loadIg = useCallback(async () => {
    if (activeBrandId == null) {
      setIg({ connected: false });
      return;
    }
    setIgError(false);
    try {
      setIg(await api.igStatus(activeBrandId));
    } catch {
      setIg({ connected: false });
      setIgError(true);
    }
  }, [activeBrandId]);

  useEffect(() => {
    void loadIg();
  }, [loadIg]);

  return (
    <AppShell
      title="Compose"
      subtitle={activeBrand ? `Posting as ${activeBrand.name}` : undefined}
      actions={<ConnectionPill ig={ig} />}
    >
      {activeBrandId == null ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No active brand. Create one to start composing.
        </Card>
      ) : (
        <Composer ig={ig} igError={igError} brandId={activeBrandId} />
      )}
    </AppShell>
  );
}

function ConnectionPill({ ig }: { ig: IgStatus | null }) {
  if (!ig) return null;
  return (
    <span
      className={`hidden rounded-full px-3 py-1 text-xs font-medium sm:inline ${
        ig.connected
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {ig.connected
        ? `📸 @${ig.username ?? "connected"}`
        : "Instagram not connected"}
    </span>
  );
}

function Composer({
  ig,
  igError,
  brandId,
}: {
  ig: IgStatus | null;
  igError: boolean;
  brandId: string;
}) {
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [contentType, setContentType] = useState("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiNote, setAiNote] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setContentType(file.type || "image/jpeg");
    setPreview(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
  };

  const aiAssist = async () => {
    setAiNote("");
    setAiBusy(true);
    try {
      const r = await api.aiCaption(
        brandId,
        caption.trim() || undefined,
        "instagram",
      );
      setCaption(r.caption);
    } catch (e) {
      setAiNote((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const publish = async () => {
    if (!base64) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.igPublish(brandId, {
        caption,
        imageBase64: base64,
        contentType,
      });
      setResult({
        ok: true,
        msg: r.permalink ? `Published → ${r.permalink}` : "Published!",
      });
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {igError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn’t check the Instagram connection. Try again shortly.
        </div>
      )}
      {ig && !ig.connected && !igError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Connect Instagram to publish.</span>
          <Link
            to="/settings"
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Connect
          </Link>
        </div>
      )}

      <Card className="p-5">
        {/* AI assist — the AI-first centerpiece */}
        <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
            <span aria-hidden>✨</span> AI assist
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Draft a caption in your brand voice, then refine it below.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={aiAssist}
            disabled={aiBusy}
            className="mt-3"
          >
            {aiBusy ? "Generating…" : "Generate caption"}
          </Button>
          {aiNote && <p className="mt-2 text-xs text-slate-500">{aiNote}</p>}
        </div>

        <label
          htmlFor="compose-caption"
          className="mb-1.5 block text-sm font-medium text-slate-700"
        >
          Caption
        </label>
        <Textarea
          id="compose-caption"
          rows={4}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write your caption…"
        />

        <div className="mt-4">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Image
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files?.[0])}
            className="hidden"
          />
          {preview ? (
            <div className="relative inline-block">
              <img
                src={preview}
                alt="Selected post preview"
                className="max-h-64 rounded-lg border border-slate-200"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 block text-xs text-brand-600 hover:underline"
              >
                Replace image
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 py-10 text-sm text-slate-400 outline-none hover:border-brand-400 hover:text-brand-500 focus-visible:ring-2 focus-visible:ring-brand-100"
            >
              <span className="text-2xl" aria-hidden>
                ＋
              </span>
              Click to upload an image
            </button>
          )}
        </div>

        {result && (
          <div
            role="status"
            className={`mt-4 break-all rounded-lg px-3 py-2 text-sm ${
              result.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {result.msg}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button
            disabled={busy || !base64 || !ig?.connected}
            onClick={publish}
          >
            {busy ? "Publishing…" : "Publish to Instagram"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

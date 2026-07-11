import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CalendarClock, Loader2, Plus, Sparkles } from "lucide-react";
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const draftId =
    (location.state as { draftId?: string } | null)?.draftId ??
    searchParams.get("draftId") ??
    null;

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
        <Card className="p-8 text-center text-sm text-muted">
          No active brand. Create one to start composing.
        </Card>
      ) : (
        <Composer ig={ig} igError={igError} brandId={activeBrandId} draftId={draftId} />
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
          ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-hover text-muted"
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
  draftId,
}: {
  ig: IgStatus | null;
  igError: boolean;
  brandId: string;
  draftId: string | null;
}) {
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [contentType, setContentType] = useState("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiNote, setAiNote] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [draftLoadError, setDraftLoadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill the caption from the draft this Compose session is finishing
  // (e.g. from a goal plan's Intent Preview). Scheduling below promotes the
  // SAME draft row rather than creating a new one, so nothing is orphaned.
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    api
      .getDraft(brandId, draftId)
      .then((draft) => {
        if (!cancelled) setCaption(draft.caption ?? "");
      })
      .catch(() => {
        if (!cancelled) setDraftLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, draftId]);

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
      // Publishing immediately supersedes the draft it was finishing — delete
      // the source draft row so it doesn't linger in the queue as an orphan.
      if (draftId) {
        await api.deleteDraft(brandId, draftId).catch(() => {});
      }
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

  const addToQueue = async () => {
    if (!base64 || !scheduledAt) return;
    setScheduleBusy(true);
    setResult(null);
    try {
      if (draftId) {
        // Promote the SAME draft row to scheduled — no new row, no orphan.
        await api.promoteDraft(brandId, draftId, {
          caption: caption || undefined,
          imageBase64: base64,
          contentType,
          scheduledAt: new Date(scheduledAt).toISOString(),
        });
      } else {
        await api.igSchedule(brandId, {
          caption: caption || undefined,
          imageBase64: base64,
          contentType,
          scheduledAt: new Date(scheduledAt).toISOString(),
        });
      }
      setResult({ ok: true, msg: "Added to queue!" });
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {draftId && !draftLoadError && (
        <div className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-sm text-accent-soft-fg">
          Finishing a draft from your goal plan — pick an image and a time to add it to the queue.
        </div>
      )}
      {draftLoadError && (
        <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Couldn't load that draft. You can still write a new post below.
        </div>
      )}
      {igError && (
        <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Couldn't check the Instagram connection. Try again shortly.
        </div>
      )}
      {ig && !ig.connected && !igError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
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
        <div className="mb-5 rounded-xl border border-accent-line bg-accent-soft p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-accent-soft-fg">
            <Sparkles className="h-4 w-4" aria-hidden />
            AI assist
          </div>
          <p className="mt-1 text-xs text-muted">
            Draft a caption in your brand voice, then refine it below.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={aiAssist}
            disabled={aiBusy}
            className="mt-3"
          >
            {aiBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate caption"
            )}
          </Button>
          {aiNote && <p className="mt-2 text-xs text-muted">{aiNote}</p>}
        </div>

        <label
          htmlFor="compose-caption"
          className="mb-1.5 block text-sm font-medium text-ink"
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
          <span className="mb-1.5 block text-sm font-medium text-ink">
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
                className="max-h-64 rounded-lg border border-line"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 block text-xs text-accent hover:underline outline-none focus-visible:ring-2 focus-visible:ring-brand-100 rounded"
              >
                Replace image
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong py-10 text-sm text-faint outline-none hover:border-brand-400 hover:text-accent focus-visible:ring-2 focus-visible:ring-brand-100"
            >
              <Plus className="h-6 w-6 mb-1" aria-hidden />
              Click to upload an image
            </button>
          )}
        </div>

        {result && (
          <div
            role="status"
            className={`mt-4 break-all rounded-lg px-3 py-2 text-sm ${
              result.ok
                ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
            }`}
          >
            {result.msg}
          </div>
        )}

        {/* Schedule affordance — pick a time and queue it instead of publishing now */}
        <div className="mt-5 rounded-xl border border-line bg-surface p-4">
          <label
            htmlFor="compose-schedule-at"
            className="mb-1.5 flex items-center gap-2 text-sm font-medium text-ink"
          >
            <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
            Schedule for later
          </label>
          <input
            id="compose-schedule-at"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            className="block w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            disabled={scheduleBusy || !base64 || !ig?.connected || !scheduledAt}
            onClick={addToQueue}
          >
            {scheduleBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Scheduling…
              </>
            ) : (
              <>
                <CalendarClock className="h-4 w-4" aria-hidden />
                Add to queue
              </>
            )}
          </Button>
          <Button
            disabled={busy || !base64 || !ig?.connected}
            onClick={publish}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Publishing…
              </>
            ) : (
              "Publish to Instagram"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

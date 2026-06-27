import { useEffect, useRef, useState } from "react";
import { api, type IgStatus } from "../api";
import { useAuth } from "../auth";

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

const NAV = [
  { key: "compose", label: "Compose", icon: "✨", enabled: true },
  { key: "calendar", label: "Calendar", icon: "🗓", enabled: false },
  { key: "connectors", label: "Connectors", icon: "🔌", enabled: true },
  { key: "settings", label: "Settings", icon: "⚙️", enabled: false },
];

export function Dashboard() {
  const { me, logout } = useAuth();
  const [tab, setTab] = useState<"compose" | "connectors">("compose");
  const [ig, setIg] = useState<IgStatus | null>(null);

  const loadIg = async () => {
    try {
      setIg(await api.igStatus());
    } catch {
      setIg({ connected: false });
    }
  };
  useEffect(() => {
    loadIg();
  }, []);

  const brand =
    (me?.profile.brandName as string) ||
    (me?.profile.displayName as string) ||
    me?.user.email;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <span className="font-semibold">Harness</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              disabled={!n.enabled}
              onClick={() => n.enabled && setTab(n.key as "compose" | "connectors")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                tab === n.key
                  ? "bg-brand-50 font-medium text-brand-700"
                  : n.enabled
                    ? "text-slate-600 hover:bg-slate-50"
                    : "cursor-not-allowed text-slate-300"
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
              {!n.enabled && (
                <span className="ml-auto text-[10px] uppercase text-slate-300">
                  soon
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="truncate px-2 text-xs text-slate-400">
            {me?.user.email}
          </div>
          <button
            onClick={logout}
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
          <div>
            <h1 className="text-lg font-semibold">
              {tab === "compose" ? "Compose" : "Connectors"}
            </h1>
            <p className="text-xs text-slate-400">Welcome back, {brand}</p>
          </div>
          <ConnectionPill ig={ig} />
        </header>

        <div className="mx-auto max-w-3xl px-8 py-8">
          {tab === "compose" ? (
            <Composer ig={ig} onNeedConnect={() => setTab("connectors")} />
          ) : (
            <Connectors ig={ig} reload={loadIg} />
          )}
        </div>
      </main>
    </div>
  );
}

function ConnectionPill({ ig }: { ig: IgStatus | null }) {
  if (!ig) return null;
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        ig.connected
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {ig.connected ? `📸 @${ig.username ?? "connected"}` : "Instagram not connected"}
    </span>
  );
}

function Composer({
  ig,
  onNeedConnect,
}: {
  ig: IgStatus | null;
  onNeedConnect: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [contentType, setContentType] = useState("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiNote, setAiNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setContentType(file.type || "image/jpeg");
    setPreview(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
  };

  const aiAssist = async () => {
    setAiNote("");
    try {
      const r = await api.aiCaption();
      setCaption(r.caption);
    } catch (e) {
      setAiNote((e as Error).message);
    }
  };

  const publish = async () => {
    if (!ig?.connected) return onNeedConnect();
    if (!base64) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.igPublish({ caption, imageBase64: base64, contentType });
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
      {!ig?.connected && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Connect Instagram to publish.</span>
          <button
            onClick={onNeedConnect}
            className="font-medium underline underline-offset-2"
          >
            Connect
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* AI prompt bar — the AI-first centerpiece */}
        <div className="mb-5 rounded-xl bg-gradient-to-r from-brand-50 to-indigo-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
            ✨ AI assist
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Draft a caption in your brand voice, then refine it below.
          </p>
          <button
            onClick={aiAssist}
            className="mt-3 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-brand-700 shadow-sm ring-1 ring-brand-100 hover:bg-brand-50"
          >
            Generate caption
          </button>
          {aiNote && <p className="mt-2 text-xs text-slate-500">{aiNote}</p>}
        </div>

        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Caption
        </label>
        <textarea
          rows={4}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write your caption…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Image
          </label>
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
                alt="preview"
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
              className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 py-10 text-sm text-slate-400 hover:border-brand-400 hover:text-brand-500"
            >
              <span className="text-2xl">＋</span>
              Click to upload an image
            </button>
          )}
        </div>

        {result && (
          <div
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
          <button
            disabled={busy || !base64}
            onClick={publish}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Publishing…" : "Publish to Instagram"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Connectors({
  ig,
  reload,
}: {
  ig: IgStatus | null;
  reload: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setConnecting(true);
    setError("");
    try {
      const { url } = await api.igConnectUrl();
      const win = window.open(url, "_blank");
      // Re-check status when the user returns from the OAuth tab.
      const onFocus = () => {
        reload();
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
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-amber-400 text-lg">
              📸
            </div>
            <div>
              <div className="font-medium">Instagram</div>
              <div className="text-xs text-slate-400">
                {ig?.connected
                  ? `Connected as @${ig.username ?? "—"}`
                  : "Business / Creator account"}
              </div>
            </div>
          </div>
          {ig?.connected ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Connected
            </span>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {connecting ? "Opening…" : "Connect"}
            </button>
          )}
        </div>
        {ig?.connected && ig.tokenExpiresAt && (
          <p className="mt-3 text-xs text-slate-400">
            Token valid until {new Date(ig.tokenExpiresAt).toLocaleDateString()}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-5 text-sm text-slate-400">
        More connectors (LLM, image/video generation, TikTok, LinkedIn) are
        coming as the harness grows.
      </div>
    </div>
  );
}

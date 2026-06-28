import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
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
} from "../components/ui";

export function Settings() {
  const { refresh } = useAuth();
  const { activeWorkspaceId, activeBrand, activeBrandId } = useBrand();

  return (
    <AppShell title="Settings" subtitle="Workspace & connectors">
      <div className="space-y-8">
        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">
            AI providers
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Bring your own keys. Stored encrypted — we never show them back.
          </p>
          <AiProviders workspaceId={activeWorkspaceId} reload={refresh} />
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">
            Instagram
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Connected per brand
            {activeBrand ? ` — currently ${activeBrand.name}.` : "."}
          </p>
          <InstagramConnector brandId={activeBrandId} />
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">
            Export my data
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Download everything we hold for your account as a JSON file.
          </p>
          <ExportData />
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-red-600">
            Danger zone
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Irreversible actions. Proceed with care.
          </p>
          <DeleteAccount />
        </section>
      </div>
    </AppShell>
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
      setError("Couldn’t generate your export — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-slate-900">Account data export</div>
        <div className="text-xs text-slate-400">
          Brands, settings, and posts. No keys or secrets are included.
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
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
      setError((e as Error).message || "Couldn’t delete your account.");
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-red-200 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-slate-900">Delete account</div>
        <div className="text-xs text-slate-400">
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
  icon: string;
}[] = [
  {
    provider: "anthropic",
    label: "Claude (Anthropic)",
    hint: "Powers AI caption assist. Paste your Anthropic API key (sk-ant-…).",
    icon: "🤖",
  },
  {
    provider: "higgsfield",
    label: "Higgsfield",
    hint: "Image/video generation credential (runs via the Higgsfield MCP).",
    icon: "🎬",
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
      <Card className="p-6 text-sm text-slate-400">No active workspace.</Card>
    );
  }
  if (loading) {
    return <Card className="p-6 text-sm text-slate-400">Loading…</Card>;
  }
  if (error) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-slate-500">Couldn’t load providers.</p>
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
          icon={p.icon}
          connected={statuses[p.provider] === "connected"}
          onChange={async () => {
            await load();
            await reload();
          }}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  workspaceId,
  provider,
  label,
  hint,
  icon,
  connected,
  onChange,
}: {
  workspaceId: string;
  provider: WorkspaceProvider;
  label: string;
  hint: string;
  icon: string;
  connected: boolean;
  onChange: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.setWorkspaceConnector(workspaceId, provider, key.trim());
      setKey("");
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
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{label}</div>
            <div className="text-xs text-slate-400">{hint}</div>
          </div>
        </div>
        <StatusPill connected={connected} />
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          autoComplete="off"
          aria-label={`${label} API key`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={connected ? "Paste a new key to replace" : "Paste API key"}
        />
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy || !key.trim()} className="shrink-0">
            {busy ? "Saving…" : "Save"}
          </Button>
          {connected && (
            <Button
              variant="danger"
              onClick={remove}
              disabled={busy}
              className="shrink-0"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
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
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-amber-400 text-lg">
            📸
          </span>
          <div className="min-w-0">
            <div className="font-medium text-slate-900">Instagram</div>
            <div className="truncate text-xs text-slate-400">
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
        <p className="mt-3 text-xs text-slate-400">
          Token valid until{" "}
          {new Date(ig.tokenExpiresAt).toLocaleDateString()}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

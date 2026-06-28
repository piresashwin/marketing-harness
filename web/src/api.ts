// All ids are coerced to strings on the way in. Postgres bigserial columns come
// back as JSON strings, plain serials as numbers — we normalise to `string`
// everywhere so callers never have to care which it was.

export interface Brand {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
}

export type WorkspaceProvider = "anthropic" | "higgsfield";

export interface WorkspaceConnector {
  provider: WorkspaceProvider;
  status: string;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface Me {
  user: { id: string; email: string; onboardingCompleted: boolean };
  activeWorkspaceId: string | null;
  activeBrandId: string | null;
  brands: Brand[];
  workspaceConnectors: WorkspaceConnector[];
  profile: Record<string, unknown>;
}

export interface IgStatus {
  connected: boolean;
  username?: string;
  externalId?: string;
  tokenExpiresAt?: string | null;
}

export interface BrandVoice {
  tone?: string[];
  guidelines?: string;
  goals?: string;
  [k: string]: unknown;
}

export interface BrandBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  font?: string;
  visualStyle?: string;
  [k: string]: unknown;
}

export interface BrandSettings {
  description?: string | null;
  audience?: string | null;
  voice?: BrandVoice;
  branding?: BrandBranding;
}

export interface Pillar {
  id: string;
  name: string;
  description: string | null;
  ratio: number | null;
  sortOrder: number | null;
}

export interface BrandDetail {
  brand: Brand;
  settings: BrandSettings;
  pillars: Pillar[];
}

export type PlatformKey = "instagram" | "linkedin" | "facebook";

export interface PlatformSetting {
  platform: string;
  settings: Record<string, unknown>;
}

/** Coerce a possibly-number/null id to a stable string id (or null). */
function idStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function normBrand(b: {
  id: unknown;
  workspace_id: unknown;
  name: string;
  slug: string;
}): Brand {
  return {
    id: String(b.id),
    workspace_id: String(b.workspace_id),
    name: b.name,
    slug: b.slug,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // The API returns either { error: string } or { error: ZodIssue[] }.
    const raw = (body as { error?: unknown }).error;
    const message =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? "Please check the highlighted fields."
          : `HTTP ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, body });
  }
  return body as T;
}

export const api = {
  me: async (): Promise<Me> => {
    const raw = await request<{
      user: { id: unknown; email: string; onboardingCompleted: boolean };
      activeWorkspaceId: unknown;
      activeBrandId: unknown;
      brands: { id: unknown; workspace_id: unknown; name: string; slug: string }[];
      workspaceConnectors: WorkspaceConnector[];
      profile: Record<string, unknown>;
    }>("/api/me");
    return {
      user: {
        id: String(raw.user.id),
        email: raw.user.email,
        onboardingCompleted: raw.user.onboardingCompleted,
      },
      activeWorkspaceId: idStr(raw.activeWorkspaceId),
      activeBrandId: idStr(raw.activeBrandId),
      brands: raw.brands.map(normBrand),
      workspaceConnectors: raw.workspaceConnectors ?? [],
      profile: raw.profile ?? {},
    };
  },

  requestMagicLink: (email: string) =>
    request<{ ok: boolean; delivered: boolean; devLink?: string }>(
      "/auth/request",
      { method: "POST", body: JSON.stringify({ email }) },
    ),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  saveOnboarding: (data: object) =>
    request<{ ok: boolean; brandId: number }>("/api/onboarding", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Brands ──────────────────────────────────────────────────────────
  listBrands: async (): Promise<Brand[]> => {
    const raw = await request<{
      brands: { id: unknown; workspace_id: unknown; name: string; slug: string }[];
    }>("/api/brands");
    return raw.brands.map(normBrand);
  },
  createBrand: (input: {
    name: string;
    slug: string;
    description?: string;
    audience?: string;
    voice?: BrandVoice;
    branding?: BrandBranding;
  }) =>
    request<{ id: number | string }>("/api/brands", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => ({ id: String(r.id) })),
  getBrand: async (brandId: string): Promise<BrandDetail> => {
    const raw = await request<{
      brand: { id: unknown; workspace_id: unknown; name: string; slug: string };
      settings: BrandSettings;
      pillars: {
        id: unknown;
        name: string;
        description: string | null;
        ratio: number | null;
        sortOrder: number | null;
      }[];
    }>(`/api/brands/${brandId}`);
    return {
      brand: normBrand(raw.brand),
      settings: raw.settings ?? {},
      pillars: (raw.pillars ?? []).map((p) => ({
        id: String(p.id),
        name: p.name,
        description: p.description,
        ratio: p.ratio,
        sortOrder: p.sortOrder,
      })),
    };
  },
  patchBrand: (
    brandId: string,
    input: {
      description?: string;
      audience?: string;
      voice?: BrandVoice;
      branding?: BrandBranding;
    },
  ) =>
    request<{ ok: boolean }>(`/api/brands/${brandId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  putPillars: async (
    brandId: string,
    pillars: { name: string; description?: string; ratio?: number }[],
  ): Promise<Pillar[]> => {
    const raw = await request<{
      pillars: {
        id: unknown;
        name: string;
        description: string | null;
        ratio: number | null;
        sortOrder: number | null;
      }[];
    }>(`/api/brands/${brandId}/pillars`, {
      method: "PUT",
      body: JSON.stringify({ pillars }),
    });
    return raw.pillars.map((p) => ({
      id: String(p.id),
      name: p.name,
      description: p.description,
      ratio: p.ratio,
      sortOrder: p.sortOrder,
    }));
  },
  getPlatformSettings: (brandId: string) =>
    request<{ platforms: PlatformSetting[] }>(
      `/api/brands/${brandId}/platform-settings`,
    ),
  putPlatformSettings: (
    brandId: string,
    platform: PlatformKey,
    settings: Record<string, unknown>,
  ) =>
    request<PlatformSetting>(
      `/api/brands/${brandId}/platform-settings/${platform}`,
      { method: "PUT", body: JSON.stringify({ settings }) },
    ),
  setActiveBrand: (brandId: string) =>
    request<{ ok: boolean }>("/api/active-brand", {
      method: "POST",
      body: JSON.stringify({ brandId: Number(brandId) }),
    }),
  deleteBrand: (brandId: string, confirm: boolean) =>
    request<{ ok: boolean }>(`/api/brands/${brandId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
    }),

  // ── Instagram (brand-scoped) ────────────────────────────────────────
  igStatus: (brandId: string) =>
    request<IgStatus>(`/api/brands/${brandId}/connectors/instagram/status`),
  igConnectUrl: (brandId: string) =>
    request<{ url: string }>(
      `/api/brands/${brandId}/connectors/instagram/connect-url`,
    ),
  igPublish: (
    brandId: string,
    payload: { caption?: string; imageBase64: string; contentType: string },
  ) =>
    request<{ providerMediaId: string; permalink?: string }>(
      `/api/brands/${brandId}/connectors/instagram/publish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  // ── AI ──────────────────────────────────────────────────────────────
  aiCaption: (brandId: string, prompt?: string, platform?: string) =>
    request<{ caption: string }>(`/api/brands/${brandId}/ai/caption`, {
      method: "POST",
      body: JSON.stringify({ prompt, platform }),
    }),

  // ── Workspace connectors (AI providers) ─────────────────────────────
  listWorkspaceConnectors: (workspaceId: string) =>
    request<{ connectors: WorkspaceConnector[] }>(
      `/api/workspaces/${workspaceId}/connectors`,
    ),
  setWorkspaceConnector: (
    workspaceId: string,
    provider: WorkspaceProvider,
    apiKey: string,
  ) =>
    request<{ connector: WorkspaceConnector | null }>(
      `/api/workspaces/${workspaceId}/connectors/${provider}`,
      { method: "PUT", body: JSON.stringify({ apiKey }) },
    ),
  deleteWorkspaceConnector: (
    workspaceId: string,
    provider: WorkspaceProvider,
  ) =>
    request<{ ok: boolean }>(
      `/api/workspaces/${workspaceId}/connectors/${provider}`,
      { method: "DELETE" },
    ),

  // ── Account / compliance ────────────────────────────────────────────
  /**
   * Fetch the user's data export and trigger a browser download. Bypasses the
   * JSON `request` helper because the response is an attachment, not JSON.
   */
  exportAccount: async (): Promise<void> => {
    const res = await fetch("/api/account/export", {
      credentials: "include",
    });
    if (!res.ok) {
      throw Object.assign(new Error(`HTTP ${res.status}`), {
        status: res.status,
      });
    }
    const blob = await res.blob();
    const fromHeader = res.headers
      .get("Content-Disposition")
      ?.match(/filename="?([^"]+)"?/i)?.[1];
    const filename = fromHeader ?? "account-export.json";
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  deleteAccount: (confirmEmail: string) =>
    request<{ ok: boolean }>("/api/account/delete", {
      method: "POST",
      body: JSON.stringify({ confirmEmail }),
    }),
};

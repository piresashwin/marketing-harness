export interface Me {
  user: { id: number; email: string; onboardingCompleted: boolean };
  profile: Record<string, unknown>;
}

export interface IgStatus {
  connected: boolean;
  username?: string;
  igUserId?: string;
  tokenExpiresAt?: string | null;
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
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), {
      status: res.status,
      body,
    });
  }
  return body as T;
}

export const api = {
  me: () => request<Me>("/api/me"),
  requestMagicLink: (email: string) =>
    request<{ ok: boolean; delivered: boolean; devLink?: string }>(
      "/auth/request",
      { method: "POST", body: JSON.stringify({ email }) },
    ),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  saveOnboarding: (data: object) =>
    request<{ ok: boolean }>("/api/onboarding", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  igStatus: () => request<IgStatus>("/api/connectors/instagram/status"),
  igConnectUrl: () =>
    request<{ url: string }>("/api/connectors/instagram/connect-url"),
  igPublish: (payload: {
    caption?: string;
    imageBase64: string;
    contentType: string;
  }) =>
    request<{ providerMediaId: string; permalink?: string }>(
      "/api/connectors/instagram/publish",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  aiCaption: () =>
    request<{ caption: string }>("/api/ai/caption", { method: "POST", body: "{}" }),
};

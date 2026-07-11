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
  user: { id: string; email: string };
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
  /** "3 words you are" */
  are?: string[];
  /** "3 words you're never" */
  never?: string[];
  [k: string]: unknown;
}

export interface BrandColor {
  hex: string;
  name?: string;
}

export interface BrandBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  font?: string;
  visualStyle?: string;
  /** Short prose: palette, mood, typography feel. */
  visual?: string;
  /** The brand palette — add/remove swatches with optional names. */
  colors?: BrandColor[];
  [k: string]: unknown;
}

export interface BrandSettings {
  /** Core belief — why this brand exists beyond making money. */
  why?: string | null;
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

/** Prose fields the Profile AI assist can draft / refine. */
export type ProfileField =
  | "belief"
  | "voice"
  | "visual"
  | "product"
  | "audience";

/** A full AI-drafted profile, mapped onto the editable Profile fields. */
export interface DraftProfile {
  belief: string;
  tone: string[];
  voiceGuidelines: string;
  product: string;
  audience: string;
  visual: string;
  pillars: { name: string; description: string; ratio?: number }[];
}

// ── Instagram scheduled posts ────────────────────────────────────────
export interface ScheduledPost {
  id: string;
  caption: string | null;
  mediaUrls: string[];
  mediaType: string;
  scheduledAt: string | null;
  status: string;
}

// ── Client review portal (public, token-gated) ───────────────────────

/** Minimal comment shape returned by the public portal. */
export interface ClientComment {
  id: string;
  authorLabel: string;
  body: string;
  createdAt: string;
}

/** The client-safe post view returned by GET /portal/review/:token. */
export interface ClientReviewView {
  caption: string | null;
  mediaUrls: string[];
  mediaType: string;
  scheduledAt: string | null;
  status: string;
  comments: ClientComment[];
}

// ── Post review workflow ──────────────────────────────────────────────
export interface ReviewPost {
  id: string;
  caption: string | null;
  mediaUrls: string[];
  mediaType: string;
  scheduledAt: string | null;
  status: string;
  createdAt: string;
}

export interface PostComment {
  id: string;
  postId: string;
  authorUserId: string | null;
  authorLabel: string;
  visibility: string;
  body: string;
  createdAt: string;
}

// ── Instagram analytics ───────────────────────────────────────────────
export interface AnalyticsPost {
  id: string;
  caption?: string;
  mediaType: string;
  timestamp?: string;
  permalink?: string;
  likeCount: number;
  commentsCount: number;
  reach?: number;
  saved?: number;
  shares?: number;
  totalInteractions?: number;
  views?: number;
}

export interface AnalyticsSnapshot {
  account: {
    username: string | null;
    followersCount: number;
    followsCount: number;
    mediaCount: number;
  };
  insights: {
    reach?: number;
    views?: number;
    profileViews?: number;
    accountsEngaged?: number;
    totalInteractions?: number;
  };
  demographics: {
    age?: Record<string, number>;
    gender?: Record<string, number>;
    country?: Record<string, number>;
  };
  posts: AnalyticsPost[];
  rangeDays: number;
}

export interface AnalyticsDeltas {
  followersCount?: number;
  reach?: number;
  views?: number;
  totalInteractions?: number;
}

export interface AnalyticsResult {
  snapshot: AnalyticsSnapshot;
  fetchedAt: string;
  deltas: AnalyticsDeltas | null;
}

// Compact KPI point from a stored snapshot, oldest → newest. Drives sparklines.
export interface AnalyticsHistoryPoint {
  fetchedAt: string;
  followersCount: number;
  reach?: number;
  views?: number;
  totalInteractions?: number;
}

export interface AnalyticsInsights {
  insights: { title: string; detail: string }[];
  actionPlan: { action: string; why: string; priority: string }[];
  suggestions: string[];
  contentIdeas: { idea: string; format: string; pillar: string }[];
}

// ── Content plan ─────────────────────────────────────────────────────
export interface ContentPlanItem {
  pillar: string;
  format: "Reel" | "Carousel" | "Single" | "Story";
  dayOffset: number;
  time: string | null;
  hook: string;
}

export interface ContentPlan {
  items: ContentPlanItem[];
}

// ── Brand Brain ───────────────────────────────────────────────────────
export type BrainItemStatus = "active" | "applied" | "dismissed";

export interface BrainPattern {
  id: string;
  title: string;
  evidence: string;
  impact: "High" | "Medium" | "Low";
  status: BrainItemStatus;
}

export interface BrainSuggestion {
  id: string;
  title: string;
  description: string;
  status: BrainItemStatus;
}

export interface BrainExample {
  id: string;
  caption: string;
  metric: string;
  annotation: string;
  status: BrainItemStatus;
}

export interface BrainCandidate {
  caption: string;
  metric: string;
}

export interface Brain {
  patterns: BrainPattern[];
  suggestions: BrainSuggestion[];
  examples: BrainExample[];
  strength: number;
  lastLearnedAt: string | null;
  hasAnalytics: boolean;
  candidates: BrainCandidate[];
}

// ── Goal-driven mode ──────────────────────────────────────────────────
export interface GoalPlanStep {
  title: string;
  why: string;
  pillar: string;
  format: "Reel" | "Carousel" | "Single" | "Story";
  dayOffset: number;
  time: string | null;
  hook: string;
}

export interface GoalPlan {
  summary: string;
  steps: GoalPlanStep[];
}

export interface GoalRun {
  id: string;
  goal: string;
  status: string;
  plan: GoalPlan;
  createdAt: string;
}

export interface GoalRunSummary {
  id: string;
  goal: string;
  status: string;
  stepCount: number;
  createdAt: string;
}

export interface DraftPost {
  id: string;
  caption: string | null;
  scheduledAt: string | null;
  goalRunId: string | null;
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
      user: { id: unknown; email: string };
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
      why?: string;
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

  // ── Instagram scheduling (brand-scoped) ─────────────────────────────
  igSchedule: (
    brandId: string,
    payload: { caption?: string; imageBase64: string; contentType: string; scheduledAt: string },
  ) =>
    request<{ id: number | string }>(
      `/api/brands/${brandId}/connectors/instagram/schedule`,
      { method: "POST", body: JSON.stringify(payload) },
    ).then((r) => ({ id: String(r.id) })),

  listQueue: async (brandId: string): Promise<ScheduledPost[]> => {
    const raw = await request<{
      posts: { id: unknown; caption: string | null; mediaUrls: string[]; mediaType: string; scheduledAt: string | null; status: string }[];
    }>(`/api/brands/${brandId}/posts?status=scheduled`);
    return raw.posts.map((p) => ({ ...p, id: String(p.id) }));
  },

  cancelScheduled: (brandId: string, postId: string) =>
    request<{ ok: boolean }>(`/api/brands/${brandId}/posts/${postId}`, {
      method: "DELETE",
    }),

  // ── Post review workflow (brand-scoped) ─────────────────────────────
  listReviewQueue: async (brandId: string): Promise<ReviewPost[]> => {
    const raw = await request<{
      posts: {
        id: unknown;
        caption: string | null;
        mediaUrls: string[];
        mediaType: string;
        scheduledAt: string | null;
        status: string;
        createdAt: string;
      }[];
    }>(`/api/brands/${brandId}/posts/review-queue`);
    return raw.posts.map((p) => ({ ...p, id: String(p.id) }));
  },

  submitForReview: async (brandId: string, postId: string): Promise<ReviewPost> => {
    const raw = await request<{ post: { id: unknown; caption: string | null; mediaUrls: string[]; mediaType: string; scheduledAt: string | null; status: string; createdAt: string } }>(
      `/api/brands/${brandId}/posts/${postId}/submit`,
      { method: "POST" },
    );
    return { ...raw.post, id: String(raw.post.id) };
  },

  approvePost: async (brandId: string, postId: string): Promise<ReviewPost> => {
    const raw = await request<{ post: { id: unknown; caption: string | null; mediaUrls: string[]; mediaType: string; scheduledAt: string | null; status: string; createdAt: string } }>(
      `/api/brands/${brandId}/posts/${postId}/approve`,
      { method: "POST" },
    );
    return { ...raw.post, id: String(raw.post.id) };
  },

  requestChanges: async (
    brandId: string,
    postId: string,
    body: string,
  ): Promise<{ post: ReviewPost; comment: PostComment }> => {
    const raw = await request<{
      post: { id: unknown; caption: string | null; mediaUrls: string[]; mediaType: string; scheduledAt: string | null; status: string; createdAt: string };
      comment: { id: unknown; postId: unknown; authorUserId: unknown | null; authorLabel: string; visibility: string; body: string; createdAt: string };
    }>(`/api/brands/${brandId}/posts/${postId}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return {
      post: { ...raw.post, id: String(raw.post.id) },
      comment: { ...raw.comment, id: String(raw.comment.id), postId: String(raw.comment.postId), authorUserId: raw.comment.authorUserId != null ? String(raw.comment.authorUserId) : null },
    };
  },

  listComments: async (brandId: string, postId: string): Promise<PostComment[]> => {
    const raw = await request<{
      comments: { id: unknown; postId: unknown; authorUserId: unknown | null; authorLabel: string; visibility: string; body: string; createdAt: string }[];
    }>(`/api/brands/${brandId}/posts/${postId}/comments`);
    return raw.comments.map((c) => ({
      ...c,
      id: String(c.id),
      postId: String(c.postId),
      authorUserId: c.authorUserId != null ? String(c.authorUserId) : null,
    }));
  },

  addComment: async (brandId: string, postId: string, body: string): Promise<PostComment> => {
    const raw = await request<{
      comment: { id: unknown; postId: unknown; authorUserId: unknown | null; authorLabel: string; visibility: string; body: string; createdAt: string };
    }>(`/api/brands/${brandId}/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    const c = raw.comment;
    return {
      ...c,
      id: String(c.id),
      postId: String(c.postId),
      authorUserId: c.authorUserId != null ? String(c.authorUserId) : null,
    };
  },

  // ── Client review portal — internal link creation (authed) ─────────
  /** Create a public review link for a post. Returns the URL containing the raw token. */
  createReviewLink: (brandId: string, postId: string) =>
    request<{ url: string }>(
      `/api/brands/${brandId}/posts/${postId}/review-link`,
      { method: "POST" },
    ),

  // ── Client review portal — public actions (no auth, /portal/... paths) ──
  /** Fetch the client-safe view of a post via its review token. */
  getClientReview: (token: string) =>
    request<ClientReviewView>(`/portal/review/${token}`),

  /** Approve a post via its review token. */
  clientApprove: (token: string) =>
    request<{ status: string }>(`/portal/review/${token}/approve`, {
      method: "POST",
    }),

  /** Request changes via its review token, with a client comment body. */
  clientRequestChanges: (token: string, body: string) =>
    request<{ status: string }>(`/portal/review/${token}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  /** Add a standalone client comment via its review token. */
  clientComment: (token: string, body: string) =>
    request<{ comment: ClientComment }>(`/portal/review/${token}/comment`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  // ── Instagram analytics (brand-scoped) ──────────────────────────────
  /** Latest stored snapshot, or a fresh pull when refresh=true / none exists. */
  igAnalytics: (
    brandId: string,
    opts?: { range?: 7 | 30 | 90; refresh?: boolean },
  ) => {
    const q = new URLSearchParams();
    if (opts?.range) q.set("range", String(opts.range));
    if (opts?.refresh) q.set("refresh", "true");
    const qs = q.toString();
    return request<AnalyticsResult>(
      `/api/brands/${brandId}/analytics/instagram${qs ? `?${qs}` : ""}`,
    );
  },
  /** Compact KPI series from stored snapshots (oldest → newest) for sparklines. */
  igAnalyticsHistory: (brandId: string) =>
    request<AnalyticsHistoryPoint[]>(
      `/api/brands/${brandId}/analytics/instagram/history`,
    ),
  /** Generate AI insights over the latest snapshot (spends Claude credits). */
  igAnalyticsInsights: (brandId: string) =>
    request<AnalyticsInsights>(
      `/api/brands/${brandId}/analytics/instagram/insights`,
      { method: "POST" },
    ),

  // ── AI ──────────────────────────────────────────────────────────────
  aiCaption: (brandId: string, prompt?: string, platform?: string) =>
    request<{ caption: string }>(`/api/brands/${brandId}/ai/caption`, {
      method: "POST",
      body: JSON.stringify({ prompt, platform }),
    }),
  /** Draft a whole profile from a one-line seed (review, not persisted). */
  aiDraftProfile: (brandId: string, seed: string) =>
    request<DraftProfile>(`/api/brands/${brandId}/ai/profile/draft`, {
      method: "POST",
      body: JSON.stringify({ seed }),
    }),
  /** Refine one profile field, anchored to the rest of the profile. */
  aiRefineField: (
    brandId: string,
    field: ProfileField,
    current?: string,
    steer?: string,
  ) =>
    request<{ text: string }>(`/api/brands/${brandId}/ai/profile/refine`, {
      method: "POST",
      body: JSON.stringify({ field, current, steer }),
    }),
  /** Draft a whole profile by extracting signal from a website (not persisted). */
  aiExtractProfile: (brandId: string, url: string) =>
    request<DraftProfile>(`/api/brands/${brandId}/ai/profile/extract`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  /** Draft a whole profile from the connected Instagram account (not persisted). */
  aiProfileFromInstagram: (brandId: string) =>
    request<DraftProfile>(`/api/brands/${brandId}/ai/profile/from-instagram`, {
      method: "POST",
    }),
  /** Draft a ~2-week content plan from brand profile + a short user note. */
  aiContentPlan: (brandId: string, body: { note?: string }) =>
    request<ContentPlan>(`/api/brands/${brandId}/ai/content-plan`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Goal-driven mode (brand-scoped) ──────────────────────────────────
  /** State an outcome; the AI proposes an approvable Intent Preview. */
  proposeGoal: async (brandId: string, goal: string): Promise<GoalRun> => {
    const raw = await request<{ id: unknown; goal: string; status: string; plan: GoalPlan; createdAt: string }>(
      `/api/brands/${brandId}/goals`,
      { method: "POST", body: JSON.stringify({ goal }) },
    );
    return { ...raw, id: String(raw.id) };
  },
  /** Recent goal runs (action log) + current drafts. */
  listGoals: async (
    brandId: string,
  ): Promise<{ runs: GoalRunSummary[]; drafts: DraftPost[] }> => {
    const raw = await request<{
      runs: { id: unknown; goal: string; status: string; stepCount: number; createdAt: string }[];
      drafts: { id: unknown; caption: string | null; scheduledAt: string | null; goalRunId: unknown | null }[];
    }>(`/api/brands/${brandId}/goals`);
    return {
      runs: raw.runs.map((r) => ({ ...r, id: String(r.id) })),
      drafts: raw.drafts.map((d) => ({
        ...d,
        id: String(d.id),
        goalRunId: d.goalRunId != null ? String(d.goalRunId) : null,
      })),
    };
  },
  /** Approve a proposed run — materializes its steps as draft posts. */
  approveGoal: (
    brandId: string,
    runId: string,
  ) =>
    request<{ run: GoalRun; createdDraftIds: string[] }>(
      `/api/brands/${brandId}/goals/${runId}/approve`,
      { method: "POST" },
    ),
  /** Discard a proposed/approved run and delete its still-draft posts. */
  discardGoal: (brandId: string, runId: string) =>
    request<{ run: GoalRun }>(`/api/brands/${brandId}/goals/${runId}/discard`, {
      method: "POST",
    }),
  /** Load a single draft's caption etc. for Compose prefill. */
  getDraft: async (brandId: string, postId: string): Promise<DraftPost> => {
    const raw = await request<{ id: unknown; caption: string | null; scheduledAt: string | null; goalRunId: unknown | null }>(
      `/api/brands/${brandId}/goals/drafts/${postId}`,
    );
    return { ...raw, id: String(raw.id), goalRunId: raw.goalRunId != null ? String(raw.goalRunId) : null };
  },
  /** Delete a draft outright. */
  deleteDraft: (brandId: string, postId: string) =>
    request<{ ok: boolean }>(`/api/brands/${brandId}/goals/drafts/${postId}`, {
      method: "DELETE",
    }),
  /** Complete a draft with media + a schedule time (same row → scheduled). */
  promoteDraft: (
    brandId: string,
    postId: string,
    payload: { caption?: string; imageBase64: string; contentType: string; scheduledAt: string },
  ) =>
    request<{ ok: boolean }>(`/api/brands/${brandId}/goals/drafts/${postId}/promote`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  // ── Brand Brain (brand-scoped) ───────────────────────────────────────
  getBrain: (brandId: string) => request<Brain>(`/api/brands/${brandId}/brain`),
  /** Derive fresh items from the latest analytics and upsert them. */
  relearnBrain: (brandId: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/relearn`, { method: "POST" }),
  brainItemApply: (brandId: string, itemId: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/items/${itemId}/apply`, {
      method: "POST",
    }),
  brainItemDismiss: (brandId: string, itemId: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/items/${itemId}/dismiss`, {
      method: "POST",
    }),
  brainItemUndo: (brandId: string, itemId: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/items/${itemId}/undo`, {
      method: "POST",
    }),
  updateBrainExample: (brandId: string, itemId: string, annotation: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ annotation }),
    }),
  addBrainExample: (
    brandId: string,
    input: { caption: string; metric?: string; annotation?: string },
  ) =>
    request<Brain>(`/api/brands/${brandId}/brain/examples`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteBrainItem: (brandId: string, itemId: string) =>
    request<Brain>(`/api/brands/${brandId}/brain/items/${itemId}`, {
      method: "DELETE",
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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { api, type Brand } from "./api";
import { useAuth } from "./auth";

interface BrandState {
  brands: Brand[];
  activeBrandId: string | null;
  activeBrand: Brand | null;
  activeWorkspaceId: string | null;
  switchBrand: (id: string) => Promise<void>;
  /** Re-fetch /api/me (brands list + active ids + connectors). */
  refresh: () => Promise<void>;
}

const BrandContext = createContext<BrandState | null>(null);

/**
 * Brand context, backed by /api/me (via AuthProvider). `switchBrand` persists
 * the choice server-side then refreshes so brand-scoped screens re-fetch off the
 * new active id.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const { me, refresh } = useAuth();

  const brands = me?.brands ?? [];
  const activeBrandId = me?.activeBrandId ?? brands[0]?.id ?? null;
  const activeWorkspaceId = me?.activeWorkspaceId ?? null;
  const activeBrand =
    brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null;

  const switchBrand = useCallback(
    async (id: string) => {
      if (id === activeBrandId) return;
      await api.setActiveBrand(id);
      await refresh();
    },
    [activeBrandId, refresh],
  );

  const value = useMemo<BrandState>(
    () => ({
      brands,
      activeBrandId,
      activeBrand,
      activeWorkspaceId,
      switchBrand,
      refresh,
    }),
    [brands, activeBrandId, activeBrand, activeWorkspaceId, switchBrand, refresh],
  );

  return (
    <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
  );
}

export function useBrand(): BrandState {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within BrandProvider");
  return ctx;
}

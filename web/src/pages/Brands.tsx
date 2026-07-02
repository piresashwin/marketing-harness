import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { CreateBrandDialog } from "../components/CreateBrandDialog";
import { staggerStyle } from "../components/motion";
import { Button, Card } from "../components/ui";

export function Brands() {
  const { brands, activeBrandId, switchBrand } = useBrand();

  return (
    <AppShell
      title="Brands"
      subtitle="Switch context or spin up a new brand"
      actions={
        <CreateBrandDialog
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" aria-hidden /> New brand
            </Button>
          }
        />
      }
    >
      {brands.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-3xl" aria-hidden>
            🏷️
          </div>
          <h2 className="mt-2 font-medium text-ink">No brands yet</h2>
          <p className="mt-1 text-sm text-muted">
            Create your first brand to get started.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateBrandDialog
              trigger={
                <Button>
                  <Plus className="h-4 w-4" aria-hidden /> New brand
                </Button>
              }
            />
          </div>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {brands.map((b, i) => {
            const isActive = b.id === activeBrandId;
            return (
              <li key={b.id} className="animate-fade-up" style={staggerStyle(i)}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">
                        {b.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">
                          {b.name}
                        </div>
                        <div className="truncate text-xs text-faint">
                          /{b.slug}
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-5 flex items-center gap-2">
                    {isActive ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        aria-disabled
                      >
                        Current brand
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void switchBrand(b.id)}
                      >
                        Switch to this brand
                      </Button>
                    )}
                    <Link
                      to={`/brands/${b.id}/settings`}
                      className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
                    >
                      Settings
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

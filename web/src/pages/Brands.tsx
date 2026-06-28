import { Link } from "react-router-dom";
import { useBrand } from "../brand";
import { AppShell } from "../components/AppShell";
import { CreateBrandDialog } from "../components/CreateBrandDialog";
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
              <span aria-hidden>＋</span> New brand
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
          <h2 className="mt-2 font-medium text-slate-700">No brands yet</h2>
          <p className="mt-1 text-sm text-slate-500">
            Create your first brand to get started.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateBrandDialog trigger={<Button>＋ New brand</Button>} />
          </div>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {brands.map((b) => {
            const isActive = b.id === activeBrandId;
            return (
              <li key={b.id}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">
                        {b.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">
                          {b.name}
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          /{b.slug}
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
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
                      className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-100"
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

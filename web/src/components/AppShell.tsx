import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { CreateBrandDialog } from "./CreateBrandDialog";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui";

const NAV = [
  { to: "/compose", label: "Compose", icon: "✨" },
  { to: "/brands", label: "Brands", icon: "🏷️" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8.5l3 3 7-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="text-slate-400"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BrandSwitcher() {
  const { brands, activeBrand, activeBrandId, switchBrand } = useBrand();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-100">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-600 text-[11px] font-bold text-white">
            {(activeBrand?.name ?? "?").charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[12rem] truncate">
            {activeBrand?.name ?? "Select a brand"}
          </span>
          <ChevronIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Switch brand</DropdownMenuLabel>
        {brands.length === 0 && (
          <div className="px-2.5 py-2 text-sm text-slate-400">No brands yet.</div>
        )}
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onSelect={() => {
              void switchBrand(b.id);
            }}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[11px] font-bold text-slate-600">
              {b.name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{b.name}</span>
            {b.id === activeBrandId && (
              <span className="ml-auto text-brand-600">
                <CheckIcon />
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <CreateBrandDialog
          trigger={
            <DropdownMenuItem
              className="text-brand-700"
              onSelect={(e) => e.preventDefault()}
            >
              <span aria-hidden>＋</span> New brand
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account menu"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600 outline-none hover:bg-slate-300 focus-visible:ring-2 focus-visible:ring-brand-100"
        >
          {(me?.user.email ?? "?").charAt(0).toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="truncate px-2.5 py-2 text-xs text-slate-400">
          {me?.user.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-slate-700"
          onSelect={() => {
            void logout();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <span className="font-semibold">Harness</span>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none ${
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <BrandSwitcher />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden">
              <BrandSwitcher />
            </div>
            <div className="hidden min-w-0 md:block">
              <h1 className="truncate text-lg font-semibold">{title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-slate-400">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <UserMenu />
          </div>
        </header>

        {/* Mobile nav */}
        <nav
          className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden"
          aria-label="Primary mobile"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `shrink-0 rounded-lg px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-slate-600"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="md:hidden">
          <div className="px-4 pt-4">
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export { Button };

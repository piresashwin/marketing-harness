import { type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart2,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  Home,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Tag,
} from "lucide-react";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { CreateBrandDialog } from "./CreateBrandDialog";
import { ThemeToggle } from "./ThemeToggle";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui";

const NAV: { to: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/compose", label: "Compose", icon: Sparkles },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/calendar", label: "Calendar", icon: CalendarClock },
  { to: "/analytics", label: "Analytics", icon: BarChart2 },
  { to: "/brands", label: "Brands", icon: Tag },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function BrandSwitcher() {
  const { brands, activeBrand, activeBrandId, switchBrand } = useBrand();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink outline-none transition hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand-100">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-600 text-[11px] font-bold text-white">
            {(activeBrand?.name ?? "?").charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[12rem] truncate">
            {activeBrand?.name ?? "Select a brand"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Switch brand</DropdownMenuLabel>
        {brands.length === 0 && (
          <div className="px-2.5 py-2 text-sm text-faint">No brands yet.</div>
        )}
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onSelect={() => {
              void switchBrand(b.id);
            }}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-hover text-[11px] font-bold text-muted">
              {b.name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{b.name}</span>
            {b.id === activeBrandId && (
              <Check className="ml-auto h-4 w-4 text-brand-600" />
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
              <Plus className="h-4 w-4" /> New brand
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
          className="flex h-9 w-9 items-center justify-center rounded-full bg-hover text-sm font-semibold text-muted outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100"
        >
          {(me?.user.email ?? "?").charAt(0).toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="truncate px-2.5 py-2 text-xs text-faint">
          {me?.user.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-ink"
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
  bleed = false,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip the centered max-w-4xl wrapper so the page controls its own width. */
  bleed?: boolean;
}) {
  // Re-key the content on navigation so it replays the page-enter animation.
  const { pathname } = useLocation();
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <span className="font-semibold text-ink">Harness</span>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none ${
                    isActive
                      ? "bg-accent-soft font-medium text-accent-soft-fg"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`
                }
              >
                <Icon className="h-[18px] w-[18px]" />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <BrandSwitcher />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden">
              <BrandSwitcher />
            </div>
            <div className="hidden min-w-0 md:block">
              <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-faint">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Mobile nav */}
        <nav
          className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden"
          aria-label="Primary mobile"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `shrink-0 rounded-lg px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${
                  isActive
                    ? "bg-accent-soft font-medium text-accent-soft-fg"
                    : "text-muted"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="md:hidden">
          <div className="px-4 pt-4">
            <h1 className="text-lg font-semibold text-ink">{title}</h1>
            {subtitle && <p className="text-xs text-faint">{subtitle}</p>}
          </div>
        </div>

        {bleed ? (
          <div key={pathname} className="animate-page">
            {children}
          </div>
        ) : (
          <div
            key={pathname}
            className="animate-page mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8"
          >
            {children}
          </div>
        )}
      </main>
    </div>
  );
}

export { Button };

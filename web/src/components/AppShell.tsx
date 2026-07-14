import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2,
  Brain,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  Home,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Tag,
  Target,
  UserRound,
} from "lucide-react";
import { api } from "../api";
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

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Marks the item that carries the needs-review count pill. */
  showsReviewBadge?: boolean;
}

// Grouped in journey order: strategize → create → publish → learn.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ to: "/home", label: "Home", icon: Home }] },
  {
    label: "Strategy",
    items: [
      { to: "/goal", label: "Goals", icon: Target },
      { to: "/plan", label: "Content plan", icon: CalendarRange },
    ],
  },
  {
    label: "Create",
    items: [{ to: "/compose", label: "Compose", icon: Sparkles }],
  },
  {
    label: "Publish",
    items: [
      { to: "/calendar", label: "Queue", icon: CalendarClock, showsReviewBadge: true },
    ],
  },
  {
    label: "Learn",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart2 },
      { to: "/brain", label: "Brand Brain", icon: Brain },
    ],
  },
];

const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Needs-review count for the Queue nav badge. AppShell remounts on every
 *  navigation (no shared layout route), so this refreshes as the user moves. */
function useReviewCount(): number {
  const { activeBrandId } = useBrand();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (activeBrandId == null) {
      setCount(0);
      return;
    }
    let live = true;
    api
      .listReviewQueue(activeBrandId)
      .then((q) => {
        if (live) setCount(q.length);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeBrandId]);
  return count;
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent-soft-fg">
      {count}
    </span>
  );
}

function BrandSwitcher() {
  const { brands, activeBrand, activeBrandId, switchBrand } = useBrand();
  const navigate = useNavigate();

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
        <DropdownMenuItem onSelect={() => navigate("/brands")}>
          <Tag className="h-4 w-4" /> Manage brands
        </DropdownMenuItem>
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
  const { activeBrandId } = useBrand();
  const reviewCount = useReviewCount();
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            I
          </div>
          <span className="font-semibold text-ink">Inflxr</span>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3" aria-label="Primary">
          {NAV_GROUPS.map((group) => (
            <div key={group.label ?? "top"} className="space-y-1">
              {group.label && (
                <p className="px-3 pt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-faint">
                  {group.label}
                </p>
              )}
              {group.items.map((n) => {
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
                    {n.showsReviewBadge && <NavBadge count={reviewCount} />}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <BrandSwitcher />
          <Link
            to={activeBrandId != null ? `/brands/${activeBrandId}/settings` : "/brands"}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none"
          >
            <UserRound className="h-[18px] w-[18px]" />
            Brand profile
          </Link>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none ${
                isActive
                  ? "bg-accent-soft font-medium text-accent-soft-fg"
                  : "text-muted hover:bg-hover hover:text-ink"
              }`
            }
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
            Settings
          </NavLink>
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
            {/* Desktop reaches Settings via the sidebar footer. */}
            <Link
              to="/settings"
              aria-label="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-100 md:hidden"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Mobile nav */}
        <nav
          className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden"
          aria-label="Primary mobile"
        >
          {NAV_FLAT.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${
                  isActive
                    ? "bg-accent-soft font-medium text-accent-soft-fg"
                    : "text-muted"
                }`
              }
            >
              {n.label}
              {n.showsReviewBadge && <NavBadge count={reviewCount} />}
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

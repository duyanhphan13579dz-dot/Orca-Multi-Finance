"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type MouseEvent,
} from "react";
import { markAppNavigating } from "@/lib/hooks";
import { clientCacheWarm } from "@/lib/client-cache";
import {
  Bot,
  Boxes,
  CandlestickChart,
  ChartNoAxesCombined,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  DollarSign,
  Eye,
  FlaskConical,
  Globe2,
  Grid2x2,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Settings,
  X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { ErrorBoundary } from "@/components/error-boundary";
import { NotifBell } from "@/components/notif-bell";
import { PriceAlertEngine } from "@/components/price-alert-engine";

const NAV_SECTIONS: {
  title: string;
  items: {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    core?: boolean;
  }[];
}[] = [
  {
    title: "THỊ TRƯỜNG",
    items: [
      { href: "/", label: "Tổng quan", icon: Home, core: true },
      { href: "/stocks", label: "Cổ phiếu VN", icon: CandlestickChart, core: true },
      { href: "/crypto", label: "Tiền mã hóa", icon: Coins, core: true },
      { href: "/forex", label: "Ngoại hối", icon: DollarSign },
      { href: "/commodities", label: "Hàng hóa", icon: Boxes },
      { href: "/macro-economic", label: "Kinh tế vĩ mô", icon: ChartNoAxesCombined },
      { href: "/currency-interest-rate", label: "Lãi suất tiền tệ", icon: Landmark },
    ],
  },
  {
    title: "CÔNG CỤ",
    items: [
      { href: "/heatmap", label: "Bản đồ nhiệt", icon: Grid2x2 },
      { href: "/screener", label: "Bộ lọc", icon: FlaskConical },
      { href: "/news", label: "Tin tức", icon: Newspaper, core: true },
      { href: "/reports", label: "Bản tin", icon: Globe2 },
      { href: "/agent", label: "Trợ lý AI", icon: Bot },
    ],
  },
  {
    title: "DANH MỤC",
    items: [
      { href: "/portfolio", label: "Smart Portfolio", icon: LayoutDashboard },
      { href: "/watchlist", label: "Danh mục theo dõi", icon: Eye },
      { href: "/settings", label: "Cài đặt", icon: Settings },
    ],
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const onNav = useCallback(
    (href: string, e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      markAppNavigating();
      router.push(href);
    },
    [router],
  );

  const onHover = useCallback(
    (href: string) => {
      try {
        router.prefetch(href);
        clientCacheWarm(href);
      } catch {
        /* ignore */
      }
    },
    [router],
  );

  const NavItem = ({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }) => {
    const active = isActivePath(pathname, href);
    return (
      <Link
        href={href}
        onClick={(e) => onNav(href, e)}
        onMouseEnter={() => onHover(href)}
        className={
          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors " +
          (active
            ? "bg-accent-primary/15 font-medium text-accent-primary"
            : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary")
        }
        title={label}
      >
        <Icon className="size-4 shrink-0" />
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-border-subtle px-3">
        <Link href="/" className="min-w-0 flex-1" onClick={(e) => onNav("/", e)}>
          {collapsed ? <OrcaMark className="size-7" /> : <OrcaWordmark />}
        </Link>
        <button
          type="button"
          className="hidden rounded-md p-1 text-text-muted hover:bg-surface-elevated md:inline-flex"
          onClick={() => setCollapsed((v) => !v)}
          aria-label="Thu gọn"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
        <button
          type="button"
          className="inline-flex rounded-md p-1 text-text-muted hover:bg-surface-elevated md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Đóng menu"
        >
          <X className="size-4" />
        </button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {!collapsed ? (
              <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {section.title}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.href} href={item.href} label={item.label} icon={item.icon} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border-subtle p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-primary text-text-primary">
      <PriceAlertEngine />
      <div className="border-b border-border-subtle">
        <TickerTape />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          className={
            "hidden shrink-0 border-r border-border-subtle bg-surface-base transition-[width] md:block " +
            (collapsed ? "w-[56px]" : "w-[220px]")
          }
        >
          {sidebar}
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label="Đóng menu"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-[260px] bg-surface-base shadow-xl">
              {sidebar}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b border-border-subtle px-3">
            <button
              type="button"
              className="grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Menu"
            >
              <Menu className="size-4.5" />
            </button>
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <NotifBell />
            <Link
              href="/settings"
              className="grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
              aria-label="Cài đặt"
            >
              <Settings className="size-4" />
            </Link>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <ErrorBoundary key={pathname}>
              <div className="p-3 sm:p-4">{children}</div>
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: me, mutate } = useApi<{ user: { email: string; name: string | null } }>(
    "/api/v1/auth/me",
  );

  useEffect(() => {
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayName =
    settings.profile.displayName || me?.user?.name || me?.user?.email?.split("@")[0] || "";
  const initials = displayName.slice(0, 2).toUpperCase() || "?";

  const logout = async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    void mutate();
    router.push("/login");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-elevated"
      >
        <span className="grid size-8 place-items-center rounded-md border border-border-subtle bg-surface-elevated text-[11px] font-bold">
          {me?.user ? initials : "?"}
        </span>
        {!collapsed ? (
          <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
            {me?.user ? displayName || me.user.email : "Đăng nhập"}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-52 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          {me?.user ? (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <div className="truncate text-[12.5px] font-semibold">{displayName || me.user.email}</div>
                <div className="truncate text-[10.5px] text-text-muted">{me.user.email}</div>
              </div>
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-text-secondary hover:bg-surface-elevated"
              >
                <Settings className="size-3.5" /> Cài đặt
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-[12.5px] text-negative hover:bg-surface-elevated"
              >
                <LogOut className="size-3.5" /> Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[12.5px] text-accent-primary hover:bg-surface-elevated"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

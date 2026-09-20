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
import {
  Bell,
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
  LogOut,
  Menu,
  Newspaper,
  NotebookPen,
  Settings,
  X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { FreshnessDot } from "@/components/ui";
import type { NewsArticle } from "@/lib/types";

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
    title: "PHÂN TÍCH",
    items: [
      { href: "/heatmap", label: "Bản đồ nhiệt", icon: Grid2x2 },
      { href: "/screener", label: "Bộ lọc", icon: FlaskConical },
      { href: "/news", label: "Tin tức", icon: Newspaper, core: true },
      { href: "/reports", label: "Bản tin", icon: Globe2 },
      { href: "/agent", label: "Trợ lý AI", icon: Bot },
    ],
  },
  {
    title: "LÀM VIỆC",
    items: [
      { href: "/watchlist", label: "Danh mục theo dõi", icon: Eye },
      { href: "/journal", label: "Nhật ký lệnh", icon: NotebookPen },
      { href: "/settings", label: "Cài đặt", icon: Settings },
    ],
  },
];

const ALL_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
const CORE_HREFS = NAV_SECTIONS.flatMap((s) =>
  s.items.filter((i) => i.core).map((i) => i.href),
);
const SECONDARY_HREFS = ALL_HREFS.filter((h) => !CORE_HREFS.includes(h));

const SB_KEY = "orca.sidebar.collapsed";

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

/** Next.js App Router route warmer — full segment tree via router.prefetch. */
function useRoutePrefetch() {
  const router = useRouter();
  const warmed = useRef(new Set<string>());

  const warm = useCallback(
    (href: string) => {
      if (!href || warmed.current.has(href)) return;
      warmed.current.add(href);
      try {
        void router.prefetch(href);
      } catch {
        warmed.current.delete(href);
      }
    },
    [router],
  );

  const warmMany = useCallback(
    (hrefs: string[]) => {
      for (const href of hrefs) warm(href);
    },
    [warm],
  );

  return { warm, warmMany };
}

function scheduleIdle(fn: () => void, timeoutMs: number): number {
  if (typeof window === "undefined") {
    return setTimeout(fn, Math.min(timeoutMs, 400)) as unknown as number;
  }
  const ric = window.requestIdleCallback?.bind(window);
  if (typeof ric === "function") {
    return ric(fn, { timeout: timeoutMs });
  }
  return setTimeout(fn, Math.min(timeoutMs, 400)) as unknown as number;
}

function cancelIdle(id: number) {
  if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const { warm, warmMany } = useRoutePrefetch();

  useEffect(() => {
    try {
      if (localStorage.getItem(SB_KEY) === "1") setCollapsed(true);
    } catch {}
  }, []);

  /**
   * Staged idle prefetch (Next.js production only actually networks):
   *  1) core routes ASAP on idle
   *  2) secondary routes after a short gap so we don't contend with first paint
   */
  useEffect(() => {
    let cancelled = false;
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;

    const idleId = scheduleIdle(() => {
      if (cancelled) return;
      warmMany(CORE_HREFS);
      t1 = setTimeout(() => {
        if (cancelled) return;
        warmMany(SECONDARY_HREFS);
      }, 600);
    }, 1200);

    // Safety net: ensure cores are warm even if idle never fires
    t2 = setTimeout(() => {
      if (!cancelled) warmMany(CORE_HREFS);
    }, 2500);

    return () => {
      cancelled = true;
      cancelIdle(idleId);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [warmMany]);

  // Route settled
  useEffect(() => {
    setMobileOpen(false);
    setPendingHref(null);
    markAppNavigating(400);
    setRouteBusy(true);
    const t = setTimeout(() => setRouteBusy(false), 360);
    return () => clearTimeout(t);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SB_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const onIntent = useCallback(
    (href: string) => {
      warm(href);
    },
    [warm],
  );

  /**
   * Soft click — do NOT preventDefault so Next.js <Link> owns navigation.
   * Modifier / middle-click still open new tabs natively.
   */
  const onNavClick = useCallback(
    (href: string, e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (href === pathname) {
        e.preventDefault();
        return;
      }
      setPendingHref(href);
      markAppNavigating(480);
      setRouteBusy(true);
    },
    [pathname],
  );

  const effectivePath = pendingHref ?? pathname;

  return (
    <div className="flex h-full flex-col bg-canvas text-text-primary">
      <div
        aria-hidden
        className={`pointer-events-none fixed left-0 right-0 top-0 z-[60] h-[2px] origin-left bg-accent-primary transition-[transform,opacity] duration-300 ease-out ${
          routeBusy ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
        }`}
        style={{ transformOrigin: "left center" }}
      />

      <TickerTape />

      <div className="flex min-h-0 flex-1">
        <aside
          className={`hidden shrink-0 flex-col border-r border-border-subtle bg-surface-base lg:flex ${
            collapsed ? "w-[60px]" : "w-[220px]"
          }`}
          style={{
            transition: "width 200ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "width",
          }}
        >
          <div
            className={`flex shrink-0 items-center border-b border-border-subtle ${
              collapsed ? "justify-center px-1.5" : "gap-1.5 px-2.5"
            }`}
            style={{ height: 52 }}
          >
            <Link
              href="/"
              prefetch
              onPointerEnter={() => onIntent("/")}
              onFocus={() => onIntent("/")}
              onClick={(e) => onNavClick("/", e)}
              className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
            >
              {collapsed ? (
                <OrcaMark size={28} className="shrink-0 rounded-md" />
              ) : (
                <OrcaWordmark size={28} subtitle={false} />
              )}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="ml-auto grid size-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary active:scale-95"
                aria-label="Thu gọn sidebar"
              >
                <ChevronsLeft className="size-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <div className="flex justify-center border-b border-border-subtle py-1.5">
              <button
                type="button"
                onClick={toggleCollapsed}
                className="grid size-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary active:scale-95"
                aria-label="Mở rộng sidebar"
              >
                <ChevronsRight className="size-4" />
              </button>
            </div>
          )}

          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
            {NAV_SECTIONS.map((section, sIdx) => (
              <div key={section.title} className={sIdx > 0 ? "mt-1" : ""}>
                {!collapsed ? (
                  <div className="mb-1 px-3 pt-1 text-[10px] font-semibold tracking-[0.14em] text-text-muted">
                    {section.title}
                  </div>
                ) : (
                  sIdx > 0 && (
                    <div className="mx-auto my-1.5 h-px w-6 bg-border-subtle" aria-hidden />
                  )
                )}
                <ul
                  className={`flex flex-col ${
                    collapsed ? "items-center gap-0.5 px-1" : "gap-0.5 px-1.5"
                  }`}
                >
                  {section.items.map((item) => {
                    const active = isActivePath(effectivePath, item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href} className={collapsed ? "w-full" : undefined}>
                        <Link
                          href={item.href}
                          prefetch
                          title={collapsed ? item.label : undefined}
                          onPointerEnter={() => onIntent(item.href)}
                          onFocus={() => onIntent(item.href)}
                          onTouchStart={() => onIntent(item.href)}
                          onClick={(e) => onNavClick(item.href, e)}
                          className={`group relative flex items-center rounded-lg text-[13px] font-medium outline-none transition-[background-color,color,transform,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent-primary/40 ${
                            collapsed
                              ? "mx-auto size-10 justify-center"
                              : "gap-2.5 px-2.5 py-[7px]"
                          } ${
                            active
                              ? "bg-accent-primary/15 text-accent-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.28)]"
                              : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary active:scale-[0.97]"
                          }`}
                        >
                          {collapsed && active && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-primary"
                            />
                          )}
                          <Icon
                            className={`size-[18px] shrink-0 transition-colors duration-150 ${
                              active
                                ? "text-accent-primary"
                                : "text-text-muted group-hover:text-text-secondary"
                            }`}
                          />
                          {!collapsed && <span className="truncate leading-none">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b border-border-subtle bg-surface-base px-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-9 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated active:scale-95"
              aria-label="Menu"
            >
              <Menu className="size-5" />
            </button>
            <Link
              href="/"
              prefetch
              onPointerEnter={() => onIntent("/")}
              onClick={(e) => onNavClick("/", e)}
              className="flex items-center gap-2"
            >
              <OrcaMark size={26} className="rounded-md" />
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <NotifBell />
              <UserMenu />
            </div>
          </header>

          <header className="hidden h-12 items-center gap-3 border-b border-border-subtle bg-surface-base/90 px-4 backdrop-blur lg:flex">
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <NotifBell />
            <UserMenu />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 md:px-5">{children}</div>
          </main>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute bottom-0 left-0 top-0 flex w-[min(280px,86vw)] flex-col bg-surface-base shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-border-subtle px-3">
              <OrcaWordmark size={28} subtitle={false} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid size-9 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-elevated active:scale-95"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {NAV_SECTIONS.map((section) => (
                <div key={section.title} className="mb-4">
                  <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-[0.14em] text-text-muted">
                    {section.title}
                  </div>
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = isActivePath(effectivePath, item.href);
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch
                            onPointerEnter={() => onIntent(item.href)}
                            onTouchStart={() => onIntent(item.href)}
                            onClick={(e) => {
                              setMobileOpen(false);
                              onNavClick(item.href, e);
                            }}
                            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${
                              active
                                ? "bg-accent-primary/15 text-accent-primary"
                                : "text-text-secondary hover:bg-surface-elevated"
                            }`}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}

function NotifBell() {
  const { settings } = useSettings();
  const { data } = useApi<{ articles: NewsArticle[] }>("/api/v1/news?limit=8", {
    refreshInterval: 90_000,
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const articles = data?.articles ?? [];

  useEffect(() => {
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Thông báo tin tức"
        className="relative grid size-9 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary active:scale-95"
      >
        <Bell className="size-4.5" />
        {articles.length > 0 && (
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent-primary" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(340px,92vw)] overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-[12.5px] font-semibold text-text-primary">Tin mới</span>
            <FreshnessDot />
          </div>
          {articles.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-text-muted">Chưa có tin</div>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {articles.slice(0, 8).map((a) => (
                <li key={a.id || a.url}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="block border-b border-border-subtle px-3 py-2.5 text-left transition-colors hover:bg-surface-elevated"
                  >
                    <span className="line-clamp-2 text-[12.5px] font-medium text-text-primary">
                      {a.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-text-muted">
                      {a.source} ·{" "}
                      {new Date(a.publishedAt).toLocaleTimeString("vi-VN", {
                        timeZone: settings.profile.timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
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
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Tài khoản"
        className="grid size-9 place-items-center overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated text-[11px] font-bold transition-colors hover:border-border-default active:scale-95 sm:size-8"
      >
        {me?.user ? initials || "·" : <span className="text-text-muted">?</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          {me?.user ? (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <div className="truncate text-[12.5px] font-semibold text-text-primary">
                  {displayName || me.user.email}
                </div>
                <div className="truncate text-[10.5px] text-text-muted">{me.user.email}</div>
              </div>
              <Link
                href="/settings"
                prefetch
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
              >
                <Settings className="size-3.5" /> Cài đặt
              </Link>
              <button
                onClick={async () => {
                  await fetch("/api/v1/auth/logout", { method: "POST" });
                  void mutate();
                  setOpen(false);
                  router.refresh();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
              >
                <LogOut className="size-3.5" /> Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              prefetch
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

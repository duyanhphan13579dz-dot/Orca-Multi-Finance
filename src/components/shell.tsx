"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { markAppNavigating } from "@/lib/hooks";
import {
  Bell, Bot, Boxes, CandlestickChart, ChartNoAxesCombined, ChevronsLeft, ChevronsRight, Coins, DollarSign,
  Eye, FlaskConical, Globe2, Grid2x2, Home, Landmark, LogOut, Menu, Newspaper, NotebookPen, Settings, X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { FreshnessDot } from "@/components/ui";
import type { NewsArticle } from "@/lib/types";

const NAV_SECTIONS: { title: string; items: { href: string; label: string; icon: ComponentType<{ className?: string }>; core?: boolean }[] }[] = [
  {
    title: "THỊ TRƯỜNG",
    items: [
      { href: "/", label: "Tổng quan", icon: Home },
      { href: "/stocks", label: "Cổ phiếu VN", icon: CandlestickChart, core: true },
      { href: "/crypto", label: "Tiền mã hóa", icon: Coins },
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
      { href: "/news", label: "Tin tức", icon: Newspaper },
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

const SB_KEY = "orca.sidebar.collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SB_KEY);
      if (v === "1") setCollapsed(true);
    } catch {}
  }, []);

  // Prefetch core routes on idle
  useEffect(() => {
    const cores = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.core || i.href === "/" || i.href === "/news" || i.href === "/stocks").map((i) => i.href);
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      for (const href of cores) {
        try { router.prefetch(href); } catch {}
      }
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as any).requestIdleCallback(run, { timeout: 2500 });
      return () => { cancelled = true; (window as any).cancelIdleCallback?.(id); };
    }
    const t = setTimeout(run, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [router]);

  // Close mobile drawer on route change + mark navigating
  useEffect(() => {
    setMobileOpen(false);
    markAppNavigating(480);
    setRouteBusy(true);
    const t = setTimeout(() => setRouteBusy(false), 420);
    return () => clearTimeout(t);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SB_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const navigate = (href: string) => {
    if (href === pathname) return;
    markAppNavigating(480);
    setRouteBusy(true);
    startTransition(() => {
      router.push(href);
    });
  };

  return (
    <div className="flex h-full flex-col bg-canvas text-text-primary">
      {/* Top progress bar */}
      <div
        className={`pointer-events-none fixed left-0 right-0 top-0 z-[60] h-0.5 origin-left bg-accent-primary transition-transform duration-300 ${
          routeBusy ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
        }`}
        style={{ transformOrigin: "left" }}
      />

      <TickerTape />

      <div className="flex min-h-0 flex-1">
        {/* Sidebar desktop */}
        <aside
          className={`hidden shrink-0 flex-col border-r border-border-subtle bg-surface-base transition-[width] duration-200 lg:flex ${
            collapsed ? "w-[64px]" : "w-[220px]"
          }`}
        >
          <div className="flex h-14 items-center gap-2 border-b border-border-subtle px-3">
            <Link href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="flex min-w-0 items-center gap-2">
              <OrcaMark size={28} className="shrink-0 rounded-md" />
              {!collapsed && <OrcaWordmark className="truncate text-[15px]" />}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="ml-auto grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-elevated hover:text-text-primary"
              aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="mb-4">
                {!collapsed && (
                  <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-wider text-text-muted">
                    {section.title}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(item.href);
                          }}
                          className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all ${
                            active
                              ? "bg-accent-primary/15 text-accent-primary shadow-[inset_0_0_0_1px_rgba(0,212,255,0.25)]"
                              : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary active:scale-[0.98]"
                          }`}
                        >
                          <Icon className={`size-4 shrink-0 ${active ? "text-accent-primary" : "text-text-muted group-hover:text-text-secondary"}`} />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="flex h-12 items-center gap-2 border-b border-border-subtle bg-surface-base px-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated"
              aria-label="Menu"
            >
              <Menu className="size-5" />
            </button>
            <Link href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="flex items-center gap-2">
              <OrcaMark size={26} className="rounded-md" />
              <OrcaWordmark className="text-[14px]" />
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <NotifBell />
              <UserMenu />
            </div>
          </header>

          {/* Desktop top bar */}
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

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute bottom-0 left-0 top-0 flex w-[min(280px,86vw)] flex-col bg-surface-base shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-border-subtle px-3">
              <OrcaWordmark className="text-[15px]" />
              <button type="button" onClick={() => setMobileOpen(false)} className="grid size-9 place-items-center rounded-lg text-text-muted hover:bg-surface-elevated">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {NAV_SECTIONS.map((section) => (
                <div key={section.title} className="mb-4">
                  <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-wider text-text-muted">{section.title}</div>
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch
                            onClick={(e) => {
                              e.preventDefault();
                              setMobileOpen(false);
                              navigate(item.href);
                            }}
                            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium ${
                              active ? "bg-accent-primary/15 text-accent-primary" : "text-text-secondary hover:bg-surface-elevated"
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
  const { data } = useApi<{ articles: NewsArticle[] }>("/api/v1/news?limit=8", { refreshInterval: 90_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const articles = data?.articles ?? [];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
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
        className="relative grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
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
                    className="block border-b border-border-subtle px-3 py-2.5 text-left hover:bg-surface-elevated"
                  >
                    <span className="line-clamp-2 text-[12.5px] font-medium text-text-primary">{a.title}</span>
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
  const { data: me, mutate } = useApi<{ user: { email: string; name: string | null } }>("/api/v1/auth/me");

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayName = settings.profile.displayName || me?.user?.name || me?.user?.email?.split("@")[0] || "";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Tài khoản"
        className="grid size-9 place-items-center overflow-hidden rounded-lg border border-border-subtle text-[11px] font-bold transition-colors hover:border-border-default sm:size-8 bg-surface-elevated"
      >
        {me?.user ? initials || "·" : <span className="text-text-muted">?</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          {me?.user ? (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <div className="truncate text-[12.5px] font-semibold text-text-primary">{displayName || me.user.email}</div>
                <div className="truncate text-[10.5px] text-text-muted">{me.user.email}</div>
              </div>
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
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
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
              >
                <LogOut className="size-3.5" /> Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[12.5px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

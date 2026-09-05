"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell, Bot, Boxes, CandlestickChart, ChevronsLeft, ChevronsRight, Coins, DollarSign,
  Eye, FlaskConical, GaugeCircle, Globe2, Grid2x2, Home, LogOut, Menu, Newspaper, NotebookPen, Settings, X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { FreshnessDot } from "@/components/ui";
import type { NewsArticle } from "@/lib/types";

const NAV_SECTIONS: { title: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; core?: boolean }[] }[] = [
  {
    title: "MARKETS",
    items: [
      { href: "/", label: "Tổng quan", icon: Home },
      { href: "/stocks", label: "Cổ phiếu VN", icon: CandlestickChart, core: true },
      { href: "/crypto", label: "Crypto", icon: Coins },
      { href: "/forex", label: "Forex", icon: DollarSign },
      { href: "/commodities", label: "Hàng hóa", icon: Boxes },
    ],
  },
  {
    title: "INTELLIGENCE",
    items: [
      { href: "/heatmap", label: "Heatmap", icon: Grid2x2 },
      { href: "/screener", label: "Screener", icon: FlaskConical },
      { href: "/news", label: "Tin tức", icon: Newspaper },
      { href: "/reports", label: "Bản tin", icon: Globe2 },
      { href: "/agent", label: "AI Agent", icon: Bot },
    ],
  },
  {
    title: "WORKSPACE",
    items: [
      { href: "/watchlist", label: "Watchlist", icon: Eye },
      { href: "/journal", label: "Nhật ký lệnh", icon: NotebookPen },
      { href: "/settings", label: "Cài đặt", icon: Settings },
    ],
  },
];

const SB_KEY = "orca.sidebar.collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SB_KEY) === "1");
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(SB_KEY, c ? "0" : "1");
      return !c;
    });
  };

  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebarW = collapsed ? "w-[56px]" : "w-[208px]";
  const mainML = collapsed ? "lg:ml-[56px]" : "lg:ml-[208px]";

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border-subtle bg-background-secondary transition-[width] duration-200 lg:flex ${sidebarW}`}
        aria-label="Điều hướng chính"
      >
        <Link href="/" className="flex h-[60px] items-center gap-2 border-b border-border-subtle px-3" aria-label="ORCA Financial — Tổng quan">
          {collapsed ? <OrcaMark size={30} /> : <OrcaWordmark size={30} />}
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-1.5">
              {!collapsed && (
                <div className="px-2 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-text-muted">{section.title}</div>
              )}
              {section.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`group relative mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[12.5px] outline-none transition-colors ${
                      active ? "bg-accent-primary/12 text-accent-primary" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-accent-primary" />}
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.core && (
                      <span className="ml-auto rounded border border-accent-primary/40 bg-accent-primary/10 px-1 text-[8.5px] font-bold tracking-wider text-accent-primary">CORE</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-border-subtle p-2">
          <Link
            href="/system"
            title="Giám sát hệ thống"
            className={`mb-1 flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[12.5px] ${
              pathname.startsWith("/system") ? "bg-accent-primary/12 text-accent-primary" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
            }`}
          >
            <GaugeCircle className="size-4 shrink-0" />
            {!collapsed && <span>Hệ thống</span>}
          </Link>
          <button
            onClick={toggle}
            title="Thu gọn sidebar (Ctrl+B)"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-[12.5px] text-text-muted hover:bg-surface-elevated hover:text-text-primary"
          >
            {collapsed ? <ChevronsRight className="size-4 shrink-0" /> : <ChevronsLeft className="size-4 shrink-0" />}
            {!collapsed && <span>Thu gọn</span>}
          </button>
        </div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[240px] border-r border-border-subtle bg-background-secondary p-3">
            <div className="mb-3 flex items-center justify-between">
              <OrcaWordmark size={28} />
              <button onClick={() => setMobileOpen(false)} aria-label="Đóng menu" className="rounded-md p-1 text-text-muted hover:text-text-primary">
                <X className="size-5" />
              </button>
            </div>
            <nav>
              {NAV_SECTIONS.flatMap((s) => s.items).map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2.5 text-[13px] ${
                      active ? "bg-accent-primary/12 text-accent-primary" : "text-text-secondary"
                    }`}
                  >
                    <Icon className="size-4" /> {item.label}
                  </Link>
                );
              })}
              <Link href="/system" className="mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2.5 text-[13px] text-text-secondary">
                <GaugeCircle className="size-4" /> Hệ thống
              </Link>
            </nav>
          </div>
        </div>
      )}

      {/* main column */}
      <div className={`flex min-w-0 flex-1 flex-col transition-[margin] duration-200 ${mainML}`}>
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-background-primary/85 backdrop-blur">
          <div className="flex h-[52px] items-center gap-3 px-3 md:px-4">
            <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-text-secondary hover:bg-surface-elevated lg:hidden" aria-label="Mở menu">
              <Menu className="size-5" />
            </button>
            <Link href="/" className="lg:hidden" aria-label="ORCA"><OrcaMark size={26} /></Link>
            <div className="hidden min-w-0 flex-1 md:block">
              <GlobalSearch />
            </div>
            <div className="flex-1 md:hidden" />
            <MarketChip />
            <Clock />
            <NotificationsBell />
            <UserMenu />
          </div>
          <TickerTape />
        </header>
        <main className="min-w-0 flex-1 px-3 py-4 md:px-4">
          <div className="md:hidden mb-3"><GlobalSearch /></div>
          {children}
        </main>
        <footer className="border-t border-border-subtle px-4 py-2.5 text-[10.5px] leading-relaxed text-text-muted">
          ORCA Financial · dữ liệu phục vụ nghiên cứu — không phải khuyến nghị đầu tư · nguồn: VNStock · Binance · Biquote · Vietnambiz · Simplize · RSS · mọi dữ liệu gắn nhãn LIVE/FRESH/DELAYED/STALE/DEGRADED/UNAVAILABLE
        </footer>
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function MarketChip() {
  const { meta } = useApi<Record<string, unknown>>("/api/v1/market/snapshot", { refreshInterval: 20_000 });
  return (
    <Link
      href="/system"
      title="Trạng thái dữ liệu thị trường"
      className="hidden items-center gap-2 rounded-full border border-border-subtle bg-surface-elevated px-3 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-default sm:flex"
    >
      <FreshnessDot status={meta?.freshness} ageMs={null} />
    </Link>
  );
}

function Clock() {
  const { settings } = useSettings();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const tz = settings.profile.timezone || "Asia/Ho_Chi_Minh";
  return (
    <div className="num hidden items-center gap-1.5 text-[12px] text-text-secondary xl:flex" title={`Múi giờ: ${tz}`}>
      <span className="text-text-muted">{tz === "Asia/Ho_Chi_Minh" ? "VN" : tz.split("/").pop()}</span>
      {now ? now.toLocaleTimeString("vi-VN", { timeZone: tz, hour12: false }) : "--:--:--"}
    </div>
  );
}

function NotificationsBell() {
  const router = useRouter();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = settings.notifications.marketNews;
  const { data } = useApi<{ articles: NewsArticle[] }>(enabled ? "/api/v1/news?limit=5" : null, { refreshInterval: 60_000 });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fresh = (data?.articles ?? []).filter((a) => Date.now() - Date.parse(a.publishedAt) < 30 * 60_000).length;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Thông báo tin tức"
        className="relative rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
      >
        <Bell className="size-4.5" />
        {fresh > 0 && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent-primary" />}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          <div className="border-b border-border-subtle px-3 py-2 text-[12px] font-semibold text-text-primary">Tin mới nhất</div>
          {!enabled ? (
            <p className="px-3 py-3 text-[12px] text-text-muted">Thông báo tin tức đang tắt — bật lại trong Settings › Notifications.</p>
          ) : !data?.articles.length ? (
            <p className="px-3 py-3 text-[12px] text-text-muted">Chưa có tin mới.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {data.articles.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => { setOpen(false); router.push("/news"); }}
                    className="block w-full px-3 py-2 text-left hover:bg-surface-elevated"
                  >
                    <span className="line-clamp-2 text-[12px] leading-snug text-text-primary">{a.title}</span>
                    <span className="mt-0.5 block text-[10px] text-text-muted">
                      {a.source} · {new Date(a.publishedAt).toLocaleTimeString("vi-VN", { timeZone: settings.profile.timezone, hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const AVATAR_STYLES: Record<string, string> = {
  orca: "bg-surface-elevated",
  "initials-ocean": "bg-gradient-to-br from-accent-primary to-accent-2 text-white",
  "initials-slate": "bg-surface-modal text-text-secondary",
  "initials-amber": "bg-gradient-to-br from-warn to-warning text-canvas",
};

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
        className={`grid size-8 place-items-center overflow-hidden rounded-lg border border-border-subtle text-[11px] font-bold transition-colors hover:border-border-default ${AVATAR_STYLES[settings.profile.avatarStyle] ?? AVATAR_STYLES.orca}`}
      >
        {settings.profile.avatarStyle === "orca" ? (
          <OrcaMark size={30} className="rounded-lg" />
        ) : me?.user ? (
          initials || "·"
        ) : (
          <span className="text-text-muted">?</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          {me?.user ? (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <div className="text-[13px] font-medium text-text-primary">{displayName}</div>
                <div className="truncate text-[11px] text-text-muted">{me.user.email}</div>
              </div>
              <MenuLink href="/settings" label="Cài đặt" onClick={() => setOpen(false)} />
              <MenuLink href="/settings?tab=security" label="Bảo mật & phiên đăng nhập" onClick={() => setOpen(false)} />
              <button
                onClick={async () => {
                  await fetch("/api/v1/auth/logout", { method: "POST" });
                  await mutate();
                  setOpen(false);
                  router.refresh();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-negative hover:bg-surface-elevated"
              >
                <LogOut className="size-3.5" /> Đăng xuất
              </button>
            </>
          ) : (
            <>
              <MenuLink href="/login" label="Đăng nhập" onClick={() => setOpen(false)} />
              <MenuLink href="/register" label="Tạo tài khoản" onClick={() => setOpen(false)} />
              <div className="border-t border-border-subtle px-3 py-2 text-[10.5px] text-text-muted">Settings vẫn lưu cục bộ khi chưa đăng nhập.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="block px-3 py-2 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary">
      {label}
    </Link>
  );
}

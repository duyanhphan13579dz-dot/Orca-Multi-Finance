"use client";

import React from "react";
import Link from "next/link";
import {
  TrendingUp,
  FlaskConical,
  LayoutDashboard,
  Bot,
  Menu,
  Home,
  Calculator,
  ClipboardList,
  Sparkles,
} from "lucide-react";

interface MobileBottomNavProps {
  isPersonalFinanceMode: boolean;
  pathname: string;
  activePersonalTab: string;
  onOpenDrawer: () => void;
  onNav: (href: string, e?: React.MouseEvent<HTMLElement>) => void;
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  highlight?: boolean;
  accent?: boolean;
  isAction?: boolean;
}

export function MobileBottomNav({
  isPersonalFinanceMode,
  pathname,
  activePersonalTab,
  onOpenDrawer,
  onNav,
}: MobileBottomNavProps) {
  // Mode Đầu tư: 5 tabs chính cho ngón tay cái
  const investmentTabs: NavItem[] = [
    {
      id: "market",
      label: "Thị trường",
      href: "/",
      icon: TrendingUp,
      active: pathname === "/" || pathname.startsWith("/stocks") || pathname.startsWith("/crypto") || pathname.startsWith("/forex"),
    },
    {
      id: "screener",
      label: "Bộ lọc",
      href: "/screener",
      icon: FlaskConical,
      active: pathname === "/screener" || pathname === "/heatmap",
    },
    {
      id: "portfolio",
      label: "Danh mục",
      href: "/portfolio",
      icon: LayoutDashboard,
      active: pathname === "/portfolio" || pathname === "/watchlist",
    },
    {
      id: "agent",
      label: "Trợ lý AI",
      href: "/agent",
      icon: Bot,
      active: pathname === "/agent",
      highlight: true,
    },
    {
      id: "menu",
      label: "Menu",
      href: "#menu",
      icon: Menu,
      isAction: true,
      active: false,
    },
  ];

  // Mode Tài chính cá nhân: 5 tabs chính
  const personalTabs: NavItem[] = [
    {
      id: "dashboard",
      label: "Tổng quan",
      href: "/personal-finance#dashboard",
      icon: Home,
      active: activePersonalTab === "dashboard" || !activePersonalTab,
    },
    {
      id: "cashflow_calc",
      label: "Dòng tiền",
      href: "/personal-finance#cashflow_calc",
      icon: Calculator,
      active: activePersonalTab === "cashflow_calc",
    },
    {
      id: "checkin",
      label: "Check-in",
      href: "/personal-finance#checkin",
      icon: ClipboardList,
      active: activePersonalTab === "checkin",
      accent: true,
    },
    {
      id: "ask_orca",
      label: "Bé Orca AI",
      href: "/personal-finance#ask_orca",
      icon: Sparkles,
      active: activePersonalTab === "ask_orca",
      highlight: true,
    },
    {
      id: "menu",
      label: "Thêm",
      href: "#menu",
      icon: Menu,
      isAction: true,
      active: false,
    },
  ];

  const currentTabs = isPersonalFinanceMode ? personalTabs : investmentTabs;

  return (
    <nav
      className="orca-bottom-nav fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-border-subtle bg-surface-base/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(0,0,0,0.35)]"
      aria-label="Thanh điều hướng dưới"
    >
      <div className="grid h-[54px] grid-cols-5 items-stretch px-1">
        {currentTabs.map((tab) => {
          const Icon = tab.icon;

          if (tab.isAction) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={onOpenDrawer}
                className="flex h-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-text-muted transition-transform active:scale-90 hover:text-text-primary"
                aria-label="Mở tất cả menu"
              >
                <Icon className="size-5" />
                <span className="max-w-[58px] truncate text-[10px] font-medium leading-none tracking-tight">
                  {tab.label}
                </span>
              </button>
            );
          }

          const isActive = tab.active;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              onClick={(e) => onNav(tab.href, e)}
              className={
                "relative flex h-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-transform active:scale-90 " +
                (isActive
                  ? isPersonalFinanceMode
                    ? "font-semibold text-amber-300"
                    : "font-semibold text-accent-primary"
                  : "text-text-muted hover:text-text-primary")
              }
            >
              {tab.accent ? (
                <div className="relative">
                  <div
                    className={
                      "grid size-7 place-items-center rounded-full transition-all " +
                      (isActive
                        ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30"
                        : "bg-amber-400/20 text-amber-300 border border-amber-400/40")
                    }
                  >
                    <Icon className="size-4" />
                  </div>
                </div>
              ) : tab.highlight ? (
                <div className="relative">
                  <Icon
                    className={
                      "size-5 transition-transform " +
                      (isActive
                        ? isPersonalFinanceMode
                          ? "text-sky-300 scale-110 drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]"
                          : "text-accent-primary scale-110 drop-shadow-[0_0_6px_var(--color-accent-primary)]"
                        : "text-text-muted")
                    }
                  />
                  <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
              ) : (
                <Icon className={"size-5 transition-transform " + (isActive ? "scale-110" : "")} />
              )}

              <span className="text-[10px] leading-none tracking-tight truncate max-w-[58px]">
                {tab.label}
              </span>

              {isActive && !tab.accent && (
                <span
                  className={
                    "absolute bottom-1 size-1 rounded-full " +
                    (isPersonalFinanceMode ? "bg-amber-400" : "bg-accent-primary")
                  }
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

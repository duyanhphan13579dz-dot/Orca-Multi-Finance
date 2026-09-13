"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Tổng quan → BCTC → Cơ bản → Định giá → Doanh nghiệp */
const TABS = [
  { href: "", label: "Tổng quan & Kỹ thuật", short: "Tổng quan", key: "overview" },
  { href: "/financials", label: "Báo cáo tài chính", short: "BCTC", key: "financials" },
  { href: "/fundamentals", label: "Phân tích cơ bản", short: "Cơ bản", key: "fundamentals" },
  { href: "/valuation", label: "Định giá", short: "Định giá", key: "valuation" },
  { href: "/profile", label: "Doanh nghiệp", short: "DN", key: "profile" },
] as const;

export function StockTabs({ symbol }: { symbol: string }) {
  const pathname = usePathname() || "";
  const base = `/stocks/${symbol}`;
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>("[data-active=true]");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="stock-tabs-scroll border-b border-line px-1.5 pt-0.5 sm:px-2 sm:pt-1"
      aria-label="Tab cổ phiếu"
    >
      {TABS.map((t) => {
        const href = `${base}${t.href}`;
        const active =
          t.key === "overview"
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(href);
        return (
          <Link
            key={t.key}
            href={href}
            data-active={active ? "true" : undefined}
            className={`min-h-10 shrink-0 rounded-t-md px-3 py-2.5 text-[12px] font-medium transition-colors sm:min-h-0 sm:px-3.5 sm:py-2 ${
              active
                ? "border border-b-0 border-line bg-surface-elevated text-accent-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

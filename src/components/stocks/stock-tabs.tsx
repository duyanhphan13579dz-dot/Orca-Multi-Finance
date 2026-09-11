"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Thứ tự ưu tiên: Tổng quan → Báo cáo tài chính → Cơ bản → Doanh nghiệp */
const TABS = [
  { href: "", label: "Tổng quan & Kỹ thuật", key: "overview" },
  { href: "/financials", label: "Báo cáo tài chính", key: "financials" },
  { href: "/fundamentals", label: "Phân tích cơ bản", key: "fundamentals" },
  { href: "/profile", label: "Doanh nghiệp", key: "profile" },
] as const;

export function StockTabs({ symbol }: { symbol: string }) {
  const pathname = usePathname() || "";
  const base = `/stocks/${symbol}`;

  return (
    <nav className="flex flex-wrap gap-1 border-b border-line px-2 pt-1">
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
            className={`rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors ${
              active
                ? "border border-b-0 border-line bg-bg-2 text-accent"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

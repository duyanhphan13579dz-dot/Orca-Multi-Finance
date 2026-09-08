"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { useApi } from "@/lib/hooks";
import type { MarketSnapshot } from "@/lib/services/market";

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"] as const;

const TickerItem = memo(function TickerItem({ it }: { it: { key: string; label: string; href: string; price: number; chg: number | null; digits: number } }) {
  return (
    <Link href={it.href} className="num mx-4 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2 hover:text-ink">
      <span className="font-medium text-ink">{it.label}</span>
      <span>
        {it.price.toLocaleString("en-US", {
          minimumFractionDigits: it.digits,
          maximumFractionDigits: it.digits,
        })}
      </span>
      {it.chg != null && Number.isFinite(it.chg) && (
        <span className={it.chg >= 0 ? "text-up" : "text-down"}>
          {it.chg >= 0 ? "▲" : "▼"} {Math.abs(it.chg).toFixed(2)}%
        </span>
      )}
    </Link>
  );
});

/** Realtime ticker — VN indices + crypto + FX majors, CSS marquee. */
export function TickerTape() {
  const { data } = useApi<MarketSnapshot>("/api/v1/market/snapshot", { refreshInterval: 60_000 });
  const items = useMemo(() => {
    const out: { key: string; label: string; href: string; price: number; chg: number | null; digits: number }[] = [];
    if (data?.indices?.length) {
      const sorted = [...data.indices].sort((a, b) => {
        const ia = INDEX_PRIORITY.indexOf(a.code as typeof INDEX_PRIORITY[number]);
        const ib = INDEX_PRIORITY.indexOf(b.code as typeof INDEX_PRIORITY[number]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      for (const i of sorted.slice(0, 6)) {
        out.push({
          key: `idx-${i.code}`,
          label: i.code === "VNINDEX" ? "VN-Index" : i.code,
          href: "/stocks",
          price: i.value,
          chg: i.changePercent,
          digits: 2,
        });
      }
    }
    if (data?.crypto) {
      for (const c of data.crypto.top.slice(0, 12)) {
        out.push({
          key: `c-${c.symbol}`,
          label: c.baseAsset,
          href: `/crypto/${c.symbol}`,
          price: c.price,
          chg: c.changePercent,
          digits: c.price >= 100 ? 2 : c.price >= 1 ? 3 : 6,
        });
      }
    }
    if (data?.forex) {
      for (const f of data.forex.rows.filter((r) => r.group === "major").slice(0, 4)) {
        out.push({
          key: `f-${f.pair}`,
          label: f.symbol,
          href: `/forex/${f.pair}`,
          price: f.price,
          chg: f.changePercent,
          digits: f.price >= 100 ? 2 : 4,
        });
      }
    }
    if (data?.commodities) {
      for (const c of data.commodities.filter((x) => ["XAUUSD", "CL"].includes(x.symbol))) {
        out.push({
          key: `cm-${c.symbol}`,
          label: c.symbol === "XAUUSD" ? "GOLD" : c.symbol,
          href: "/commodities",
          price: c.price,
          chg: c.changePercent,
          digits: 2,
        });
      }
    }
    return out;
  }, [data]);

  if (!items.length) {
    return (
      <div className="flex h-8 items-center border-t border-line bg-canvas-2 px-4 text-[11px] text-ink-3">
        <span className="size-1.5 animate-pulse rounded-full bg-accent/60" />
        <span className="ml-2">Đang kết nối luồng dữ liệu thị trường…</span>
      </div>
    );
  }

  // Duplicate track for seamless infinite scroll — item keys are stable, avoids recreating DOM on each poll
  const doubled = useMemo(() => [...items, ...items], [items]);
  return (
    <div className="relative h-8 overflow-hidden border-t border-line bg-canvas-2" style={{ contain: "layout paint" }}>
      <div className="ticker-track flex h-8 items-center will-change-transform" style={{ transform: "translateZ(0)" }}>
        {doubled.map((it, i) => (
          <TickerItem key={`${it.key}-${i}`} it={it} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-canvas-2 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-canvas-2 to-transparent" />
    </div>
  );
}

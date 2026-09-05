"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import type { MarketSnapshot } from "@/lib/services/market";

/** Realtime ticker — crypto (Binance live) + FX majors, CSS marquee. */
export function TickerTape() {
  const { data } = useApi<MarketSnapshot>("/api/v1/market/snapshot", { refreshInterval: 20_000 });
  const items: { key: string; label: string; href: string; price: number; chg: number | null; digits: number }[] = [];

  if (data?.indices) {
    for (const i of data.indices.slice(0, 4)) {
      items.push({ key: `idx-${i.code}`, label: i.code, href: "/stocks", price: i.value, chg: i.changePercent, digits: 2 });
    }
  }
  if (data?.crypto) {
    for (const c of data.crypto.top.slice(0, 14)) {
      items.push({ key: `c-${c.symbol}`, label: c.baseAsset, href: `/crypto/${c.symbol}`, price: c.price, chg: c.changePercent, digits: c.price >= 100 ? 2 : c.price >= 1 ? 3 : 6 });
    }
  }
  if (data?.forex) {
    for (const f of data.forex.rows.filter((r) => r.group === "major").slice(0, 5)) {
      items.push({ key: `f-${f.pair}`, label: f.symbol, href: `/forex/${f.pair}`, price: f.price, chg: f.changePercent, digits: f.price >= 100 ? 2 : 4 });
    }
  }
  if (data?.commodities) {
    for (const c of data.commodities.filter((x) => ["XAUUSD", "CL"].includes(x.symbol))) {
      items.push({ key: `cm-${c.symbol}`, label: c.symbol === "XAUUSD" ? "GOLD" : c.symbol, href: "/commodities", price: c.price, chg: c.changePercent, digits: 2 });
    }
  }

  if (!items.length) {
    return (
      <div className="flex h-8 items-center border-t border-line bg-canvas-2 px-4 text-[11px] text-ink-3">
        <span className="size-1.5 animate-pulse rounded-full bg-accent/60" />
        <span className="ml-2">Đang kết nối luồng dữ liệu thị trường…</span>
      </div>
    );
  }

  const doubled = [...items, ...items];
  return (
    <div className="relative h-8 overflow-hidden border-t border-line bg-canvas-2">
      <div className="ticker-track h-8 items-center">
        {doubled.map((it, i) => (
          <Link
            key={`${it.key}-${i}`}
            href={it.href}
            className="num mx-4 flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2 hover:text-ink"
          >
            <span className="font-medium text-ink">{it.label}</span>
            <span>{it.price.toLocaleString("en-US", { minimumFractionDigits: it.digits, maximumFractionDigits: it.digits })}</span>
            {it.chg != null && Number.isFinite(it.chg) && (
              <span className={it.chg >= 0 ? "text-up" : "text-down"}>
                {it.chg >= 0 ? "▲" : "▼"} {Math.abs(it.chg).toFixed(2)}%
              </span>
            )}
          </Link>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-canvas-2 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-canvas-2 to-transparent" />
    </div>
  );
}

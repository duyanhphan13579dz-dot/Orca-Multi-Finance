"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/hooks";
import type { PriceAlert } from "@/lib/alerts-store";

export function useAlertLiveQuotes(alerts: PriceAlert[]) {
  const liveSymbols = useMemo(() => {
    const s = new Set(alerts.filter((a) => a.status === "active").map((a) => a.symbol));
    try {
      const trades = JSON.parse(localStorage.getItem("orca.journal.v1") ?? "[]") as {
        assetType?: string;
        symbol: string;
        exit: number | null;
      }[];
      for (const t of trades) {
        if ((t.assetType ?? "stock") === "stock" && t.exit == null && t.symbol) {
          s.add(String(t.symbol).toUpperCase());
        }
      }
    } catch {
      /* */
    }
    return [...s].slice(0, 30);
  }, [alerts]);

  const qs = liveSymbols.length ? liveSymbols.join(",") : null;
  const { data } = useApi<{
    quotes?: {
      symbol: string;
      price: number;
      changePercent?: number | null;
      ceilingPrice?: number | null;
      floorPrice?: number | null;
    }[];
  }>(qs ? `/api/v1/stocks?symbols=${encodeURIComponent(qs)}` : null, { refreshInterval: 8_000 });

  const liveMap = useMemo(() => {
    const m = new Map<
      string,
      { price: number; changePercent: number | null; ceiling: number | null; floor: number | null }
    >();
    for (const q of data?.quotes ?? []) {
      if (!q?.symbol || !Number.isFinite(q.price)) continue;
      m.set(q.symbol.toUpperCase(), {
        price: q.price,
        changePercent: q.changePercent ?? null,
        ceiling: q.ceilingPrice ?? null,
        floor: q.floorPrice ?? null,
      });
    }
    return m;
  }, [data]);

  return { liveSymbols, liveMap };
}

export function AlertLiveQuotesBar({
  symbols,
  liveMap,
}: {
  symbols: string[];
  liveMap: Map<
    string,
    { price: number; changePercent: number | null; ceiling: number | null; floor: number | null }
  >;
}) {
  if (!symbols.length) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated/30 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
        Gia live (VN) · canh bao + vi the mo
      </div>
      <div className="flex flex-wrap gap-1.5">
        {symbols.map((sym) => {
          const q = liveMap.get(sym);
          return (
            <a
              key={sym}
              href={"/stocks/" + encodeURIComponent(sym)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-[11px] hover:border-accent-primary/40"
            >
              <span className="font-semibold">{sym}</span>
              {q ? (
                <>
                  <span className="num">{q.price.toLocaleString("vi-VN")}</span>
                  {q.changePercent != null ? (
                    <span className={q.changePercent >= 0 ? "text-positive" : "text-negative"}>
                      {q.changePercent >= 0 ? "+" : ""}
                      {q.changePercent.toFixed(2)}%
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-text-muted">…</span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

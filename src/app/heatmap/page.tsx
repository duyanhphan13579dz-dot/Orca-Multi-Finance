"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow } from "@/lib/types";
import { FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Grid2x2 } from "lucide-react";

type MarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

/** Squarified-ish treemap: rows laid out into bands by accumulated weight. */
export default function HeatmapPage() {
  const { data, meta, isLoading } = useApi<MarketsData>("/api/v1/crypto/markets?limit=48", { refreshInterval: 30_000 });
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      try {
        setWidth(el.clientWidth);
      } catch {}
    };
    update();
    let ro: ResizeObserver | null = null;
    let onWin: (() => void) | null = null;
    try {
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(update);
        ro.observe(el);
      } else if (typeof window !== "undefined") {
        onWin = update;
        window.addEventListener("resize", onWin);
      }
    } catch {
      try {
        if (typeof window !== "undefined" && !ro) {
          onWin = update;
          window.addEventListener("resize", onWin);
        }
      } catch {}
    }
    return () => {
      try {
        ro?.disconnect();
      } catch {}
      try {
        if (onWin) window.removeEventListener("resize", onWin);
      } catch {}
    };
  }, []);

  if (isLoading && !data) return <Loading rows={8} />;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Grid2x2 className="size-5 text-accent" /> Market Heatmap — Crypto USDT
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
          </h1>
          <span className="text-[12px] text-ink-3">Diện tích ∝ khối lượng 24h · Màu = biến động 24h · Dữ liệu Binance realtime</span>
          <div className="ml-auto"><MetaLine meta={meta} /></div>
        </div>
      </Panel>

      {!data ? (
        <Unavailable title="Binance không khả dụng" meta={meta} />
      ) : (
        <div ref={containerRef} className="panel overflow-hidden p-1.5">
          <Treemap rows={data.rows} width={width} height={width < 640 ? 420 : 620} onSelect={(s) => router.push(`/crypto/${s}`)} />
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-ink-3">
        <span>Thang màu:</span>
        <div className="h-2.5 w-56 rounded-sm" style={{ background: "linear-gradient(90deg,#8b2c3d,#f6465d,#3d4453,#0ecb81,#087a52)" }} />
        <span className="num">-10% ← 0 → +10%</span>
      </div>

      <Panel title="Heatmap cổ phiếu Việt Nam">
        <Unavailable
          title="Cần kết nối VNStock"
          note="Khi VNSTOCK_API_KEY được cấu hình, heatmap HOSE/HNX/UPCOM theo ngành sẽ hiển thị tại đây với cùng cơ chế realtime qua provider abstraction."
        />
      </Panel>
    </div>
  );
}

function Treemap({ rows, width, height, onSelect }: { rows: CryptoMarketRow[]; width: number; height: number; onSelect: (s: string) => void }) {
  const items = rows.filter((r) => (r.quoteVolume ?? 0) > 0).slice(0, 48);
  const total = items.reduce((a, r) => a + (r.quoteVolume ?? 0), 0);
  if (!total) return null;

  // layout into horizontal bands
  const bands: { items: typeof items; h: number }[] = [];
  let i = 0;
  while (i < items.length) {
    const remaining = items.slice(i).reduce((a, r) => a + (r.quoteVolume ?? 0), 0);
    const targetH = remaining === 0 ? 0 : Math.max(2, Math.round(Math.sqrt(items[i].quoteVolume! / total) * 8));
    const bandItems: typeof items = [];
    let acc = 0;
    const bandWeight = (remaining / total) * Math.min(targetH / 10 + 0.35, 0.3);
    while (i < items.length && (acc < bandWeight * total || bandItems.length < 2)) {
      bandItems.push(items[i]);
      acc += items[i].quoteVolume ?? 0;
      i++;
      if (bandItems.length >= 12) break;
    }
    bands.push({ items: bandItems, h: (acc / total) * height });
  }
  const usedH = bands.reduce((a, b) => a + b.h, 0);
  const scaleY = usedH > 0 ? height / usedH : 1;

  return (
    <div style={{ height }} className="flex w-full flex-col gap-1">
      {bands.map((band, bi) => {
        const bandTotal = band.items.reduce((a, r) => a + (r.quoteVolume ?? 0), 0);
        return (
          <div key={bi} className="flex gap-1" style={{ height: band.h * scaleY }}>
            {band.items.map((r) => {
              const w = ((r.quoteVolume ?? 0) / bandTotal) * 100;
              const chg = r.changePercent ?? 0;
              return (
                <button
                  key={r.symbol}
                  onClick={() => onSelect(r.symbol)}
                  className="heat-tile relative flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-[5px] border border-black/30"
                  style={{ width: `${w}%`, background: tileColor(chg) }}
                  title={`${r.symbol}: ${chg.toFixed(2)}% · Vol $${(r.quoteVolume ?? 0).toExponential(2)}`}
                >
                  <span className="truncate px-1 text-[12px] font-bold text-white drop-shadow">{r.baseAsset}</span>
                  {w > 5 && band.h * scaleY > 42 && (
                    <span className="num text-[11px] text-white/90 drop-shadow">{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function tileColor(chg: number): string {
  const c = Math.max(-10, Math.min(10, chg));
  if (c >= 0) {
    const t = c / 10;
    return `rgb(${Math.round(16 - t * 9)}, ${Math.round(120 + t * 90)}, ${Math.round(75 + t * 20)})`;
  }
  const t = -c / 10;
  return `rgb(${Math.round(120 + t * 130)}, ${Math.round(45 - t * 18)}, ${Math.round(62 + t * 10)})`;
}

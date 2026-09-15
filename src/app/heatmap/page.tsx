"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow, Quote } from "@/lib/types";
import { FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Grid2x2 } from "lucide-react";

type TabId = "vn" | "crypto";

type CryptoMarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };
type VnBoardData = {
  quotes: Quote[];
  indices?: { symbol: string; price?: number; changePercent?: number | null }[];
  universeSize?: number;
  count?: number;
};

type HeatRow = {
  symbol: string;
  label: string;
  changePercent: number;
  weight: number;
  href: string;
  titleExtra?: string;
};

const TAB_LABEL: Record<TabId, string> = {
  vn: "Chứng khoán Việt Nam",
  crypto: "Crypto (USDT)",
};

export default function HeatmapPage() {
  const [tab, setTab] = useState<TabId>("vn");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  const vnAlways = useApi<VnBoardData>("/api/v1/stocks?board=full", { refreshInterval: 25_000 });
  const crypto = useApi<CryptoMarketsData>("/api/v1/crypto/markets?limit=48", {
    refreshInterval: 30_000,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [tab]);

  const vnRows: HeatRow[] = useMemo(() => {
    const quotes = (vnAlways.data?.quotes ?? []).filter((q) => q.price > 0);
    const mapped = quotes.map((q) => {
      const vol = q.volume ?? 0;
      const weight = Math.max(vol * (q.price || 1), 1);
      return {
        symbol: q.symbol,
        label: q.symbol,
        changePercent: q.changePercent ?? 0,
        weight,
        href: `/stocks/${encodeURIComponent(q.symbol)}`,
        titleExtra: vol > 0 ? `KL ${formatVol(vol)}` : undefined,
      } satisfies HeatRow;
    });
    mapped.sort((a, b) => b.weight - a.weight);
    return mapped.slice(0, 100);
  }, [vnAlways.data]);

  const cryptoRows: HeatRow[] = useMemo(() => {
    const rows = crypto.data?.rows ?? [];
    return rows
      .map((r) => ({
        symbol: r.symbol,
        label: r.baseAsset || r.symbol.replace(/USDT$/i, ""),
        changePercent: r.changePercent ?? 0,
        weight: Math.max(r.quoteVolume ?? 0, 1),
        href: `/crypto/${encodeURIComponent(r.symbol)}`,
        titleExtra:
          r.quoteVolume != null ? `Vol $${r.quoteVolume.toExponential(2)}` : undefined,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [crypto.data]);

  const activeRows = tab === "vn" ? vnRows : cryptoRows;
  const activeMeta = tab === "vn" ? vnAlways.meta : crypto.meta;
  const isLoading =
    tab === "vn"
      ? vnAlways.isLoading && !vnAlways.data
      : crypto.isLoading && !crypto.data;
  const colorScale = tab === "vn" ? 7 : 10;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Grid2x2 className="size-5 text-accent" /> Bản đồ nhiệt thị trường
            <FreshnessDot status={activeMeta?.freshness} ageMs={activeMeta?.ageMs} />
          </h1>
          <div className="ml-auto">
            <MetaLine meta={activeMeta} />
          </div>
        </div>

        <div className="flex gap-1 border-t border-border-subtle px-3 pb-3 pt-1">
          {(["vn", "crypto"] as TabId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
                tab === id
                  ? "bg-accent-primary/15 text-accent-primary ring-1 ring-accent-primary/40"
                  : "text-text-muted hover:bg-surface-elevated hover:text-text-primary"
              }`}
            >
              {TAB_LABEL[id]}
              {id === "vn" && vnAlways.data?.count != null && (
                <span className="ml-1.5 num text-[10px] opacity-70">
                  {Math.min(100, vnAlways.data.count)}
                </span>
              )}
              {id === "crypto" && crypto.data?.rows && (
                <span className="ml-1.5 num text-[10px] opacity-70">{crypto.data.rows.length}</span>
              )}
            </button>
          ))}
        </div>
      </Panel>

      <p className="px-1 text-[12px] text-text-muted">
        {tab === "vn"
          ? "Diện tích ∝ giá trị giao dịch (KL × giá) · Màu = % thay đổi phiên · Nguồn VNDirect / SSI"
          : "Diện tích ∝ khối lượng 24h · Màu = biến động 24h · Nguồn Binance realtime"}
      </p>

      {isLoading ? (
        <Loading rows={8} />
      ) : activeRows.length === 0 ? (
        <Unavailable
          title={tab === "vn" ? "Chưa có bảng giá chứng khoán VN" : "Binance không khả dụng"}
          note={
            tab === "vn"
              ? "Kiểm tra kết nối VNDirect/SSI hoặc /api/v1/stocks?board=full."
              : "Kiểm tra /api/v1/crypto/markets."
          }
          meta={activeMeta}
        />
      ) : (
        <div ref={containerRef} className="panel overflow-hidden p-1.5">
          <Treemap
            rows={activeRows}
            width={width}
            height={620}
            colorScale={colorScale}
            onSelect={(href) => router.push(href)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
        <span>Thang màu:</span>
        <div
          className="h-2.5 w-56 rounded-sm"
          style={{
            background: "linear-gradient(90deg,#8b2c3d,#f6465d,#3d4453,#0ecb81,#087a52)",
          }}
        />
        <span className="num">
          −{colorScale}% ← 0 → +{colorScale}%
        </span>
        {tab === "vn" && (
          <span className="text-text-muted">· Top {activeRows.length} mã thanh khoản cao</span>
        )}
      </div>
    </div>
  );
}

function formatVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function Treemap({
  rows,
  width,
  height,
  colorScale,
  onSelect,
}: {
  rows: HeatRow[];
  width: number;
  height: number;
  colorScale: number;
  onSelect: (href: string) => void;
}) {
  void width;
  const items = rows.filter((r) => r.weight > 0);
  const total = items.reduce((a, r) => a + r.weight, 0) || 1;

  type Band = { items: HeatRow[]; h: number };
  const bands: Band[] = [];
  let i = 0;
  while (i < items.length) {
    const remaining = items.slice(i).reduce((a, r) => a + r.weight, 0);
    const targetH =
      remaining === 0 ? 0 : Math.max(2, Math.round(Math.sqrt(items[i].weight / total) * 8));
    const bandItems: HeatRow[] = [];
    let acc = 0;
    const bandWeight = (remaining / total) * Math.min(targetH / 10 + 0.35, 0.3);
    while (i < items.length && (acc < bandWeight * total || bandItems.length < 2)) {
      bandItems.push(items[i]);
      acc += items[i].weight;
      i++;
      if (bandItems.length >= 14) break;
    }
    bands.push({ items: bandItems, h: (acc / total) * height });
  }
  const usedH = bands.reduce((a, b) => a + b.h, 0);
  const scaleY = usedH > 0 ? height / usedH : 1;

  return (
    <div style={{ height }} className="flex w-full flex-col gap-1">
      {bands.map((band, bi) => {
        const bandTotal = band.items.reduce((a, r) => a + r.weight, 0) || 1;
        return (
          <div key={bi} className="flex gap-1" style={{ height: band.h * scaleY }}>
            {band.items.map((r) => {
              const w = (r.weight / bandTotal) * 100;
              const chg = r.changePercent;
              return (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => onSelect(r.href)}
                  className="heat-tile relative flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-[5px] border border-black/30"
                  style={{ width: `${w}%`, background: tileColor(chg, colorScale) }}
                  title={`${r.symbol}: ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%${r.titleExtra ? ` · ${r.titleExtra}` : ""}`}
                >
                  <span className="truncate px-1 text-[12px] font-bold text-white drop-shadow">
                    {r.label}
                  </span>
                  {w > 4.5 && band.h * scaleY > 36 && (
                    <span className="num text-[11px] text-white/90 drop-shadow">
                      {chg >= 0 ? "+" : ""}
                      {chg.toFixed(1)}%
                    </span>
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

function tileColor(chg: number, scale: number): string {
  const c = Math.max(-scale, Math.min(scale, chg));
  if (c >= 0) {
    const t = c / scale;
    return `rgb(${Math.round(16 - t * 9)}, ${Math.round(120 + t * 90)}, ${Math.round(75 + t * 20)})`;
  }
  const t = -c / scale;
  return `rgb(${Math.round(120 + t * 130)}, ${Math.round(45 - t * 18)}, ${Math.round(62 + t * 10)})`;
}

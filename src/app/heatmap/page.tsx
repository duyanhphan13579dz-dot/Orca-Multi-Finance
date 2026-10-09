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
  const [width, setWidth] = useState(390);
  const [mapHeight, setMapHeight] = useState(640);

  const vnApi = useApi<VnBoardData>("/api/v1/stocks?board=full", { refreshInterval: 20_000 });
  const cryptoApi = useApi<CryptoMarketsData>("/api/v1/crypto/markets?limit=60", {
    refreshInterval: 30_000,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth || 390;
      setWidth(w);
      // mobile-first tall map like reference screenshot
      const h = Math.max(560, Math.min(820, Math.round(w * 1.55)));
      setMapHeight(h);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const vnRows: HeatRow[] = useMemo(() => {
    const quotes = (vnApi.data?.quotes ?? []).filter(
      (q) => q.symbol && Number.isFinite(q.price) && q.price > 0,
    );
    const mapped = quotes.map((q) => {
      const vol = Math.max(0, q.volume ?? 0);
      // Giá trị giao dịch ước lượng; nếu KL = 0 vẫn giữ ô tối thiểu theo |%|
      const turnover = vol * q.price;
      const weight = Math.max(turnover, Math.abs(q.changePercent ?? 0) * 1e6 + 1e3);
      return {
        symbol: q.symbol,
        label: q.symbol,
        changePercent: q.changePercent ?? 0,
        weight,
        href: `/stocks/${encodeURIComponent(q.symbol)}`,
        titleExtra:
          vol > 0
            ? `KL ${formatVol(vol)} · ${q.price.toLocaleString("vi-VN")}`
            : q.price.toLocaleString("vi-VN"),
      } satisfies HeatRow;
    });
    mapped.sort((a, b) => b.weight - a.weight);
    return mapped.slice(0, 80);
  }, [vnApi.data]);

  const cryptoRows: HeatRow[] = useMemo(() => {
    const rows = cryptoApi.data?.rows ?? [];
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
  }, [cryptoApi.data]);

  const activeRows = tab === "vn" ? vnRows : cryptoRows;
  const activeMeta = tab === "vn" ? vnApi.meta : cryptoApi.meta;
  const isLoading =
    tab === "vn" ? vnApi.isLoading && !vnApi.data : cryptoApi.isLoading && !cryptoApi.data;
  /** Thang màu: VN phiên ±7%, crypto 24h ±10% */
  const colorScale = tab === "vn" ? 7 : 10;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Grid2x2 className="size-5 text-accent" />
            Bản đồ nhiệt
            <FreshnessDot status={activeMeta?.freshness} ageMs={activeMeta?.ageMs} />
          </h1>
          <div className="ml-auto">
            <MetaLine meta={activeMeta} />
          </div>
        </div>

        <div className="flex gap-1.5 px-3 pb-3">
          {(["vn", "crypto"] as TabId[]).map((id) => {
            const count =
              id === "vn"
                ? vnRows.length || vnApi.data?.count
                : cryptoRows.length || cryptoApi.data?.rows?.length;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition ${
                  tab === id
                    ? "bg-white/10 text-white ring-1 ring-white/20"
                    : "text-text-muted hover:bg-white/5 hover:text-text-primary"
                }`}
              >
                {TAB_LABEL[id]}
                {count != null && count > 0 && (
                  <span className="ml-1.5 num text-[10px] font-normal opacity-60">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </Panel>

      <p className="px-1 text-[11.5px] leading-snug text-text-muted">
        {tab === "vn"
          ? "Ô lớn = thanh khoản cao (KL × giá) · Màu = % phiên · Chạm để mở mã · VNDirect/SSI"
          : "Ô lớn = volume 24h · Màu = % 24h · Binance realtime"}
      </p>

      {isLoading ? (
        <Loading rows={10} />
      ) : activeRows.length === 0 ? (
        <Unavailable
          title={tab === "vn" ? "Chưa có bảng giá chứng khoán VN" : "Binance không khả dụng"}
          note={
            tab === "vn"
              ? "Kiểm tra VNDirect/SSI hoặc /api/v1/stocks?board=full."
              : "Kiểm tra /api/v1/crypto/markets."
          }
          meta={activeMeta}
        />
      ) : (
        <div
          ref={containerRef}
          className="overflow-hidden rounded-xl border border-white/5 bg-[#0b0f17] p-1"
        >
          <MarketTreemap
            rows={activeRows}
            width={width}
            height={mapHeight}
            colorScale={colorScale}
            onSelect={(href) => router.push(href)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 px-1 text-[11px] text-text-muted">
        <span>Thang màu:</span>
        <div
          className="h-2.5 w-48 rounded-full sm:w-56"
          style={{
            background:
              "linear-gradient(90deg,#8b1a2b 0%,#c23b4e 35%,#3d4453 50%,#0ecb81 65%,#087a52 100%)",
          }}
        />
        <span className="num">
          −{colorScale}% ← 0 → +{colorScale}%
        </span>
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

/**
 * Layout dạng market-map (gần squarified): dải ngang theo trọng số,
 * ô lớn cho mã thanh khoản cao — giống heatmap crypto trong ảnh.
 */
function MarketTreemap({
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
    const frac = remaining / total;
    // Ô đầu mỗi dải chiếm diện tích lớn hơn (BTC/ETH style)
    const targetFrac = Math.min(0.28, Math.max(0.08, Math.sqrt(frac) * 0.42));
    const bandItems: HeatRow[] = [];
    let acc = 0;
    while (i < items.length) {
      bandItems.push(items[i]);
      acc += items[i].weight;
      i++;
      if (acc >= targetFrac * total && bandItems.length >= 2) break;
      if (bandItems.length >= (width < 480 ? 6 : 10)) break;
      if (i < items.length && items[i].weight / total > 0.12 && bandItems.length >= 1) break;
    }
    bands.push({ items: bandItems, h: Math.max(28, (acc / total) * height) });
  }

  const usedH = bands.reduce((a, b) => a + b.h, 0) || 1;
  const scaleY = height / usedH;
  const gap = 2;

  return (
    <div style={{ height }} className="flex w-full flex-col" >
      {bands.map((band, bi) => {
        const bandTotal = band.items.reduce((a, r) => a + r.weight, 0) || 1;
        const bandH = band.h * scaleY - (bi < bands.length - 1 ? gap : 0);
        return (
          <div
            key={bi}
            className="flex w-full"
            style={{ height: bandH, marginBottom: bi < bands.length - 1 ? gap : 0 }}
          >
            {band.items.map((r, ri) => {
              const wPct = (r.weight / bandTotal) * 100;
              const chg = r.changePercent;
              const showPct = wPct > 6 || bandH > 48;
              const showLabel = wPct > 3.5 || bandH > 36;
              return (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => onSelect(r.href)}
                  className="relative flex min-w-0 flex-col items-center justify-center overflow-hidden transition active:brightness-110"
                  style={{
                    width: `${wPct}%`,
                    height: "100%",
                    marginRight: ri < band.items.length - 1 ? gap : 0,
                    background: tileColor(chg, colorScale),
                    borderRadius: 6,
                  }}
                  title={`${r.symbol}: ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%${r.titleExtra ? ` · ${r.titleExtra}` : ""}`}
                >
                  {showLabel && (
                    <span
                      className={`truncate px-0.5 font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] ${
                        bandH > 70 && wPct > 12 ? "text-[15px]" : "text-[12px]"
                      }`}
                    >
                      {r.label}
                    </span>
                  )}
                  {showPct && (
                    <span className="num mt-0.5 text-[11px] font-medium text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
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

/** Màu ô giống market map: đỏ đậm ← trung tính → xanh */
function tileColor(chg: number, scale: number): string {
  const c = Math.max(-scale, Math.min(scale, chg));
  if (Math.abs(c) < 0.05) return "#4a3038"; // gần 0 — nâu đỏ trung tính như ảnh
  if (c > 0) {
    const t = c / scale;
    // #0a6b4a → #0ecb81
    const r = Math.round(8 + (14 - 8) * (1 - t));
    const g = Math.round(90 + (203 - 90) * t);
    const b = Math.round(60 + (129 - 60) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = -c / scale;
  // #6b2430 → #c23b4e (và đỏ sáng hơn khi cực đoan)
  const r = Math.round(100 + (220 - 100) * t);
  const g = Math.round(40 - 18 * t);
  const b = Math.round(52 + 10 * t);
  return `rgb(${r},${g},${b})`;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { AddToWatchlist } from "@/components/watchlist-button";
import { StockTabs } from "@/components/stocks/stock-tabs";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, Panel } from "@/components/ui";

export default function StockSymbolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ symbol: string }>;
}) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 30_000,
  });

  if (!symbol || (isLoading && !res)) {
    return (
      <div className="stock-workspace">
        <Loading rows={4} />
        {children}
      </div>
    );
  }

  const q = data?.quote;

  return (
    <div className="stock-workspace stock-page-body">
      <Panel pad={false} className="sticky top-0 z-20 overflow-visible shadow-sm shadow-black/20">
        <div className="stock-hero flex flex-col gap-3.5 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="min-w-0 flex-1">
            <div className="stock-hero-title-row">
              <h1 className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.35rem]">{symbol}</h1>
              {(data?.name || q?.name) ? (
                <span className="max-w-[14rem] truncate text-[12px] leading-snug text-text-muted sm:max-w-[22rem] sm:text-[13px]">
                  {data?.name || q?.name}
                </span>
              ) : null}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="stock" symbol={symbol} />
            </div>
            {q ? (
              <div className="stock-hero-price-row num">
                <span className="text-[1.65rem] font-semibold leading-none tracking-tight sm:text-[1.85rem]">
                  {fmtNum(q.price, 2)}
                </span>
                <Chg value={q.changePercent} className="text-[13px] sm:text-[14px]" />
                {q.change != null && (
                  <span className={`text-[12px] leading-none ${q.change >= 0 ? "text-up" : "text-down"}`}>
                    {q.change >= 0 ? "+" : ""}
                    {fmtNum(q.change, 2)}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                Giá phiên tạm chưa có — xem các tab bên dưới.
              </p>
            )}
          </div>

          <div className="stock-hero-stats shrink-0 md:max-w-[min(100%,42rem)]">
            <Stat label="Khối lượng" value={fmtCompact(q?.volume)} />
            <Stat label="Giá trị" value={fmtCompact(q?.quoteVolume)} />
            <Stat
              label="CP lưu hành"
              value={data?.sharesOutstanding != null ? fmtCompact(data.sharesOutstanding) : "—"}
            />
            <Stat
              label="NN ròng"
              value={
                data?.foreignFlow?.latest != null ? fmtCompact(data.foreignFlow.latest.netVal) : "—"
              }
              tone={
                data?.foreignFlow?.latest != null
                  ? data.foreignFlow.latest.netVal >= 0
                    ? "up"
                    : "down"
                  : undefined
              }
            />
            <Stat
              label="Cập nhật"
              value={
                q?.updatedAt
                  ? (() => {
                      try {
                        return new Date(q.updatedAt).toLocaleTimeString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                      } catch {
                        return String(q.updatedAt).slice(11, 16) || "—";
                      }
                    })()
                  : "—"
              }
            />
            <Stat
              label="TC"
              value={q?.referencePrice != null ? fmtNum(q.referencePrice, 2) : "—"}
              className="hidden lg:block"
            />
            <Stat
              label="Trần"
              value={q?.ceilingPrice != null ? fmtNum(q.ceilingPrice, 2) : "—"}
              className="hidden lg:block"
            />
            <Stat
              label="Sàn"
              value={q?.floorPrice != null ? fmtNum(q.floorPrice, 2) : "—"}
              className="hidden lg:block"
            />
          </div>
        </div>

        {(q?.referencePrice != null || q?.ceilingPrice != null || q?.floorPrice != null) && (
          <div className="stock-meta-strip lg:hidden" aria-label="Biên độ giá">
            {q?.referencePrice != null && (
              <span className="stock-meta-chip">
                <span className="stock-meta-chip-label">TC</span>
                <span className="num stock-meta-chip-value">{fmtNum(q.referencePrice, 2)}</span>
              </span>
            )}
            {q?.ceilingPrice != null && (
              <span className="stock-meta-chip">
                <span className="stock-meta-chip-label">Trần</span>
                <span className="num stock-meta-chip-value text-up">{fmtNum(q.ceilingPrice, 2)}</span>
              </span>
            )}
            {q?.floorPrice != null && (
              <span className="stock-meta-chip">
                <span className="stock-meta-chip-label">Sàn</span>
                <span className="num stock-meta-chip-value text-down">{fmtNum(q.floorPrice, 2)}</span>
              </span>
            )}
          </div>
        )}

        {data?.foreignFlow?.latest && (
          <div className="stock-meta-strip" aria-label="Dòng vốn nước ngoài">
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">NN mua</span>
              <span className="num stock-meta-chip-value text-up">
                {fmtCompact(data.foreignFlow.latest.buyVal)}
              </span>
            </span>
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">NN bán</span>
              <span className="num stock-meta-chip-value text-down">
                {fmtCompact(data.foreignFlow.latest.sellVal)}
              </span>
            </span>
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">Ròng</span>
              <span
                className={`num stock-meta-chip-value ${
                  data.foreignFlow.latest.netVal >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtCompact(data.foreignFlow.latest.netVal)}
              </span>
            </span>
            {data.foreignFlow.latest.currentRoom != null && (
              <span className="stock-meta-chip">
                <span className="stock-meta-chip-label">Room còn</span>
                <span className="num stock-meta-chip-value">
                  {fmtCompact(data.foreignFlow.latest.currentRoom)}
                </span>
              </span>
            )}
          </div>
        )}

        <StockTabs symbol={symbol} />
      </Panel>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  className = "",
  tone,
}: {
  label: string;
  value: string;
  className?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className={`stock-stat ${className}`.trim()}>
      <div className="stock-stat-label">{label}</div>
      <div
        className={`stock-stat-value num ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

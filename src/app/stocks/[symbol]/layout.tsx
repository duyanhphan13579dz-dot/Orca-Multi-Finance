"use client";

import { useEffect, useState, type ReactNode } from "react";
import { prefetchApi, useApi } from "@/lib/hooks";
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

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(
    symbol ? `/api/v1/stocks/${symbol}` : null,
    {
      refreshInterval: 20_000,
    },
  );

  useEffect(() => {
    if (!symbol) return;
    const paths = [
      `/api/v1/stocks/${symbol}/technical`,
      `/api/v1/stocks/${symbol}/valuation`,
      `/api/v1/stocks/${symbol}/financials`,
      `/api/v1/stocks/${symbol}/structure`,
      `/api/v1/stocks/${symbol}/tech-reco`,
      `/api/v1/stocks/${symbol}/style-fit`,
    ];
    const run = () => {
      const priority = [
        `/api/v1/stocks/${symbol}/style-fit`,
        `/api/v1/stocks/${symbol}/structure`,
        `/api/v1/stocks/${symbol}/tech-reco`,
      ];
      for (const url of priority) prefetchApi(url);
      for (const url of paths) {
        if (priority.includes(url)) continue;
        prefetchApi(url);
      }
    };
    if (typeof requestIdleCallback !== "undefined") requestIdleCallback(run, { timeout: 800 });
    else setTimeout(run, 120);
    for (const url of [
      `/api/v1/stocks/${symbol}/style-fit`,
      `/api/v1/stocks/${symbol}/structure`,
    ]) {
      prefetchApi(url);
    }
  }, [symbol]);

  if (!symbol || (isLoading && !res)) {
    return (
      <div className="stock-workspace">
        <Loading rows={4} />
        {children}
      </div>
    );
  }

  const q = data?.quote;
  const ff = data?.foreignFlow?.latest as
    | { buyVal?: number; sellVal?: number; netVal?: number; currentRoom?: number }
    | undefined;
  const hasForeign =
    ff != null &&
    [ff.buyVal, ff.sellVal, ff.netVal].some((v) => v != null && Number(v) !== 0);

  return (
    <div className="stock-workspace stock-page-body">
      <Panel pad={false} className="stock-hero-panel sticky top-0 z-20 overflow-visible">
        <div className="stock-hero">
          <div className="stock-hero-main">
            <div className="stock-hero-title-row">
              <h1 className="stock-hero-symbol">{symbol}</h1>
              {(data?.name || q?.name) ? (
                <span className="stock-hero-name">{data?.name || q?.name}</span>
              ) : null}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="stock" symbol={symbol} />
            </div>

            {q ? (
              <div className="stock-hero-price-row num">
                <span className="stock-hero-price">{fmtNum(q.price, 2)}</span>
                <Chg value={q.changePercent} className="text-[13px] sm:text-[14px]" />
                {q.change != null && (
                  <span
                    className={`text-[12px] leading-none ${
                      q.change >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {q.change >= 0 ? "+" : ""}
                    {fmtNum(q.change, 2)}
                  </span>
                )}
                {(q.referencePrice != null ||
                  q.ceilingPrice != null ||
                  q.floorPrice != null) && (
                  <span className="stock-band-group" aria-label="Biên độ giá">
                    {q.referencePrice != null && (
                      <span className="stock-band-chip">
                        <span className="stock-band-label">TC</span>
                        <span className="num">{fmtNum(q.referencePrice, 2)}</span>
                      </span>
                    )}
                    {q.ceilingPrice != null && (
                      <span className="stock-band-chip stock-band-ceil">
                        <span className="stock-band-label">Trần</span>
                        <span className="num">{fmtNum(q.ceilingPrice, 2)}</span>
                      </span>
                    )}
                    {q.floorPrice != null && (
                      <span className="stock-band-chip stock-band-floor">
                        <span className="stock-band-label">Sàn</span>
                        <span className="num">{fmtNum(q.floorPrice, 2)}</span>
                      </span>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                Giá phiên tạm chưa có — xem các tab bên dưới.
              </p>
            )}
          </div>

          <div className="stock-hero-stats">
            <Stat label="Khối lượng" value={fmtCompact(q?.volume)} />
            <Stat label="Giá trị" value={fmtCompact(q?.quoteVolume)} />
            <Stat
              label="CP lưu hành"
              value={
                data?.sharesOutstanding != null ? fmtCompact(data.sharesOutstanding) : "—"
              }
            />
            <Stat
              label="NN ròng"
              value={ff?.netVal != null ? fmtCompact(ff.netVal) : "—"}
              tone={
                ff?.netVal != null ? (ff.netVal >= 0 ? "up" : "down") : undefined
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
          </div>
        </div>

        {hasForeign && ff ? (
          <div className="stock-meta-strip" aria-label="Dòng vốn nước ngoài">
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">NN mua</span>
              <span className="num stock-meta-chip-value text-up">
                {fmtCompact(ff.buyVal)}
              </span>
            </span>
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">NN bán</span>
              <span className="num stock-meta-chip-value text-down">
                {fmtCompact(ff.sellVal)}
              </span>
            </span>
            <span className="stock-meta-chip">
              <span className="stock-meta-chip-label">Ròng</span>
              <span
                className={`num stock-meta-chip-value ${
                  (ff.netVal ?? 0) >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtCompact(ff.netVal)}
              </span>
            </span>
            {ff.currentRoom != null && Number(ff.currentRoom) !== 0 && (
              <span className="stock-meta-chip">
                <span className="stock-meta-chip-label">Room còn</span>
                <span className="num stock-meta-chip-value">{fmtCompact(ff.currentRoom)}</span>
              </span>
            )}
          </div>
        ) : null}

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

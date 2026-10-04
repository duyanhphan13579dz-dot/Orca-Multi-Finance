"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(
    symbol ? `/api/v1/stocks/${symbol}` : null,
    {
      refreshInterval: 12_000,
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

  // Collapse the sticky hero to a slim bar once it pins to the top.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => setStuck(!entries[0]?.isIntersecting),
      { rootMargin: "-1px 0px 0px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  if (!symbol || (isLoading && !res)) {
    // Single brand loader — do not render children (page has its own Loading)
    return (
      <div className="stock-workspace stock-page-body">
        <Loading rows={6} full label="Đang tải dữ liệu cổ phiếu" />
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
  const floor = data?.profile?.floor ?? null;

  return (
    <div className="stock-workspace stock-page-body">
      <div ref={sentinelRef} aria-hidden="true" className="stock-sticky-sentinel" />
      <div className="stock-sticky-head" data-stuck={stuck ? "true" : "false"}>
        <Panel pad={false} className="stock-hero-panel overflow-visible">
          <div className="stock-hero">
            <div className="stock-hero-main">
              <div className="stock-hero-title-row">
                <h1 className="stock-hero-symbol">{symbol}</h1>
                {floor ? <span className="stock-floor-badge">{floor}</span> : null}
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
                    <div className="stock-band-grid" aria-label="Biên độ giá">
                      {q.referencePrice != null && (
                        <div className="stock-band-cell stock-band-cell--tc">
                          <span className="stock-band-label">TC</span>
                          <span className="stock-band-val num">{fmtNum(q.referencePrice, 2)}</span>
                        </div>
                      )}
                      {q.ceilingPrice != null && (
                        <div className="stock-band-cell stock-band-cell--ceil">
                          <span className="stock-band-label">Trần</span>
                          <span className="stock-band-val num">{fmtNum(q.ceilingPrice, 2)}</span>
                        </div>
                      )}
                      {q.floorPrice != null && (
                        <div className="stock-band-cell stock-band-cell--floor">
                          <span className="stock-band-label">Sàn</span>
                          <span className="stock-band-val num">{fmtNum(q.floorPrice, 2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="stock-hero-empty mt-2">
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
      </div>
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

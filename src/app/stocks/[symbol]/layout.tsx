"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { AddToWatchlist } from "@/components/watchlist-button";
import { StockTabs } from "@/components/stocks/stock-tabs";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel } from "@/components/ui";

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
      <div className="space-y-3">
        <Loading rows={4} />
        {children}
      </div>
    );
  }

  const q = data?.quote;

  return (
    <div className="stock-workspace stock-page-body">
      <Panel pad={false} className="sticky top-0 z-20 overflow-visible shadow-sm shadow-black/20">
        <div className="stock-hero flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{symbol}</h1>
              {(data?.name || q?.name) ? (
                <span className="max-w-[12rem] truncate text-[11px] text-text-muted sm:max-w-[18rem] sm:text-[12px]">
                  {data?.name || q?.name}
                </span>
              ) : null}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="stock" symbol={symbol} />
            </div>
            {q ? (
              <div className="num mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[26px] font-semibold leading-none sm:text-[28px]">{fmtNum(q.price, 2)}</span>
                <Chg value={q.changePercent} className="text-[13px] sm:text-[14px]" />
                {q.change != null && (
                  <span className={`text-[12px] ${q.change >= 0 ? "text-up" : "text-down"}`}>
                    {q.change >= 0 ? "+" : ""}
                    {fmtNum(q.change, 2)}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-text-muted">Giá phiên tạm chưa có — xem các tab bên dưới.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-right sm:gap-3 md:grid-cols-4 lg:grid-cols-8">
            <Stat label="Khối lượng" value={fmtCompact(q?.volume)} />
            <Stat label="Giá trị" value={fmtCompact(q?.quoteVolume)} />
            <Stat
              label="CP lưu hành"
              value={data?.sharesOutstanding != null ? fmtCompact(data.sharesOutstanding) : "—"}
            />
            <Stat
              label="NN ròng"
              value={
                data?.foreignFlow?.latest != null
                  ? fmtCompact(data.foreignFlow.latest.netVal)
                  : "—"
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
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle px-3 py-1.5 text-[11px] text-text-muted lg:hidden">
            {q?.referencePrice != null && (
              <span>
                TC <span className="num text-text-secondary">{fmtNum(q.referencePrice, 2)}</span>
              </span>
            )}
            {q?.ceilingPrice != null && (
              <span>
                Trần <span className="num text-text-secondary">{fmtNum(q.ceilingPrice, 2)}</span>
              </span>
            )}
            {q?.floorPrice != null && (
              <span>
                Sàn <span className="num text-text-secondary">{fmtNum(q.floorPrice, 2)}</span>
              </span>
            )}
          </div>
        )}

        {data?.foreignFlow?.latest && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle px-3 py-1.5 text-[11px] text-text-muted">
            <span>
              NN mua <span className="num text-up">{fmtCompact(data.foreignFlow.latest.buyVal)}</span>
            </span>
            <span>
              NN bán <span className="num text-down">{fmtCompact(data.foreignFlow.latest.sellVal)}</span>
            </span>
            <span>
              Ròng{" "}
              <span
                className={`num ${
                  data.foreignFlow.latest.netVal >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtCompact(data.foreignFlow.latest.netVal)}
              </span>
            </span>
            {data.foreignFlow.latest.currentRoom != null && (
              <span>
                Room còn{" "}
                <span className="num text-text-secondary">
                  {fmtCompact(data.foreignFlow.latest.currentRoom)}
                </span>
              </span>
            )}
          </div>
        )}

        {meta && (
          <div className="hidden border-t border-border-subtle px-4 py-1.5 sm:block">
            <MetaLine meta={meta} />
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
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[9px] uppercase tracking-wide text-text-muted sm:text-[10px]">{label}</div>
      <div className="num text-[12px] text-text-primary sm:text-[13px]">{value}</div>
    </div>
  );
}

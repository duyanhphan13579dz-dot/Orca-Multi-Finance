"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { AddToWatchlist } from "@/components/watchlist-button";
import { StockTabs } from "@/components/stocks/stock-tabs";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel } from "@/components/ui";

export default function StockSymbolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{symbol}</h1>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="stock" symbol={symbol} />
            </div>
            {q ? (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[28px] font-semibold">{fmtNum(q.price, 2)}</span>
                <Chg value={q.changePercent} className="text-[14px]" />
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-ink-3">Giá phiên tạm chưa có — xem các tab bên dưới.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-right">
            <div>
              <div className="text-[10px] uppercase text-ink-3">Khối lượng</div>
              <div className="num text-[13px]">{fmtCompact(q?.volume)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Giá trị</div>
              <div className="num text-[13px]">{fmtCompact(q?.quoteVolume)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Cập nhật</div>
              <div className="num text-[13px]">
                {q?.updatedAt
                  ? new Date(q.updatedAt).toLocaleTimeString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </div>
            </div>
          </div>
        </div>
        {meta && (
          <div className="border-t border-line px-4 py-2">
            <MetaLine meta={meta} />
          </div>
        )}
        <StockTabs symbol={symbol} />
      </Panel>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Loading, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TradingViewChartWidget } from "@/components/tradingview-chart-widget";
import { TechnicalPanel } from "@/components/technical-panel";
import { TechRecoPanel } from "@/components/stocks/tech-reco-panel";
import { StockNewsSentiment } from "@/components/stocks/news-sentiment-chip";
import { ValuationPanel } from "@/components/stocks/valuation-panel";
import { StockStructurePanel } from "@/components/stocks/structure-panel";
import { OrderBookPanel } from "@/components/stocks/order-book-panel";

function useChartHeight() {
  const [h, setH] = useState(320);
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      if (w >= 1280) setH(420);
      else if (w >= 640) setH(380);
      else setH(300);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return h;
}

export default function StockOverviewPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  const chartH = useChartHeight();
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 30_000,
  });

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được tổng quan ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn thị trường đang gián đoạn."}
      />
    );
  }

  const q = data.quote;

  return (
    <div className="stock-workspace">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <div className="min-w-0">
          {q || data.bars.length > 0 ? (
            <OrcaChart
              symbol={data.symbol}
              assetType="stock"
              defaultTimeframe="1d"
              height={chartH}
              title={data.symbol}
              extraLevels={[
                ...(q?.ceilingPrice != null
                  ? [{ label: "Trần", price: q.ceilingPrice, color: "rgba(181,140,255,0.7)" }]
                  : []),
                ...(q?.referencePrice != null
                  ? [{ label: "Tham chiếu", price: q.referencePrice, color: "rgba(245,165,36,0.7)" }]
                  : []),
                ...(q?.floorPrice != null
                  ? [{ label: "Sàn", price: q.floorPrice, color: "rgba(56,189,248,0.7)" }]
                  : []),
              ]}
            />
          ) : (
            <Panel title="Biểu đồ">
              <p className="text-[12px] text-text-muted">Chưa có chuỗi giá để vẽ biểu đồ.</p>
            </Panel>
          )}
          <div className="mt-3">
            <TradingViewChartWidget code={data.symbol} title={`${data.symbol} — chart tham chiếu`} />
          </div>
        </div>
        <div className="min-w-0">
          <OrderBookPanel symbol={data.symbol} compact />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TechRecoPanel symbol={data.symbol} />
        <StockStructurePanel symbol={data.symbol} />
      </div>

      {data.technical ? <TechnicalPanel tech={data.technical} patterns={data.patterns} /> : null}

      <ValuationPanel symbol={data.symbol} compact showAnalyst={false} />

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Trạng thái cổ phiếu">
          {data.technical ? (
            <ul className="space-y-1.5 text-[12px] text-text-secondary">
              <li className="flex justify-between gap-2">
                <span className="text-text-muted">Xu hướng</span>
                <strong className="text-text-primary">
                  {String(
                    (data.technical.trend as { label?: string } | null)?.label ??
                      data.technical.trend ??
                      "—",
                  )}
                </strong>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-text-muted">RSI(14)</span>
                <span className="num">
                  {data.technical.rsi14 != null ? data.technical.rsi14.toFixed(1) : "—"}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-text-muted">Biến động 30d</span>
                <span className="num">
                  {data.technical.volatility30d != null
                    ? `${(data.technical.volatility30d * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </li>
            </ul>
          ) : (
            <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu kỹ thuật.</p>
          )}
        </Panel>

        <StockNewsSentiment symbol={data.symbol} />
      </div>
    </div>
  );
}

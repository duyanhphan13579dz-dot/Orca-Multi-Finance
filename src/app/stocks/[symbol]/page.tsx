"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Loading, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { StockNewsSentiment } from "@/components/stocks/news-sentiment-chip";
import { OrderBookPanel } from "@/components/stocks/order-book-panel";

const TechnicalPanel = dynamic(
  () => import("@/components/technical-panel").then((m) => m.TechnicalPanel),
  { ssr: false, loading: () => <Panel><Loading rows={3} /></Panel> },
);
const TechRecoPanel = dynamic(
  () => import("@/components/stocks/tech-reco-panel").then((m) => m.TechRecoPanel),
  { ssr: false, loading: () => <Panel><Loading rows={2} /></Panel> },
);
const ValuationPanel = dynamic(
  () => import("@/components/stocks/valuation-panel").then((m) => m.ValuationPanel),
  { ssr: false, loading: () => <Panel><Loading rows={3} /></Panel> },
);
const ForecastPanel = dynamic(
  () => import("@/components/stocks/forecast-panel").then((m) => m.ForecastPanel),
  { ssr: false, loading: () => <Panel><Loading rows={2} /></Panel> },
);
const StockStructurePanel = dynamic(
  () => import("@/components/stocks/structure-panel").then((m) => m.StockStructurePanel),
  { ssr: false, loading: () => <Panel><Loading rows={2} /></Panel> },
);

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
    refreshInterval: 20_000,
    timeoutMs: 14_000,
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] xl:items-start">
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
                  ? [{ label: "Trần", price: q.ceilingPrice, color: "#a78bfa" }]
                  : []),
                ...(q?.floorPrice != null
                  ? [{ label: "Sàn", price: q.floorPrice, color: "#67e8f9" }]
                  : []),
                ...(q?.referencePrice != null
                  ? [{ label: "TC", price: q.referencePrice, color: "#94a3b8" }]
                  : []),
              ]}
            />
          ) : (
            <Panel>
              <p className="text-[13px] text-text-muted">Chưa có dữ liệu biểu đồ.</p>
            </Panel>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <OrderBookPanel symbol={symbol} />
          <StockNewsSentiment symbol={symbol} />
          <TechnicalPanel symbol={symbol} bars={data.bars} technical={data.technical} patterns={data.patterns} />
          <TechRecoPanel symbol={symbol} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ValuationPanel symbol={symbol} />
        <ForecastPanel symbol={symbol} />
        <StockStructurePanel symbol={symbol} />
      </div>
    </div>
  );
}

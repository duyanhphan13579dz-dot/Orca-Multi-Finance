"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import type { Meta } from "@/lib/types";
import { Badge, FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, ShieldCheck } from "lucide-react";
import { OrcaChart } from "@/components/orca-chart";
import { StockNewsSentiment } from "@/components/stocks/news-sentiment-chip";
import { OrderBookPanel } from "@/components/stocks/order-book-panel";

const TechnicalPanel = dynamic(
  () => import("@/components/technical-panel").then((m) => m.TechnicalPanel),
  { ssr: false, loading: () => <Panel title="Phân tích kỹ thuật"><Loading rows={3} /></Panel> },
);
const TechRecoPanel = dynamic(
  () => import("@/components/stocks/tech-reco-panel").then((m) => m.TechRecoPanel),
  { ssr: false, loading: () => <Panel title="Tín hiệu kỹ thuật"><Loading rows={2} /></Panel> },
);
const ValuationPanel = dynamic(
  () => import("@/components/stocks/valuation-panel").then((m) => m.ValuationPanel),
  { ssr: false, loading: () => <Panel title="Định giá"><Loading rows={3} /></Panel> },
);
const ForecastPanel = dynamic(
  () => import("@/components/stocks/forecast-panel").then((m) => m.ForecastPanel),
  { ssr: false, loading: () => <Panel title="Dự báo"><Loading rows={2} /></Panel> },
);
const StockStructurePanel = dynamic(
  () => import("@/components/stocks/structure-panel").then((m) => m.StockStructurePanel),
  { ssr: false, loading: () => <Panel title="Cấu trúc"><Loading rows={2} /></Panel> },
);

function DecisionSnapshot({
  symbol,
  quote,
  technical,
  meta,
}: {
  symbol: string;
  quote: VnStockDetail["quote"];
  technical: VnStockDetail["technical"];
  meta: Meta | null;
}) {
  const trend = technical?.trend;
  const trendLabel = typeof trend === "object" && trend ? trend.label : String(trend ?? "Chưa rõ");
  const isUp = trendLabel.includes("up");
  const isDown = trendLabel.includes("down");
  const tone = isUp ? "up" : isDown ? "down" : "neutral";
  const action = isUp ? "Theo dõi tăng" : isDown ? "Thận trọng" : "Quan sát";
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Activity;

  return (
    <Panel
      title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent-primary" /> Decision Snapshot</span>}
      right={<span className="flex items-center gap-2"><FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} /><Badge tone={tone}>{action}</Badge></span>}
    >
      <div className="grid gap-3 md:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
        <div className="rounded-lg border border-border-subtle bg-surface-elevated/60 p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted"><Icon className="size-3.5" /> Luận điểm hiện tại</div>
          <p className="mt-1 text-[13px] font-semibold text-text-primary">{symbol}: {action.toLowerCase()} theo xu hướng {trendLabel}.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Snapshot chỉ tóm tắt dữ liệu hiện có; không thay thế kế hoạch giao dịch hoặc thẩm định cơ bản.</p>
        </div>
        <SnapshotMetric label="Giá gần nhất" value={quote?.price != null ? quote.price.toLocaleString("vi-VN") : "—"} />
        <SnapshotMetric label="RSI(14)" value={technical?.rsi14 != null ? technical.rsi14.toFixed(1) : "—"} />
        <SnapshotMetric label="Biến động 30d" value={technical?.volatility30d != null ? `${(technical.volatility30d * 100).toFixed(1)}%` : "—"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-text-muted"><Clock3 className="size-3.5" /> Dữ liệu thị trường được làm mới theo provider; kiểm tra dấu chấm freshness trước khi ra quyết định.</div>
    </Panel>
  );
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border-subtle px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div><div className="num mt-1 text-[18px] font-semibold text-text-primary">{value}</div></div>;
}

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

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
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
      <DecisionSnapshot symbol={data.symbol} quote={q} technical={data.technical} meta={meta ?? null} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] xl:items-start 2xl:grid-cols-12">
        <div className="min-w-0 2xl:col-span-9">
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
              <p className="stock-copy">Chưa có chuỗi giá để vẽ biểu đồ.</p>
            </Panel>
          )}
        </div>
        <div className="min-w-0 2xl:col-span-3">
          <OrderBookPanel symbol={data.symbol} compact />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start 2xl:grid-cols-12">
        <div className="min-w-0 2xl:col-span-6"><TechRecoPanel symbol={data.symbol} /></div>
        <div className="min-w-0 2xl:col-span-6"><StockStructurePanel symbol={data.symbol} /></div>
      </div>

      {data.technical ? <TechnicalPanel tech={data.technical} patterns={data.patterns} /> : null}

      <ValuationPanel symbol={data.symbol} compact showAnalyst={false} />

      <ForecastPanel symbol={data.symbol} compact />

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Panel title="Trạng thái cổ phiếu">
          {data.technical ? (
            <ul className="stock-list">
              <li className="stock-list-row">
                <span>Xu hướng</span>
                <strong className="text-text-primary">
                  {String(
                    (data.technical.trend as { label?: string } | null)?.label ??
                      data.technical.trend ??
                      "—",
                  )}
                </strong>
              </li>
              <li className="stock-list-row">
                <span>RSI(14)</span>
                <span className="num text-text-primary">
                  {data.technical.rsi14 != null ? data.technical.rsi14.toFixed(1) : "—"}
                </span>
              </li>
              <li className="stock-list-row">
                <span>Biến động 30d</span>
                <span className="num text-text-primary">
                  {data.technical.volatility30d != null
                    ? `${(data.technical.volatility30d * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </li>
            </ul>
          ) : (
            <p className="stock-copy">Chưa đủ dữ liệu kỹ thuật.</p>
          )}
        </Panel>

        <StockNewsSentiment symbol={data.symbol} />
      </div>
    </div>
  );
}

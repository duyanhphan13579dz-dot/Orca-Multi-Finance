"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import type { Meta } from "@/lib/types";
import { Badge, FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { OrcaChart } from "@/components/orca-chart";
import { StockNewsSentiment } from "@/components/stocks/news-sentiment-chip";
import { OrderBookPanel } from "@/components/stocks/order-book-panel";

const TechnicalPanel = dynamic(
  () => import("@/components/technical-panel").then((m) => m.TechnicalPanel),
  {
    ssr: false,
    loading: () => (
      <Panel title="Phân tích kỹ thuật">
        <Loading rows={3} />
      </Panel>
    ),
  },
);
const TechRecoPanel = dynamic(
  () => import("@/components/stocks/tech-reco-panel").then((m) => m.TechRecoPanel),
  {
    ssr: false,
    loading: () => (
      <Panel title="Tín hiệu kỹ thuật">
        <Loading rows={2} />
      </Panel>
    ),
  },
);
const ValuationPanel = dynamic(
  () => import("@/components/stocks/valuation-panel").then((m) => m.ValuationPanel),
  {
    ssr: false,
    loading: () => (
      <Panel title="Định giá">
        <Loading rows={3} />
      </Panel>
    ),
  },
);
const ForecastPanel = dynamic(
  () => import("@/components/stocks/forecast-panel").then((m) => m.ForecastPanel),
  {
    ssr: false,
    loading: () => (
      <Panel title="Dự báo">
        <Loading rows={2} />
      </Panel>
    ),
  },
);
const StockStructurePanel = dynamic(
  () => import("@/components/stocks/structure-panel").then((m) => m.StockStructurePanel),
  {
    ssr: false,
    loading: () => (
      <Panel title="Cấu trúc">
        <Loading rows={2} />
      </Panel>
    ),
  },
);

const SECTION_NAV = [
  { id: "sec-chart", label: "Biểu đồ" },
  { id: "sec-signals", label: "Tín hiệu" },
  { id: "sec-structure", label: "Cấu trúc" },
  { id: "sec-deep", label: "Chuyên sâu" },
  { id: "sec-valuation", label: "Định giá" },
] as const;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DecisionStrip({
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
  const trendLabel =
    typeof trend === "object" && trend ? trend.label : String(trend ?? "Chưa rõ");
  const isUp = trendLabel.includes("up");
  const isDown = trendLabel.includes("down");
  const tone = isUp ? "up" : isDown ? "down" : "neutral";
  const action = isUp ? "Theo dõi tăng" : isDown ? "Thận trọng" : "Quan sát";
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Activity;

  const price =
    quote?.price != null ? quote.price.toLocaleString("vi-VN") : "—";
  const rsi = technical?.rsi14 != null ? technical.rsi14.toFixed(1) : "—";
  const vol30 =
    technical?.volatility30d != null
      ? `${(technical.volatility30d * 100).toFixed(1)}%`
      : "—";

  return (
    <div
      id="sec-decision"
      className={`stock-decision-strip stock-decision-strip--${tone}`}
    >
      <div className="stock-decision-left">
        <ShieldCheck className="size-3.5 shrink-0 text-accent-primary" />
        <Icon className="size-3.5 shrink-0" />
        <span className="font-semibold text-text-primary">{symbol}</span>
        <span className="text-text-muted">·</span>
        <span
          className={
            tone === "up"
              ? "font-semibold text-positive"
              : tone === "down"
                ? "font-semibold text-negative"
                : "font-semibold text-text-secondary"
          }
        >
          {action}
        </span>
        <span className="hidden text-text-muted sm:inline">· {trendLabel}</span>
      </div>

      <div className="stock-decision-metrics">
        <MetricChip label="Giá" value={price} />
        <MetricChip label="RSI" value={rsi} />
        <MetricChip label="Vol 30D" value={vol30} />
        <Badge tone={tone}>{action}</Badge>
        <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="stock-metric-chip">
      <span className="stock-metric-chip-label">{label}</span>
      <strong className="num stock-metric-chip-value">{value}</strong>
    </span>
  );
}

function SectionNav() {
  return (
    <nav aria-label="Mục trong trang" className="stock-section-nav">
      {SECTION_NAV.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollToSection(s.id)}
          className="stock-section-nav-item"
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

function useChartHeight() {
  const [h, setH] = useState(360);
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      if (w >= 1280) setH(440);
      else if (w >= 640) setH(400);
      else setH(320);
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

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(
    symbol ? `/api/v1/stocks/${symbol}` : null,
    {
      refreshInterval: 20_000,
      timeoutMs: 14_000,
    },
  );

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
    <div className="stock-workspace stock-overview">
      <DecisionStrip
        symbol={data.symbol}
        quote={q}
        technical={data.technical}
        meta={meta ?? null}
      />

      <SectionNav />

      <div
        id="sec-chart"
        className="stock-trading-zone scroll-mt-28 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:items-start 2xl:grid-cols-12"
      >
        <div className="min-w-0 2xl:col-span-9">
          {q || data.bars.length > 0 ? (
            <div className="stock-chart-frame min-h-[320px]">
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
                    ? [
                        {
                          label: "Tham chiếu",
                          price: q.referencePrice,
                          color: "rgba(245,165,36,0.7)",
                        },
                      ]
                    : []),
                  ...(q?.floorPrice != null
                    ? [{ label: "Sàn", price: q.floorPrice, color: "rgba(56,189,248,0.7)" }]
                    : []),
                ]}
              />
            </div>
          ) : (
            <Panel title="Biểu đồ">
              <p className="stock-copy">Chưa có chuỗi giá để vẽ biểu đồ.</p>
            </Panel>
          )}
        </div>
        <div className="min-w-0 xl:sticky xl:top-[7.25rem] xl:self-start 2xl:col-span-3">
          <OrderBookPanel symbol={data.symbol} compact />
        </div>
      </div>

      <div
        id="sec-signals"
        className="scroll-mt-28 grid gap-3 lg:grid-cols-2 lg:items-start 2xl:grid-cols-12"
      >
        <div className="min-w-0 2xl:col-span-6">
          <TechRecoPanel symbol={data.symbol} />
        </div>
        <div id="sec-structure" className="min-w-0 scroll-mt-28 2xl:col-span-6">
          <StockStructurePanel symbol={data.symbol} />
        </div>
      </div>

      <div id="sec-deep" className="scroll-mt-28">
        {data.technical ? (
          <TechnicalPanel tech={data.technical} patterns={data.patterns} />
        ) : null}
      </div>

      <div id="sec-valuation" className="scroll-mt-28 space-y-3">
        <ValuationPanel symbol={data.symbol} compact showAnalyst={false} />
        <ForecastPanel symbol={data.symbol} compact />
      </div>

      <StockNewsSentiment symbol={data.symbol} />
    </div>
  );
}

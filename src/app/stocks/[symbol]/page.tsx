"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import type { Meta } from "@/lib/types";
import { FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
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
const PatternAnalysisHub = dynamic(
  () => import("@/components/stocks/pattern-analysis-hub").then((m) => m.PatternAnalysisHub),
  {
    ssr: false,
    loading: () => (
      <Panel title="Phân tích mẫu hình">
        <Loading rows={5} />
      </Panel>
    ),
  },
);

const SECTION_NAV = [
  { id: "sec-chart", label: "Biểu đồ" },
  { id: "sec-signals", label: "Tín hiệu" },
  { id: "sec-structure", label: "Mẫu hình" },
  { id: "sec-deep", label: "Chuyên sâu" },
] as const;

const TREND_VI: Record<string, string> = {
  "strong-up": "Tăng mạnh",
  up: "Xu hướng tăng",
  sideways: "Đi ngang",
  down: "Xu hướng giảm",
  "strong-down": "Giảm mạnh",
};

const MONEY_FLOW_VI: Record<string, string> = {
  "strong-inflow": "Vào mạnh",
  inflow: "Vào",
  balanced: "Cân bằng",
  outflow: "Ra",
  "strong-outflow": "Ra mạnh",
};

/** Sticky-offset helpers: hero bar → section nav → content. */
const ANCHOR_OFFSET =
  "calc(var(--stock-sticky-h, 6.35rem) + var(--stock-nav-h, 2.55rem) + 0.45rem)";

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
    typeof trend === "object" && trend
      ? TREND_VI[trend.label] ?? trend.label
      : String(trend ?? "Chưa rõ");
  const isUp = typeof trend === "object" && trend
    ? trend.label === "up" || trend.label === "strong-up"
    : String(trend ?? "").includes("up");
  const isDown = typeof trend === "object" && trend
    ? trend.label === "down" || trend.label === "strong-down"
    : String(trend ?? "").includes("down");
  const tone = isUp ? "up" : isDown ? "down" : "neutral";
  const action = isUp ? "Theo dõi tăng" : isDown ? "Thận trọng" : "Quan sát";
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Activity;

  const rsi = technical?.rsi14 != null ? technical.rsi14.toFixed(1) : "—";
  const vol30 =
    technical?.volatility30d != null
      ? `${(technical.volatility30d * 100).toFixed(1)}%`
      : "—";
  const flow = technical?.moneyFlow?.label;
  const flowLabel = flow ? MONEY_FLOW_VI[flow] ?? flow : null;

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
        {quote?.price != null && (
          <MetricChip
            label="Giá"
            value={quote.price.toLocaleString("vi-VN")}
            tone={quote.changePercent != null ? (quote.changePercent >= 0 ? "up" : "down") : undefined}
          />
        )}
        <MetricChip label="RSI" value={rsi} />
        {flowLabel && (
          <MetricChip
            label="Dòng tiền"
            value={flowLabel}
            tone={flow === "inflow" || flow === "strong-inflow" ? "up" : flow === "outflow" || flow === "strong-outflow" ? "down" : undefined}
          />
        )}
        <MetricChip label="Vol 30D" value={vol30} />
        <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <span className="stock-metric-chip">
      <span className="stock-metric-chip-label">{label}</span>
      <strong
        className={`num stock-metric-chip-value ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-primary"
        }`}
      >
        {value}
      </strong>
    </span>
  );
}

/** In-page nav with scroll-spy: highlights the section currently in view. */
function SectionNav() {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const els = SECTION_NAV.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el != null,
    );
    if (!els.length) return;
    const visible = new Set<Element>();
    const pick = () => {
      const first = els.find((el) => visible.has(el));
      if (first) setActive(first.id);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        pick();
      },
      // A section counts as "in view" while crossing the upper third of the viewport.
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <nav aria-label="Mục trong trang" className="stock-section-nav">
      {SECTION_NAV.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => {
            setActive(s.id);
            scrollToSection(s.id);
          }}
          data-active={active === s.id ? "true" : undefined}
          aria-current={active === s.id ? "true" : undefined}
          className="stock-section-nav-item"
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
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
    <div className="stock-workspace">
      <DecisionStrip
        symbol={data.symbol}
        quote={q}
        technical={data.technical}
        meta={meta ?? null}
      />

      <SectionNav />

      <section
        id="sec-chart"
        className="stock-section-card stock-trading-zone grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:items-start 2xl:grid-cols-12"
        aria-labelledby="sec-chart-title"
      >
        <div className="stock-section-heading" id="sec-chart-title">
          <div>
            <p className="stock-section-kicker">Thị trường</p>
            <h2>Biểu đồ &amp; sổ lệnh</h2>
          </div>
          <span className="stock-section-index">01</span>
        </div>
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
        <div
          className="min-w-0 xl:sticky xl:self-start 2xl:col-span-3"
          style={{ top: ANCHOR_OFFSET }}
        >
          <OrderBookPanel symbol={data.symbol} compact />
        </div>
      </section>

      <section
        id="sec-signals"
        className="stock-section-card grid gap-3 lg:grid-cols-2 lg:items-start 2xl:grid-cols-12"
        aria-labelledby="sec-signals-title"
      >
        <div className="stock-section-heading" id="sec-signals-title">
          <div>
            <p className="stock-section-kicker">Tín hiệu</p>
            <h2>Động lượng &amp; mẫu hình</h2>
          </div>
          <span className="stock-section-index">02</span>
        </div>
        <div className="min-w-0 2xl:col-span-6">
          <TechRecoPanel symbol={data.symbol} />
        </div>
        <div
          id="sec-structure"
          className="min-w-0 2xl:col-span-6"
          style={{ scrollMarginTop: ANCHOR_OFFSET }}
        >
          <PatternAnalysisHub
            symbol={data.symbol}
            patterns={data.patterns ?? []}
            technical={data.technical}
          />
        </div>
      </section>

      <section id="sec-deep" className="stock-section-card" aria-labelledby="sec-deep-title">
        <div className="stock-section-heading" id="sec-deep-title">
          <div>
            <p className="stock-section-kicker">Phân tích</p>
            <h2>Chuyên sâu kỹ thuật</h2>
          </div>
          <span className="stock-section-index">03</span>
        </div>
        {data.technical ? (
          <TechnicalPanel tech={data.technical} patterns={data.patterns} />
        ) : null}
      </section>

      <section className="stock-section-card stock-news-section" aria-labelledby="stock-news-title">
        <div className="stock-section-heading" id="stock-news-title">
          <div>
            <p className="stock-section-kicker">Thông tin</p>
            <h2>Tin tức &amp; cảm xúc thị trường</h2>
          </div>
          <span className="stock-section-index">04</span>
        </div>
        <StockNewsSentiment symbol={data.symbol} />
      </section>
    </div>
  );
}

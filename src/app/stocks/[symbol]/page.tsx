"use client";

import { useEffect, useState, useRef } from "react";
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

const ANCHOR_OFFSET =
  "calc(var(--stock-sticky-h, 6.35rem) + var(--stock-nav-h, 2.55rem) + 0.45rem)";

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DecisionStrip({
  quote,
  technical,
  meta,
}: {
  quote: VnStockDetail["quote"];
  technical: VnStockDetail["technical"];
  meta: Meta | null;
}) {
  const trend = technical?.trend;
  const trendLabel =
    typeof trend === "object" && trend
      ? TREND_VI[trend.label] ?? trend.label
      : String(trend ?? "Chưa rõ");

  const ts = technical?.tradeSignal;
  const signal =
    ts?.action === "buy" ? "MUA" : ts?.action === "sell" ? "BÁN" : "QUAN SÁT";
  const tone = signal === "MUA" ? "up" : signal === "BÁN" ? "down" : "neutral";
  const Icon = signal === "MUA" ? ArrowUpRight : signal === "BÁN" ? ArrowDownRight : Activity;
  const plan = ts?.plan ?? null;

  const rsi = technical?.rsi14 != null ? technical.rsi14.toFixed(1) : "—";
  const vol30 =
    technical?.volatility30d != null
      ? `${(technical.volatility30d * 100).toFixed(1)}%`
      : "—";
  const flow = technical?.moneyFlow?.label;
  const flowLabel = flow ? MONEY_FLOW_VI[flow] ?? flow : null;

  const fmt = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

  return (
    <div
      id="sec-decision"
      className={`stock-decision-strip stock-decision-strip--${tone}`}
    >
      <div className="stock-decision-left">
        <span className={`stock-signal-badge stock-signal-badge--${tone}`} aria-label={`Tín hiệu ${signal}`}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="stock-signal-badge-text">{signal}</span>
          {ts?.confidence != null && (
            <span className="stock-signal-badge-conf">{Math.round(ts.confidence)}%</span>
          )}
        </span>
        <span className="stock-decision-trend" title={trendLabel}>
          <ShieldCheck className="size-3 shrink-0 text-accent-primary" aria-hidden />
          {trendLabel}
        </span>
        {ts?.reasons?.[0] && (
          <span className="stock-decision-reason" title={ts.reasons.join(" · ")}>
            {ts.reasons[0]}
          </span>
        )}
      </div>

      <div className="stock-decision-metrics">
        {quote?.price != null && (
          <MetricChip
            label="Giá"
            value={quote.price.toLocaleString("vi-VN")}
            tone={
              quote.changePercent != null
                ? quote.changePercent >= 0
                  ? "up"
                  : "down"
                : undefined
            }
          />
        )}
        {plan && signal !== "QUAN SÁT" ? (
          <span className="stock-plan-group" role="group" aria-label="Kế hoạch giao dịch">
            <MetricChip label="Entry" value={fmt(plan.entry)} emphasis />
            <MetricChip label="SL" value={fmt(plan.stopLoss)} tone="down" />
            <MetricChip label="TP1" value={fmt(plan.takeProfit1 ?? plan.takeProfit)} tone="up" />
            <MetricChip label="TP" value={fmt(plan.takeProfit)} tone="up" />
            <MetricChip label="R:R" value={`1:${plan.riskReward.toFixed(1)}`} emphasis />
          </span>
        ) : (
          <MetricChip label="Setup" value="Chờ xác nhận" muted />
        )}
        <MetricChip label="RSI" value={rsi} />
        {flowLabel && (
          <MetricChip
            label="Dòng tiền"
            value={flowLabel}
            tone={
              flow === "inflow" || flow === "strong-inflow"
                ? "up"
                : flow === "outflow" || flow === "strong-outflow"
                  ? "down"
                  : undefined
            }
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
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={`stock-metric-chip${emphasis ? " stock-metric-chip--emphasis" : ""}${
        muted ? " stock-metric-chip--muted" : ""
      }${tone === "up" ? " stock-metric-chip--up" : tone === "down" ? " stock-metric-chip--down" : ""}`}
    >
      <span className="stock-metric-chip-label">{label}</span>
      <span
        className={`stock-metric-chip-value num ${
          tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [activeSection, setActiveSection] = useState<string>(SECTION_NAV[0].id);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, meta, isLoading } = useApi<VnStockDetail>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}` : null,
    { refreshInterval: 30_000 },
  );

  // Highlight section nav as the user scrolls
  useEffect(() => {
    if (!data?.symbol) return;
    const ids = SECTION_NAV.map((s) => s.id);
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveSection(visible[0].target.id);
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.08, 0.2, 0.4],
      },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [data?.symbol]);

  // Keep active pill in view on narrow screens
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const btn = nav.querySelector<HTMLElement>(`[data-section="${activeSection}"]`);
    btn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSection]);

  if (!symbol || (isLoading && !res)) {
    return (
      <div className="stock-workspace">
        <Loading rows={3} />
      </div>
    );
  }

  if (!res?.success || !data) {
    return (
      <div className="stock-workspace">
        <Unavailable
          title={`Không tải được ${symbol}`}
          note={res && !res.success ? res.error.message : "Nguồn dữ liệu đang gián đoạn."}
        />
      </div>
    );
  }

  return (
    <div className="stock-workspace stock-page-body">
      <nav ref={navRef} className="stock-section-nav" aria-label="Mục trang">
        {SECTION_NAV.map((s) => (
          <button
            key={s.id}
            type="button"
            data-section={s.id}
            data-active={activeSection === s.id ? "true" : "false"}
            className="stock-section-nav-item"
            onClick={() => {
              setActiveSection(s.id);
              scrollToSection(s.id);
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <DecisionStrip quote={data.quote} technical={data.technical} meta={meta ?? null} />

      <section id="sec-chart" className="stock-section-card" style={{ scrollMarginTop: ANCHOR_OFFSET }}>
        <div className="stock-section-heading">
          <div>
            <p className="stock-section-kicker">Chart</p>
            <h2>Biểu đồ kỹ thuật</h2>
          </div>
          <span className="stock-section-index">01</span>
        </div>
        <div className="stock-chart-frame">
          <OrcaChart symbol={data.symbol} assetType="stock" title={data.symbol} height={420} />
        </div>
      </section>

      <section
        id="sec-signals"
        className="stock-section-card"
        style={{ scrollMarginTop: ANCHOR_OFFSET }}
        aria-labelledby="sec-signals-title"
      >
        <div className="stock-section-heading" id="sec-signals-title">
          <div>
            <p className="stock-section-kicker">Signals</p>
            <h2>Tín hiệu kỹ thuật</h2>
          </div>
          <span className="stock-section-index">02</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <TechRecoPanel symbol={data.symbol} />
          <TechnicalPanel technical={data.technical} patterns={data.patterns} />
        </div>
      </section>

      <section id="sec-structure" className="stock-section-card" style={{ scrollMarginTop: ANCHOR_OFFSET }}>
        <div className="stock-section-heading">
          <div>
            <p className="stock-section-kicker">Structure</p>
            <h2>Mẫu hình & cấu trúc</h2>
          </div>
          <span className="stock-section-index">03</span>
        </div>
        <PatternAnalysisHub symbol={data.symbol} technical={data.technical} patterns={data.patterns} />
      </section>

      <section id="sec-deep" className="stock-section-card" style={{ scrollMarginTop: ANCHOR_OFFSET }}>
        <div className="stock-section-heading">
          <div>
            <p className="stock-section-kicker">Depth</p>
            <h2>Sổ lệnh & tin</h2>
          </div>
          <span className="stock-section-index">04</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <OrderBookPanel symbol={data.symbol} />
          <StockNewsSentiment symbol={data.symbol} />
        </div>
      </section>
    </div>
  );
}

/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import {
  buildSnapshotMetrics,
  formatMetric,
  type MetricCell,
} from "@/lib/financial/fundamental-metrics";
import { FundamentalTrendCharts } from "@/components/stocks/fundamental-trend-charts";
import { Badge, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";

type TabKey = "operating" | "investment" | "health" | "cashflow" | "valuation";

type FundPayload = {
  symbol: string;
  financials: {
    income: unknown[];
    balance: unknown[];
    cashflow: unknown[];
  };
  financialHealth?: {
    anchors?: { shares?: number | null };
  };
  financialGrowth?: {
    yoy?: { metric: string; changePct: number | null }[];
    qoq?: { metric: string; changePct: number | null }[];
  };
  quote?: { price?: number | null } | null;
  sharesOutstanding?: number | null;
  closes?: number[];
  performance?: {
    tsr?: number | null;
    tsr1y?: number | null;
    beta?: number | null;
    sharpe?: number | null;
    alpha?: number | null;
    dividendYield?: number | null;
    payoutRatio?: number | null;
    sampleDays?: number;
    note?: string;
  } | null;
  vndirectRatios?: { dividendYield?: number | null } | null;
};

type ValPayload = {
  multiples?: {
    pe?: number | null;
    pb?: number | null;
    ps?: number | null;
    evEbitda?: number | null;
    peg?: number | null;
  };
  vndirectRatios?: { pe?: number | null; pb?: number | null; ps?: number | null; dividendYield?: number | null };
  fairValues?: { dcfBase?: number | null; blended?: number | null; graham?: number | null };
  upsideDownside?: number | null;
  marketCap?: number | null;
};

function MetricGrid({ items }: { items: MetricCell[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((m) => (
        <div
          key={m.key}
          className="rounded-lg border border-border-subtle/70 bg-surface-elevated/40 px-3 py-2.5"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{m.labelVi}</div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-text-primary">{formatMetric(m)}</div>
          {m.note && <div className="mt-0.5 text-[11px] text-text-muted">{m.note}</div>}
          {m.bandLabel && (
            <div className="mt-1">
              <Badge tone={m.band === "safe" ? "up" : m.band === "risk" ? "down" : "accent"}>{m.bandLabel}</Badge>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function StockFundamentalsPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const [symbol, setSymbol] = useState("");
  const [tab, setTab] = useState<TabKey>("operating");

  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading, meta } = useApi<FundPayload>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/fundamentals` : null,
    { refreshInterval: 90_000 },
  );

  const { data: valData } = useApi<ValPayload>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/valuation` : null,
    { refreshInterval: 120_000 },
  );

  const metrics = useMemo(() => {
    if (!data?.financials) return null;
    const m = valData?.multiples;
    const vr = valData?.vndirectRatios;
    const fv = valData?.fairValues;
    return buildSnapshotMetrics({
      income: (data.financials.income ?? []) as Record<string, unknown>[],
      balance: (data.financials.balance ?? []) as Record<string, unknown>[],
      cashflow: (data.financials.cashflow ?? []) as Record<string, unknown>[],
      price: data.quote?.price ?? null,
      closes: data.closes ?? [],
      shares: data.sharesOutstanding ?? data.financialHealth?.anchors?.shares ?? null,
      performance: data.performance ?? null,
      growthYoy: (data.financialGrowth?.yoy ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
      growthQoq: (data.financialGrowth?.qoq ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
      overrides: {
        pe: m?.pe ?? vr?.pe ?? null,
        pb: m?.pb ?? vr?.pb ?? null,
        ps: m?.ps ?? vr?.ps ?? null,
        evEbitda: m?.evEbitda ?? null,
        peg: m?.peg ?? null,
        dcfBase: fv?.dcfBase ?? fv?.blended ?? null,
        upsidePct: valData?.upsideDownside ?? null,
        marketCap: valData?.marketCap ?? null,
        dividendYield:
          data.performance?.dividendYield ?? data.vndirectRatios?.dividendYield ?? null,
      },
    });
  }, [data, valData]);

  const chartSeries = useMemo(() => {
    if (!data?.financials) return { income: [], roe: [], cashflow: [] };
    const incomeRows = (data.financials.income ?? []) as Record<string, unknown>[];
    const balanceRows = (data.financials.balance ?? []) as Record<string, unknown>[];
    const cfRows = (data.financials.cashflow ?? []) as Record<string, unknown>[];

    const label = (r: Record<string, unknown>) => {
      if (typeof r.period === "string" && r.period) return r.period;
      if (r.year != null && r.quarter != null) return `${r.year}-Q${r.quarter}`;
      if (r.year != null) return String(r.year);
      return "—";
    };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

    const income = incomeRows.map((r) => ({
      period: label(r),
      revenue: num(r.netRevenue) ?? num(r.revenue),
      netIncome: num(r.netIncome) ?? num(r.netProfit),
      grossProfit: num(r.grossProfit),
      grossMargin:
        num(r.grossProfit) != null && (num(r.netRevenue) ?? num(r.revenue))
          ? (num(r.grossProfit)! / (num(r.netRevenue) ?? num(r.revenue))!)
          : null,
      netMargin:
        (num(r.netIncome) ?? num(r.netProfit)) != null && (num(r.netRevenue) ?? num(r.revenue))
          ? ((num(r.netIncome) ?? num(r.netProfit))! / (num(r.netRevenue) ?? num(r.revenue))!)
          : null,
    }));

    const roe = incomeRows.map((r, i) => {
      const b = balanceRows[i] ?? {};
      const ni = num(r.netIncome) ?? num(r.netProfit);
      const eq = num(b.equity);
      const as = num(b.totalAssets);
      return {
        period: label(r),
        roe: ni != null && eq ? ni / eq : null,
        roa: ni != null && as ? ni / as : null,
      };
    });

    const cashflow = cfRows.map((r) => ({
      period: label(r),
      operatingCashFlow: num(r.operatingCashFlow),
      freeCashFlow: num(r.freeCashFlow),
      investingCashFlow: num(r.investingCashFlow),
      financingCashFlow: num(r.financingCashFlow),
      capex: num(r.capex),
    }));

    return { income, roe, cashflow };
  }, [data]);

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data || !metrics) {
    return <Unavailable title={`Không lấy được phân tích cơ bản ${symbol || ""}`} />;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "operating", label: "HĐKD" },
    { key: "investment", label: "Hiệu suất đầu tư" },
    { key: "health", label: "Sức khỏe TC" },
    { key: "cashflow", label: "Dòng tiền" },
    { key: "valuation", label: "Định giá nhanh" },
  ];

  const body =
    tab === "operating"
      ? metrics.operating
      : tab === "investment"
        ? metrics.investment
        : tab === "health"
          ? [...metrics.debtPillars, ...metrics.healthExtra]
          : tab === "cashflow"
            ? metrics.cashflow
            : metrics.valuation;

  return (
    <div className="space-y-4">
      <MetaLine meta={meta} />

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              tab === t.key
                ? "border-accent-primary/50 bg-accent-primary/15 text-accent-primary"
                : "border-border-subtle text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Panel title={tabs.find((t) => t.key === tab)?.label ?? "Chỉ số"}>
        <MetricGrid items={body} />
      </Panel>

      <FundamentalTrendCharts
        income={chartSeries.income}
        roe={chartSeries.roe}
        cashflow={chartSeries.cashflow}
      />
    </div>
  );
}

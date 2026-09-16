"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Chg, Loading, Panel, Unavailable } from "@/components/ui";
import { AiFinancialPanel } from "@/components/stocks/ai-financial-panel";
import { ValuationPanel } from "@/components/stocks/valuation-panel";
import { FundamentalTrendCharts } from "@/components/stocks/fundamental-trend-charts";
import {
  buildSnapshotMetrics,
  formatMetric,
  type Band,
  type MetricCell,
} from "@/lib/financial/fundamental-metrics";

type TabKey = "operating" | "investment" | "health" | "cashflow" | "valuation";

const TABS: { key: TabKey; label: string; short: string }[] = [
  { key: "operating", label: "1. Hiệu suất KD", short: "Hiệu suất KD" },
  { key: "investment", label: "2. Hiệu suất ĐT", short: "Hiệu suất ĐT" },
  { key: "health", label: "3. Sức khỏe TC", short: "Sức khỏe" },
  { key: "cashflow", label: "4. Dòng tiền", short: "Dòng tiền" },
  { key: "valuation", label: "5. Định giá", short: "Định giá" },
];

function bandClass(b?: Band): string {
  if (b === "safe") return "border-up/40 bg-up/10 text-up";
  if (b === "ok") return "border-warn/40 bg-warn/10 text-warn";
  if (b === "risk") return "border-down/40 bg-down/10 text-down";
  return "border-line/40 text-ink-3";
}

function MetricGrid({ items }: { items: MetricCell[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((m) => (
        <div key={m.key} className={`rounded-lg border px-3 py-2.5 ${bandClass(m.band)}`}>
          <div className="text-[10px] uppercase tracking-wide opacity-80">{m.labelVi}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="num text-[15px] font-semibold text-ink-2">{formatMetric(m)}</span>
            {m.delta != null && <Chg value={m.delta} className="text-[11px]" />}
          </div>
          {m.bandLabel && m.band && m.band !== "na" && (
            <div className="mt-0.5 text-[10px] font-medium">{m.bandLabel}</div>
          )}
          {m.note && <div className="mt-0.5 text-[10px] text-ink-3">{m.note}</div>}
        </div>
      ))}
    </div>
  );
}

type FundPayload = {
  financials?: {
    income?: Record<string, unknown>[];
    balance?: Record<string, unknown>[];
    cashflow?: Record<string, unknown>[];
  };
  financialHealth?: { anchors?: { shares?: number | null } };
  financialGrowth?: {
    yoy?: { metric: string; changePct: number | null }[];
    qoq?: { metric: string; changePct: number | null }[];
  };
  quote?: { price?: number } | null;
  sharesOutstanding?: number | null;
  periodCount?: number;
  pipeline?: string;
};

type ValPayload = {
  multiples?: {
    pe?: number | null;
    pb?: number | null;
    ps?: number | null;
    evEbitda?: number | null;
    peg?: number | null;
  };
  fairValues?: {
    blended?: number | null;
    dcfBase?: number | null;
    dcfBear?: number | null;
    dcfBull?: number | null;
  };
  upsideDownside?: number | null;
  marketCap?: number | null;
  vndirectRatios?: {
    pe?: number | null;
    pb?: number | null;
    ps?: number | null;
  } | null;
};

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

  const { res, data, isLoading } = useApi<FundPayload>(
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
      closes: [],
      shares: data.sharesOutstanding ?? data.financialHealth?.anchors?.shares ?? null,
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
      },
    });
  }, [data, valData]);

  const chartSeries = useMemo(() => {
    if (!data?.financials) {
      return { income: [], roe: [], cashflow: [] };
    }
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
    const rev = (r: Record<string, unknown>) => num(r.netRevenue) ?? num(r.revenue);
    const ni = (r: Record<string, unknown>) =>
      num(r.netIncome) ?? num(r.netProfit) ?? num(r.netIncomeParent);

    // chronological oldest → newest for charts
    const incomeChrono = [...incomeRows].slice(0, 12).reverse();
    const balChrono = [...balanceRows].slice(0, 12).reverse();
    const cfChrono = [...cfRows].slice(0, 12).reverse();

    const income = incomeChrono.map((r) => {
      const revenue = rev(r);
      const netIncome = ni(r);
      const gp = num(r.grossProfit);
      return {
        period: label(r),
        revenue,
        netIncome,
        grossProfit: gp,
        grossMargin: revenue && gp != null && revenue !== 0 ? gp / revenue : null,
        netMargin: revenue && netIncome != null && revenue !== 0 ? netIncome / revenue : null,
      };
    });

    const roe = incomeChrono.map((r, idx) => {
      const bal = balChrono[idx] ?? {};
      const equity = num(bal.equity);
      const assets = num(bal.totalAssets);
      const net = ni(r);
      return {
        period: label(r),
        roe: equity && net != null && equity !== 0 ? net / equity : null,
        roa: assets && net != null && assets !== 0 ? net / assets : null,
      };
    });

    const cashflow = cfChrono.map((r) => {
      const ocf = num(r.operatingCashFlow);
      const capex = num(r.capex) != null ? Math.abs(num(r.capex)!) : 0;
      const fcf = num(r.freeCashFlow) ?? (ocf != null ? ocf - capex : null);
      return {
        period: label(r),
        operatingCashFlow: ocf,
        freeCashFlow: fcf,
        investingCashFlow: num(r.investingCashFlow),
        financingCashFlow: num(r.financingCashFlow),
        capex: num(r.capex) != null ? Math.abs(num(r.capex)!) : null,
      };
    });

    return { income, roe, cashflow };
  }, [data]);

  if (!symbol || (isLoading && !res)) {
    return <Loading rows={6} />;
  }

  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được fundamentals ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn dữ liệu đang gián đoạn."}
      />
    );
  }

  const empty: MetricCell[] = [];
  const operating = metrics?.operating ?? empty;
  const investment = metrics?.investment ?? empty;
  const health = [...(metrics?.debtPillars ?? empty), ...(metrics?.healthExtra ?? empty)];
  const cashflow = metrics?.cashflow ?? empty;
  const valuation = metrics?.valuation ?? empty;

  return (
    <div className="stock-workspace">
      <div className="stock-tabs-scroll -mx-0.5 border-b border-line pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-10 shrink-0 rounded-md px-3 py-2 text-[12px] font-medium transition-colors sm:min-h-0 sm:py-1.5 ${
              tab === t.key
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-text-muted hover:bg-surface-elevated hover:text-text-primary"
            }`}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {data.periodCount != null && (
        <p className="px-0.5 text-[11px] text-text-muted">
          Pipeline {data.pipeline ?? "direct"} · {data.periodCount} kỳ BCTC từ VNDirect
        </p>
      )}

      {/* Biểu đồ xu hướng — luôn hiện phía trên metric grid */}
      <FundamentalTrendCharts
        income={chartSeries.income}
        roe={chartSeries.roe}
        cashflow={chartSeries.cashflow}
      />

      {tab === "operating" && (
        <Panel title="Hiệu suất kinh doanh">
          <MetricGrid items={operating} />
        </Panel>
      )}

      {tab === "investment" && (
        <Panel title="Hiệu suất đầu tư & sinh lời">
          <MetricGrid items={investment} />
        </Panel>
      )}

      {tab === "health" && (
        <Panel title="Sức khỏe tài chính">
          <MetricGrid items={health} />
        </Panel>
      )}

      {tab === "cashflow" && (
        <Panel title="Dòng tiền">
          <MetricGrid items={cashflow} />
        </Panel>
      )}

      {tab === "valuation" && (
        <div className="stock-workspace">
          <Panel title="Định giá nhanh (multiples)">
            <MetricGrid items={valuation} />
          </Panel>
          <ValuationPanel symbol={symbol} showAnalyst={false} />
        </div>
      )}

      <AiFinancialPanel symbol={symbol} />

      <Panel title="Nguồn báo cáo tài chính">
        <ul className="space-y-1.5 text-[12px] text-text-secondary">
          <li>
            <a
              className="text-accent-primary underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-tai-chinh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Bảng cân đối kế toán — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent-primary underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kết quả kinh doanh — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent-primary underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lưu chuyển tiền tệ — {symbol}
            </a>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

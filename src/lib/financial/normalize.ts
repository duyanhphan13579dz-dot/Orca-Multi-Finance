import "server-only";
import type { NormalizedMetrics, NormalizedPeriod, PeriodType } from "./types";

/** Metrics summed across quarters for TTM (flow metrics). */
const FLOW_KEYS: (keyof NormalizedMetrics)[] = [
  "revenue",
  "netRevenue",
  "cogs",
  "grossProfit",
  "operatingProfit",
  "ebit",
  "ebitda",
  "interestExpense",
  "profitBeforeTax",
  "taxExpense",
  "netIncome",
  "netIncomeParent",
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "capex",
  "freeCashFlow",
];

/** Point-in-time metrics — take latest quarter value for TTM snapshot. */
const STOCK_KEYS: (keyof NormalizedMetrics)[] = [
  "cash",
  "shortTermInvestments",
  "receivables",
  "inventory",
  "currentAssets",
  "fixedAssets",
  "longTermAssets",
  "totalAssets",
  "shortTermDebt",
  "longTermDebt",
  "currentLiabilities",
  "totalLiabilities",
  "equity",
  "retainedEarnings",
  "cashBegin",
  "cashEnd",
];

function isQuarter(p: NormalizedPeriod): boolean {
  return p.periodType === "quarter" && p.year != null && p.quarter != null;
}

function sumNullable(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

/** Last 4 complete quarters → TTM period (does not fabricate missing quarters). */
export function buildTtmPeriod(periods: NormalizedPeriod[]): NormalizedPeriod | null {
  const quarters = periods.filter(isQuarter).sort((a, b) => {
    const ay = a.year ?? 0;
    const by = b.year ?? 0;
    if (ay !== by) return by - ay;
    return (b.quarter ?? 0) - (a.quarter ?? 0);
  });

  // unique by period label, newest first
  const seen = new Set<string>();
  const unique: NormalizedPeriod[] = [];
  for (const q of quarters) {
    if (seen.has(q.period)) continue;
    seen.add(q.period);
    unique.push(q);
  }

  if (unique.length < 4) return null;
  const window = unique.slice(0, 4);
  const head = window[0];
  const metrics: NormalizedMetrics = {};

  for (const k of FLOW_KEYS) {
    const s = sumNullable(window.map((p) => p.metrics[k]));
    if (s != null) metrics[k] = s;
  }
  for (const k of STOCK_KEYS) {
    const v = head.metrics[k];
    if (v != null) metrics[k] = v;
  }

  // derived FCF if missing
  if (metrics.freeCashFlow == null && metrics.operatingCashFlow != null) {
    const cap = metrics.capex ?? 0;
    metrics.freeCashFlow = metrics.operatingCashFlow - Math.abs(cap);
  }

  return {
    period: `TTM-${head.period}`,
    periodType: "ttm" as PeriodType,
    fiscalDate: head.fiscalDate,
    year: head.year,
    quarter: head.quarter,
    statementScope: head.statementScope,
    auditStatus: head.auditStatus,
    currency: "VND",
    source: head.source,
    confidence: Math.min(...window.map((w) => w.confidence)),
    metrics,
  };
}

export type GrowthMetricKey =
  | "revenue"
  | "netRevenue"
  | "grossProfit"
  | "operatingProfit"
  | "netIncome"
  | "operatingCashFlow"
  | "totalAssets"
  | "equity";

export interface GrowthCell {
  metric: GrowthMetricKey;
  current: number | null;
  prior: number | null;
  changePct: number | null;
  currentPeriod: string | null;
  priorPeriod: string | null;
}

export interface GrowthSnapshot {
  yoy: GrowthCell[];
  qoq: GrowthCell[];
  latestPeriod: string | null;
  priorYearPeriod: string | null;
  priorQuarterPeriod: string | null;
}

const GROWTH_METRICS: GrowthMetricKey[] = [
  "revenue",
  "netRevenue",
  "grossProfit",
  "operatingProfit",
  "netIncome",
  "operatingCashFlow",
  "totalAssets",
  "equity",
];

function pctChange(cur: number | null, prior: number | null): number | null {
  if (cur == null || prior == null || prior === 0) return null;
  return (cur - prior) / Math.abs(prior);
}

function metricOf(p: NormalizedPeriod | undefined, k: GrowthMetricKey): number | null {
  if (!p) return null;
  const v = p.metrics[k] ?? (k === "revenue" ? p.metrics.netRevenue : null);
  return v ?? null;
}

function findPriorYear(quarters: NormalizedPeriod[], head: NormalizedPeriod): NormalizedPeriod | undefined {
  if (head.year == null || head.quarter == null) return undefined;
  return quarters.find((p) => p.year === head.year - 1 && p.quarter === head.quarter);
}

function findPriorQuarter(quarters: NormalizedPeriod[], head: NormalizedPeriod): NormalizedPeriod | undefined {
  if (head.year == null || head.quarter == null) return undefined;
  const pq = head.quarter === 1 ? 4 : head.quarter - 1;
  const py = head.quarter === 1 ? head.year - 1 : head.year;
  return quarters.find((p) => p.year === py && p.quarter === pq);
}

function cells(
  head: NormalizedPeriod | undefined,
  prior: NormalizedPeriod | undefined,
): GrowthCell[] {
  return GROWTH_METRICS.map((metric) => {
    const current = metricOf(head, metric);
    const prev = metricOf(prior, metric);
    return {
      metric,
      current,
      prior: prev,
      changePct: pctChange(current, prev),
      currentPeriod: head?.period ?? null,
      priorPeriod: prior?.period ?? null,
    };
  });
}

/** YoY / QoQ on latest quarter; annual YoY when only annuals exist. */
export function computeGrowth(periods: NormalizedPeriod[]): GrowthSnapshot {
  const quarters = periods
    .filter(isQuarter)
    .sort((a, b) => {
      const ay = a.year ?? 0;
      const by = b.year ?? 0;
      if (ay !== by) return by - ay;
      return (b.quarter ?? 0) - (a.quarter ?? 0);
    });

  // dedupe
  const seen = new Set<string>();
  const uniqueQ: NormalizedPeriod[] = [];
  for (const q of quarters) {
    if (seen.has(q.period)) continue;
    seen.add(q.period);
    uniqueQ.push(q);
  }

  if (uniqueQ.length) {
    const head = uniqueQ[0];
    const yoyPrior = findPriorYear(uniqueQ, head);
    const qoqPrior = findPriorQuarter(uniqueQ, head);
    return {
      yoy: cells(head, yoyPrior),
      qoq: cells(head, qoqPrior),
      latestPeriod: head.period,
      priorYearPeriod: yoyPrior?.period ?? null,
      priorQuarterPeriod: qoqPrior?.period ?? null,
    };
  }

  // annual fallback
  const annuals = periods
    .filter((p) => p.periodType === "year")
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const headA = annuals[0];
  const priorA = annuals[1];
  return {
    yoy: cells(headA, priorA),
    qoq: [],
    latestPeriod: headA?.period ?? null,
    priorYearPeriod: priorA?.period ?? null,
    priorQuarterPeriod: null,
  };
}

/** Sort periods: TTM first (optional), then newest fiscal first. */
export function sortPeriodsNewestFirst(periods: NormalizedPeriod[]): NormalizedPeriod[] {
  return [...periods].sort((a, b) => {
    if (a.periodType === "ttm" && b.periodType !== "ttm") return -1;
    if (b.periodType === "ttm" && a.periodType !== "ttm") return 1;
    const ay = a.year ?? 0;
    const by = b.year ?? 0;
    if (ay !== by) return by - ay;
    return (b.quarter ?? 0) - (a.quarter ?? 0);
  });
}

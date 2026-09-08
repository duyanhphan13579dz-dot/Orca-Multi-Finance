import "server-only";
import { httpJson } from "../http";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";

const VND = "vndirect-fs";
const BASE = (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

/** VAS / VNDirect itemCode map (modelType 1 BS, 2 IS, 3 CF). */
const BS: Record<number, keyof NormalizedMetrics> = {
  11100: "cash",
  11110: "cash",
  11000: "currentAssets",
  12000: "longTermAssets",
  13000: "totalLiabilities",
  13100: "currentLiabilities",
  14000: "equity",
  14220: "retainedEarnings",
  14400: "totalAssets", // total resources — equals assets
};

const IS: Record<number, keyof NormalizedMetrics> = {
  21000: "netRevenue",
  21001: "revenue",
  22100: "cogs",
  23000: "profitBeforeTax",
  23003: "operatingProfit",
  23800: "netIncome",
  23810: "netIncomeParent",
  22510: "interestExpense",
};

const CF: Record<number, keyof NormalizedMetrics> = {
  31200: "operatingCashFlow",
  32000: "investingCashFlow",
  33000: "financingCashFlow",
  32100: "capex",
  36000: "cashBegin",
  37000: "cashEnd",
};

interface RawRow {
  code: string;
  itemCode: number;
  reportType: string;
  modelType: number;
  numericValue: number;
  fiscalDate: string;
  createdDate?: string;
  modifiedDate?: string;
}

function periodFromFiscal(fiscalDate: string, reportType: string): {
  period: string;
  year: number | null;
  quarter: number | null;
  periodType: NormalizedPeriod["periodType"];
} {
  const y = Number(fiscalDate.slice(0, 4));
  const m = Number(fiscalDate.slice(5, 7));
  const isAnnual = /ANNUAL/i.test(reportType);
  if (isAnnual || m === 12) {
    // Prefer year label for Dec annual; still keep quarter if QUARTER*
    if (isAnnual) return { period: String(y), year: y, quarter: null, periodType: "year" };
  }
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return { period: `${y}-Q${q}`, year: y, quarter: q, periodType: "quarter" };
}

function pivot(rows: RawRow[]): NormalizedPeriod[] {
  const byDate = new Map<string, RawRow[]>();
  for (const r of rows) {
    const k = `${r.fiscalDate}|${r.reportType}`;
    const arr = byDate.get(k) ?? [];
    arr.push(r);
    byDate.set(k, arr);
  }
  const periods: NormalizedPeriod[] = [];
  for (const [, group] of byDate) {
    const head = group[0];
    const meta = periodFromFiscal(head.fiscalDate, head.reportType);
    const metrics: NormalizedMetrics = {};
    for (const r of group) {
      const code = Math.round(Number(r.itemCode));
      const mt = Number(r.modelType);
      const map = mt === 1 ? BS : mt === 2 ? IS : mt === 3 ? CF : null;
      if (!map) continue;
      const key = map[code];
      if (!key) continue;
      const v = Number(r.numericValue);
      if (!Number.isFinite(v)) continue;
      // Prefer first non-zero / keep if not set
      if (metrics[key] == null || (metrics[key] === 0 && v !== 0)) metrics[key] = v;
    }
    // Derived
    if (metrics.totalAssets == null && metrics.currentAssets != null && metrics.longTermAssets != null) {
      metrics.totalAssets = metrics.currentAssets + metrics.longTermAssets;
    }
    if (metrics.grossProfit == null && metrics.netRevenue != null && metrics.cogs != null) {
      metrics.grossProfit = metrics.netRevenue - metrics.cogs;
    }
    if (metrics.freeCashFlow == null && metrics.operatingCashFlow != null) {
      const cap = metrics.capex != null ? Math.abs(metrics.capex) : 0;
      metrics.freeCashFlow = metrics.operatingCashFlow - cap;
    }
    if (metrics.revenue == null && metrics.netRevenue != null) metrics.revenue = metrics.netRevenue;
    if (metrics.netIncomeParent == null && metrics.netIncome != null) metrics.netIncomeParent = metrics.netIncome;
    if (metrics.ebit == null && metrics.operatingProfit != null) metrics.ebit = metrics.operatingProfit;

    const filled = Object.values(metrics).filter((v) => v != null).length;
    if (filled < 3) continue;

    periods.push({
      period: meta.period,
      periodType: meta.periodType,
      fiscalDate: head.fiscalDate,
      year: meta.year,
      quarter: meta.quarter,
      statementScope: "consolidated",
      auditStatus: "unknown",
      currency: "VND",
      source: VND,
      sourceUrl: `${BASE}/v4/financial_statements?q=code:${head.code}`,
      filingDate: head.modifiedDate ?? head.createdDate ?? null,
      confidence: 0.72,
      metrics,
    });
  }
  periods.sort((a, b) => (b.fiscalDate ?? "").localeCompare(a.fiscalDate ?? ""));
  return periods;
}

/** Convert normalized periods → legacy row arrays for fundamental engine / UI. */
export function periodsToLegacyRows(periods: NormalizedPeriod[]): {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
} {
  const income: Record<string, unknown>[] = [];
  const balance: Record<string, unknown>[] = [];
  const cashflow: Record<string, unknown>[] = [];
  const ratios: Record<string, unknown>[] = [];

  for (const p of periods) {
    const m = p.metrics;
    const base = {
      period: p.period,
      year: p.year,
      quarter: p.quarter,
      fiscalDate: p.fiscalDate,
      source: p.source,
    };
    income.push({
      ...base,
      revenue: m.revenue ?? m.netRevenue ?? null,
      netRevenue: m.netRevenue ?? m.revenue ?? null,
      cogs: m.cogs ?? null,
      grossProfit: m.grossProfit ?? null,
      operatingProfit: m.operatingProfit ?? m.ebit ?? null,
      ebit: m.ebit ?? m.operatingProfit ?? null,
      interestExpense: m.interestExpense ?? null,
      profitBeforeTax: m.profitBeforeTax ?? null,
      netProfit: m.netIncome ?? m.netIncomeParent ?? null,
      netIncome: m.netIncome ?? null,
    });
    balance.push({
      ...base,
      cash: m.cash ?? null,
      currentAssets: m.currentAssets ?? null,
      longTermAssets: m.longTermAssets ?? null,
      totalAssets: m.totalAssets ?? null,
      currentLiabilities: m.currentLiabilities ?? null,
      totalLiabilities: m.totalLiabilities ?? null,
      equity: m.equity ?? null,
      retainedEarnings: m.retainedEarnings ?? null,
    });
    cashflow.push({
      ...base,
      operatingCashFlow: m.operatingCashFlow ?? null,
      investingCashFlow: m.investingCashFlow ?? null,
      financingCashFlow: m.financingCashFlow ?? null,
      capex: m.capex ?? null,
      freeCashFlow: m.freeCashFlow ?? null,
      cashBegin: m.cashBegin ?? null,
      cashEnd: m.cashEnd ?? null,
    });

    // Simple period ratios for table
    const rev = m.netRevenue ?? m.revenue;
    const ni = m.netIncome ?? m.netIncomeParent;
    const eq = m.equity;
    const ta = m.totalAssets;
    ratios.push({
      ...base,
      netMargin: rev && ni != null ? ni / rev : null,
      roe: eq && ni != null && eq !== 0 ? ni / eq : null,
      roa: ta && ni != null && ta !== 0 ? ni / ta : null,
      debtToEquity:
        eq && m.totalLiabilities != null && eq !== 0 ? m.totalLiabilities / eq : null,
      currentRatio:
        m.currentLiabilities && m.currentAssets != null && m.currentLiabilities !== 0
          ? m.currentAssets / m.currentLiabilities
          : null,
    });
  }
  return { income, balance, cashflow, ratios };
}

export async function fetchVndirectFinancials(
  symbol: string,
  opts?: { limitPeriods?: number },
): Promise<{ periods: NormalizedPeriod[]; latencyMs: number } | null> {
  const sym = symbol.toUpperCase();
  const t0 = performance.now();
  const limit = opts?.limitPeriods ?? 8;

  // Pull recent quarterly + annual pivots
  const queries = [
    `/v4/financial_statements?q=code:${sym}~reportType:QUARTER2&size=400&sort=fiscalDate:desc`,
    `/v4/financial_statements?q=code:${sym}~reportType:ANNUAL2&size=200&sort=fiscalDate:desc`,
  ];

  const all: RawRow[] = [];
  for (const path of queries) {
    const res = await httpJson<{ data?: RawRow[] }>(`${BASE}${path}`, {
      provider: VND,
      timeoutMs: 12_000,
      retries: 1,
    });
    if (res.ok && res.data?.data?.length) all.push(...res.data.data);
  }
  if (!all.length) return null;

  // Keep only the newest N fiscal dates worth of rows
  const dates = [...new Set(all.map((r) => r.fiscalDate))].sort().reverse().slice(0, limit);
  const dateSet = new Set(dates);
  const filtered = all.filter((r) => dateSet.has(r.fiscalDate));
  const periods = pivot(filtered).slice(0, limit);
  if (!periods.length) return null;
  return { periods, latencyMs: Math.round(performance.now() - t0) };
}

import "server-only";
import { httpJson } from "../http";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";
import { normalizePeriodMetrics, periodsToStatementTables } from "./statements";
import { metricKeyFromItemCode } from "./metric-dictionary";

const VND = "vndirect-fs";
const BASE = (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

/**
 * VAS / VNDirect itemCode → NormalizedMetrics key.
 * Đồng bộ với metric-dictionary (labelVi/labelEn chuẩn).
 */
const BS: Record<number, keyof NormalizedMetrics> = {
  11100: "cash",
  11110: "cash",
  11200: "shortTermInvestments",
  11210: "shortTermInvestments",
  11300: "receivables",
  11310: "receivables",
  11400: "inventory",
  11410: "inventory",
  11000: "currentAssets",
  12000: "longTermAssets",
  12100: "fixedAssets",
  12110: "fixedAssets",
  13000: "totalLiabilities",
  13100: "currentLiabilities",
  13110: "shortTermDebt",
  13200: "longTermDebt",
  14000: "equity",
  14220: "retainedEarnings",
  14400: "totalAssets",
};

const IS: Record<number, keyof NormalizedMetrics> = {
  21000: "netRevenue",
  21001: "revenue",
  22100: "cogs",
  22200: "grossProfit",
  23000: "profitBeforeTax",
  23003: "operatingProfit",
  23010: "ebit",
  23100: "ebitda",
  23800: "netIncome",
  23810: "netIncomeParent",
  22510: "interestExpense",
  23600: "taxExpense",
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
  itemName?: string;
}

function periodFromFiscal(
  fiscalDate: string,
  reportType: string,
): {
  period: string;
  year: number | null;
  quarter: number | null;
  periodType: NormalizedPeriod["periodType"];
} {
  const y = Number(fiscalDate.slice(0, 4));
  const m = Number(fiscalDate.slice(5, 7));
  const isAnnual = /ANNUAL/i.test(reportType);
  const isSemi = /SEMI|6M|HALF/i.test(reportType);
  if (isAnnual) return { period: String(y), year: y, quarter: null, periodType: "year" };
  if (isSemi) {
    const h = m <= 6 ? 1 : 2;
    return { period: `${y}-H${h}`, year: y, quarter: h === 1 ? 2 : 4, periodType: "semi" };
  }
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return { period: `${y}-Q${q}`, year: y, quarter: q, periodType: "quarter" };
}

function resolveMetricKey(itemCode: number, modelType: number): keyof NormalizedMetrics | null {
  const map = modelType === 1 ? BS : modelType === 2 ? IS : modelType === 3 ? CF : null;
  return (map && map[itemCode]) || metricKeyFromItemCode(itemCode);
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
      const code = Number(r.itemCode);
      if (!Number.isFinite(code)) continue;
      const key = resolveMetricKey(code, Number(r.modelType));
      if (!key) continue;
      const v = r.numericValue;
      if (!Number.isFinite(v)) continue;
      if (metrics[key] == null) metrics[key] = v;
    }

    const normalized = normalizePeriodMetrics(metrics);
    const filled = Object.values(normalized).filter((v) => v != null).length;
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
      confidence: 0.75,
      metrics: normalized,
    });
  }
  periods.sort((a, b) => (b.fiscalDate ?? "").localeCompare(a.fiscalDate ?? ""));
  return periods;
}

export function periodsToLegacyRows(periods: NormalizedPeriod[]): {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
} {
  return periodsToStatementTables(periods);
}

export async function fetchVndirectFinancials(
  symbol: string,
  opts?: { limitPeriods?: number },
): Promise<{ periods: NormalizedPeriod[]; latencyMs: number } | null> {
  const sym = symbol.toUpperCase();
  const t0 = performance.now();
  const limit = opts?.limitPeriods ?? 12;

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

  const dates = [...new Set(all.map((r) => r.fiscalDate))].sort().reverse().slice(0, limit);
  const dateSet = new Set(dates);
  const filtered = all.filter((r) => dateSet.has(r.fiscalDate));
  const periods = pivot(filtered).slice(0, limit);
  if (!periods.length) return null;
  return { periods, latencyMs: Math.round(performance.now() - t0) };
}

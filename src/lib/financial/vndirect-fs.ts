import "server-only";
import { httpJson } from "../http";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";
import { normalizePeriodMetrics, periodsToStatementTables } from "./statements";
import { metricKeyFromItemCode, metricProfileForSymbol, type MetricProfile } from "./metric-dictionary";

/**
 * VNDIRECT Financial Collector — PRIMARY BCTC (cùng nguồn structured mà DStock dùng).
 *
 * Tham chiếu hiển thị (SYMBOL động — HPG chỉ là ví dụ mẫu):
 *   BS  https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/{SYMBOL}
 *   IS  https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/{SYMBOL}
 *   CF  https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/{SYMBOL}
 *
 * Feed: api-finfo /v4/financial_statements
 *   modelType 1 = Balance Sheet
 *   modelType 2 = Income Statement
 *   modelType 3 = Cash Flow
 * reportType QUARTER/ANNUAL = mẫu hợp nhất DStock (KHÔNG dùng QUARTER2/ANNUAL2 — lệch số).
 * Không scrape HTML. SSI không tham gia domain này.
 */

const VND = "vndirect-fs";
const BASE = (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

/** DStock-aligned itemCode → canonical metric (NON_FINANCE / TT202). */
const BS: Record<number, keyof NormalizedMetrics> = {
  11000: "currentAssets",
  11100: "cash",
  11110: "cash",
  11120: "cash",
  11200: "shortTermInvestments",
  11210: "shortTermInvestments",
  11300: "receivables",
  11310: "receivables",
  11320: "receivables",
  11350: "receivables",
  11400: "inventory",
  11410: "inventory",
  12000: "longTermAssets",
  12100: "fixedAssets",
  12110: "fixedAssets",
  12180: "fixedAssets",
  13000: "totalLiabilities",
  13100: "currentLiabilities",
  13110: "shortTermDebt",
  13200: "longTermDebt",
  13300: "longTermDebt",
  13340: "longTermDebt",
  14000: "equity",
  14100: "equity",
  14220: "retainedEarnings",
  14400: "totalAssets",
  12700: "totalAssets",
};

const IS: Record<number, keyof NormalizedMetrics> = {
  21000: "netRevenue",
  21001: "revenue",
  22100: "cogs",
  22200: "grossProfit",
  22500: "interestExpense",
  22510: "interestExpense",
  23000: "profitBeforeTax",
  23003: "operatingProfit",
  23010: "ebit",
  23100: "ebitda",
  23600: "taxExpense",
  23800: "netIncome",
  23810: "netIncomeParent",
};

const CF: Record<number, keyof NormalizedMetrics> = {
  31200: "operatingCashFlow",
  32000: "investingCashFlow",
  32100: "capex",
  32500: "capex",
  33000: "financingCashFlow",
  36000: "cashBegin",
  37000: "cashEnd",
};

/** URL provenance theo mã — không hardcode HPG. */
const DSTOCK_URL: Record<1 | 2 | 3, (sym: string) => string> = {
  1: (s) => `https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${s}`,
  2: (s) => `https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${s}`,
  3: (s) => `https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${s}`,
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

function resolveMetricKey(
  itemCode: number,
  modelType: number,
  profile: MetricProfile,
): keyof NormalizedMetrics | null {
  const map = modelType === 1 ? BS : modelType === 2 ? IS : modelType === 3 ? CF : null;
  return (map && map[itemCode]) || metricKeyFromItemCode(itemCode, profile);
}

function pivot(rows: RawRow[], profile: MetricProfile, symbol: string): NormalizedPeriod[] {
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
    const modelCounts = { 1: 0, 2: 0, 3: 0 };

    for (const r of group) {
      const code = Number(r.itemCode);
      if (!Number.isFinite(code)) continue;
      const mt = Number(r.modelType);
      if (mt === 1 || mt === 2 || mt === 3) modelCounts[mt as 1 | 2 | 3] += 1;
      const key = resolveMetricKey(code, mt, profile);
      if (!key) continue;
      const v = r.numericValue;
      if (!Number.isFinite(v)) continue;
      if (metrics[key] == null) metrics[key] = v;
    }

    let bestModel: 1 | 2 | 3 = 2;
    for (const m of [1, 2, 3] as const) {
      if (modelCounts[m] > modelCounts[bestModel]) bestModel = m;
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
      sourceUrl: DSTOCK_URL[bestModel](symbol),
      filingDate: head.modifiedDate ?? head.createdDate ?? null,
      confidence: 0.8,
      metrics: normalized,
    });
  }
  periods.sort((a, b) => (b.fiscalDate ?? "").localeCompare(a.fiscalDate ?? ""));
  return periods;
}

export function periodsToLegacyRows(
  periods: NormalizedPeriod[],
  symbolOrProfile?: string | MetricProfile,
): {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
} {
  const profile: MetricProfile =
    symbolOrProfile === "bank" || symbolOrProfile === "nonbank"
      ? symbolOrProfile
      : metricProfileForSymbol(symbolOrProfile);
  return periodsToStatementTables(periods, profile);
}

async function fetchStatementPage(
  symbol: string,
  modelType: 1 | 2 | 3,
  reportType: "QUARTER" | "ANNUAL",
  size: number,
): Promise<RawRow[]> {
  const path = `/v4/financial_statements?q=code:${symbol}~modelType:${modelType}~reportType:${reportType}&size=${size}&sort=fiscalDate:desc`;
  const res = await httpJson<{ data?: RawRow[] }>(`${BASE}${path}`, {
    provider: VND,
    timeoutMs: 14_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      "User-Agent": "OrcaFinancial/1.0 (+vndirect-fs)",
    },
  });
  if (!res.ok || !res.data?.data?.length) return [];
  return res.data.data;
}

/**
 * Lấy BCTC chuẩn DStock cho mọi mã: 3 báo cáo × (quý + năm) từ api-finfo.
 * reportType = QUARTER | ANNUAL (khớp số liệu DStock).
 */
export async function fetchVndirectFinancials(
  symbol: string,
  opts?: { limitPeriods?: number },
): Promise<{ periods: NormalizedPeriod[]; latencyMs: number; profile: MetricProfile } | null> {
  const sym = symbol.toUpperCase();
  const profile = metricProfileForSymbol(sym);
  const t0 = performance.now();
  const limit = opts?.limitPeriods ?? 12;

  const jobs: Promise<RawRow[]>[] = [];
  for (const model of [1, 2, 3] as const) {
    jobs.push(fetchStatementPage(sym, model, "QUARTER", 800));
    jobs.push(fetchStatementPage(sym, model, "ANNUAL", 400));
  }
  const chunks = await Promise.all(jobs);
  const all = chunks.flat();
  if (!all.length) return null;

  const dates = [...new Set(all.map((r) => r.fiscalDate))].sort().reverse().slice(0, limit);
  const dateSet = new Set(dates);
  const filtered = all.filter((r) => dateSet.has(r.fiscalDate));
  const periods = pivot(filtered, profile, sym).slice(0, limit);
  if (!periods.length) return null;
  return { periods, latencyMs: Math.round(performance.now() - t0), profile };
}

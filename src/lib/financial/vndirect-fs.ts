import "server-only";
import { httpJson } from "../http";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";
import { normalizePeriodMetrics, periodsToStatementTables } from "./statements";
import { metricKeyFromItemCode, metricProfileForSymbol, type MetricProfile } from "./metric-dictionary";

/**
 * DStock / VNDIRECT Financial Collector — PRIMARY BCTC.
 *
 * API mà chính DStock gọi (api-finfo):
 *   GET /v4/financial_models?q=codeList:{SYMBOL}~modelType:...~displayLevel:0,1,2,3
 *   GET /v4/financial_statements?q=code:{SYMBOL}~reportType:QUARTER|ANNUAL~modelType:...
 *
 * modelType: 1 = BS, 2 = IS, 3 = CF (NON_FINANCE / TT202).
 * reportType: QUARTER | ANNUAL (không dùng *2 — lệch số).
 *
 * itemCode map bám itemVnName từ financial_models (DStock), không đoán mò.
 */

const VND = "vndirect-fs";
const BASE = (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const DSTOCK_HEADERS: Record<string, string> = {
  Accept: "application/json",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "User-Agent": "OrcaFinancial/1.0 (+dstock-api-finfo)",
};

/** Balance sheet — itemVnName từ DStock financial_models modelType=1 */
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

/**
 * Income statement — map theo itemVnName DStock (HPG / TT202 NON_FINANCE):
 *   21000 Tổng doanh thu HĐKD
 *   21001 Doanh thu thuần
 *   22100 Giá vốn hàng bán
 *   23100 Lợi nhuận gộp
 *   23110 LN thuần từ HĐKD
 *   23800 LN kế toán trước thuế
 *   22070 Chi phí thuế TNDN
 *   23003 LN sau thuế TNDN
 *   23000 LN sau thuế của CT mẹ
 */
const IS: Record<number, keyof NormalizedMetrics> = {
  21000: "revenue",
  21001: "netRevenue",
  22100: "cogs",
  23100: "grossProfit",
  23110: "operatingProfit",
  23010: "ebit",
  22510: "interestExpense",
  22500: "interestExpense",
  23800: "profitBeforeTax",
  22070: "taxExpense",
  23003: "netIncome",
  23000: "netIncomeParent",
};

/**
 * Cash flow — map theo itemVnName DStock:
 *   32000 LC tiền thuần từ HĐKD
 *   33000 LC tiền thuần từ HĐ đầu tư
 *   34000 LC tiền thuần từ HĐ tài chính
 *   32100 Mua sắm TSCĐ (capex)
 *   36000 / 37000 tiền đầu / cuối kỳ
 */
const CF: Record<number, keyof NormalizedMetrics> = {
  32000: "operatingCashFlow",
  33000: "investingCashFlow",
  34000: "financingCashFlow",
  32100: "capex",
  36000: "cashBegin",
  37000: "cashEnd",
};

const DSTOCK_URL: Record<1 | 2 | 3, (sym: string) => string> = {
  1: (s) => `https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${s}`,
  2: (s) => `https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${s}`,
  3: (s) => `https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${s}`,
};

/** modelType sets giống request DStock (IS có 2,90,102,412). */
const MODEL_TYPES: Record<1 | 2 | 3, string> = {
  1: "1,91,103,413",
  2: "2,90,102,412",
  3: "3,92,104,414",
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
  // Prefer explicit DStock maps; fall back to dictionary
  const primary =
    modelType === 1 || modelType === 91 || modelType === 103 || modelType === 413
      ? BS
      : modelType === 2 || modelType === 90 || modelType === 102 || modelType === 412
        ? IS
        : modelType === 3 || modelType === 92 || modelType === 104 || modelType === 414
          ? CF
          : null;
  if (primary && primary[itemCode]) return primary[itemCode];
  return metricKeyFromItemCode(itemCode, profile);
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
      if (mt === 1 || mt === 91 || mt === 103 || mt === 413) modelCounts[1] += 1;
      else if (mt === 2 || mt === 90 || mt === 102 || mt === 412) modelCounts[2] += 1;
      else if (mt === 3 || mt === 92 || mt === 104 || mt === 414) modelCounts[3] += 1;
      const key = resolveMetricKey(code, mt, profile);
      if (!key) continue;
      const v = r.numericValue;
      if (!Number.isFinite(v)) continue;
      // Prefer first fill; explicit maps use primary totals first via sort of codes if needed
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
      confidence: 0.85,
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
  modelKind: 1 | 2 | 3,
  reportType: "QUARTER" | "ANNUAL",
  size: number,
): Promise<RawRow[]> {
  const modelType = MODEL_TYPES[modelKind];
  const path = `/v4/financial_statements?q=code:${symbol}~reportType:${reportType}~modelType:${modelType}&size=${size}&sort=fiscalDate:desc`;
  const res = await httpJson<{ data?: RawRow[] }>(`${BASE}${path}`, {
    provider: VND,
    timeoutMs: 16_000,
    retries: 1,
    headers: DSTOCK_HEADERS,
  });
  if (!res.ok || !res.data?.data?.length) return [];
  return res.data.data;
}

/**
 * Lấy BCTC trực tiếp API DStock (api-finfo) cho mọi mã.
 * 3 báo cáo × quý + năm; map itemCode theo itemVnName DStock.
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
    jobs.push(fetchStatementPage(sym, model, "QUARTER", 2000));
    jobs.push(fetchStatementPage(sym, model, "ANNUAL", 800));
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

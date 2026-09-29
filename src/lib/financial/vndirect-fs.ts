import "server-only";
import { httpJson } from "../http";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";
import { normalizePeriodMetrics, periodsToStatementTables } from "./statements";
import { metricKeyFromItemCode, metricProfileForSymbol, type MetricProfile } from "./metric-dictionary";

const VND = "vndirect-fs";
const BASE = (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const DSTOCK_HEADERS: Record<string, string> = {
  Accept: "application/json",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "User-Agent": "OrcaFinancial/1.0 (+dstock-api-finfo)",
};

/** Balance sheet (VAS + CK model 89) */
const BS: Record<number, keyof NormalizedMetrics> = {
  // ===== Mẫu doanh nghiệp (model 1) — VAS =====
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
  12200: "fixedAssets",
  12210: "fixedAssets",
  13000: "totalLiabilities",
  13100: "currentLiabilities",
  13110: "shortTermDebt",
  13120: "shortTermDebt",
  13140: "shortTermDebt",
  13200: "longTermDebt",
  13300: "longTermDebt",
  13340: "longTermDebt",
  14000: "equity",
  14100: "equity",
  14220: "retainedEarnings",
  14230: "retainedEarnings",
  14400: "totalAssets",
  12700: "totalAssets",
};

/**
 * Mẫu ngân hàng (model 413 balance / 412 income / 414 cashflow).
 * Tách riêng để không ô nhiễm mapping DN thường: item 421200 (LN gộp NH)
 * không được lọt vào bảng income của DN sản xuất — thương mại.
 */
const BS_BANK: Record<number, keyof NormalizedMetrics> = {
  411100: "cash",
  411200: "cash",
  411400: "cash",
  412100: "receivables",
  412500: "longTermAssets",
  413100: "shortTermDebt",
  413200: "shortTermDebt",
  413210: "shortTermDebt",
  413300: "longTermDebt",
  413700: "totalLiabilities",
  413740: "currentLiabilities",
};

const IS: Record<number, keyof NormalizedMetrics> = {
  // ===== Mẫu doanh nghiệp (model 2) — VAS =====
  21000: "revenue", // Tổng doanh thu hoạt động kinh doanh
  21001: "netRevenue", // Doanh thu thuần = 21000 − giảm trừ
  22100: "cogs",
  23100: "grossProfit",
  23110: "operatingProfit",
  23010: "ebit",
  22510: "interestExpense", // Chi phí lãi vay (luôn ghi dương = chi phí)
  22500: "interestExpense",
  23800: "profitBeforeTax",
  23810: "profitBeforeTax",
  22070: "taxExpense",
  23500: "taxExpense",
  23003: "netIncome", // LNST (sau lãi thiểu số)
  23000: "netIncomeParent", // LNST thuộc công ty mẹ
  23001: "netIncome", // LNST sau CSTC (mẫu cũ)
};

/** Mẫu ngân hàng (model 412) — chỉ dùng khi profile = bank. */
const IS_BANK: Record<number, keyof NormalizedMetrics> = {
  421100: "revenue", // Thu nhập lãi thuần
  421200: "grossProfit", // LN gộp NH
  421900: "netRevenue",
  422900: "interestExpense", // Chi phí lãi tiền gửi/cho vay NH
};

/**
 * Cash flow codes.
 * 35000 trên mẫu CK (model 91) = biến động tiền thuần — KHÔNG map thành FCF.
 * FCF chỉ tính: OCF − |Capex| trong normalizeCashflowMetrics.
 */
const CF: Record<number, keyof NormalizedMetrics> = {
  32000: "operatingCashFlow",
  32500: "operatingCashFlow",
  33000: "investingCashFlow",
  34000: "financingCashFlow",
  32100: "capex",
  33100: "capex",
  36000: "cashBegin",
  36100: "cashBegin",
  37000: "cashEnd",
};

/** Mẫu ngân hàng (model 414) */
const CF_BANK: Record<number, keyof NormalizedMetrics> = {
  400760: "capex",
};

/**
 * Model VNDirect:
 * BS: 1 (DN), 89 (CK), 101/111 (NH)
 * IS: 2, 90 (CK), 102/112 (NH)
 * CF: 3, 91 (CK), 92, 103/104/113 (NH)
 */
const MODEL_TYPES: Record<1 | 2 | 3, string> = {
  1: "1,89,101,111,413",
  2: "2,90,102,112,412",
  3: "3,91,92,103,104,113,414",
};

const BS_MODELS = new Set([1, 89, 101, 111, 413]);
const IS_MODELS = new Set([2, 90, 102, 112, 412]);
const CF_MODELS = new Set([3, 91, 92, 103, 104, 113, 414]);

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
  unit?: string;
  unitName?: string;
  sourceUrl?: string;
}

const STATEMENT_SOURCE_URLS = {
  income: (symbol: string) => `https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`,
  cashflow: (symbol: string) => `https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`,
  balance: (symbol: string) => `https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${symbol}`,
} as const;

function sourceUrlForModel(modelType: number, symbol: string): string {
  if (IS_MODELS.has(modelType)) return STATEMENT_SOURCE_URLS.income(symbol);
  if (CF_MODELS.has(modelType)) return STATEMENT_SOURCE_URLS.cashflow(symbol);
  return STATEMENT_SOURCE_URLS.balance(symbol);
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
  const year = Number.isFinite(y) ? y : null;
  if (reportType === "ANNUAL" || reportType === "YEAR") {
    return { period: year ? `${year}` : fiscalDate, year, quarter: null, periodType: "year" };
  }
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return {
    period: year ? `${year}-Q${q}` : fiscalDate,
    year,
    quarter: q,
    periodType: "quarter",
  };
}

function resolveMetricKey(
  itemCode: number,
  modelType: number,
  profile: MetricProfile,
): keyof NormalizedMetrics | null {
  const mt = Number(modelType);
  // Tách bộ mapping theo modelType thực tế của row (bank = 412/413/414)
  // để item-code ngân hàng không lọt vào bảng DN thường (và ngược lại).
  const isBankModel = mt === 412 || mt === 413 || mt === 414;
  if (isBankModel && profile !== "bank") return null;
  if (!isBankModel && profile === "bank") {
    if (!BS_BANK[itemCode] && !IS_BANK[itemCode] && !CF_BANK[itemCode]) return null;
  }
  const primary = BS_MODELS.has(mt)
    ? isBankModel
      ? BS_BANK
      : BS
    : IS_MODELS.has(mt)
      ? isBankModel
        ? IS_BANK
        : IS
      : CF_MODELS.has(mt)
        ? isBankModel
          ? CF_BANK
          : CF
        : null;
  if (primary && primary[itemCode]) return primary[itemCode];
  return metricKeyFromItemCode(itemCode, profile);
}

function pivot(rows: RawRow[], profile: MetricProfile, _symbol: string): NormalizedPeriod[] {
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
      const mt = Number(r.modelType);
      const key = resolveMetricKey(code, mt, profile);
      if (!key) continue;
      let v = Number(r.numericValue);
      if (!Number.isFinite(v)) continue;
      // Chi phí (lãi vay / thuế) luôn lưu dương — DStock có lúc trả số âm dạng "khoản chi".
      if (key === "interestExpense" || key === "taxExpense") v = Math.abs(v);
      if (v === 0 && (key === "interestExpense" || key === "taxExpense")) continue;
      if (key === "capex") {
        const cur = metrics.capex;
        const absV = Math.abs(v);
        if (cur == null || absV > Math.abs(cur as number)) metrics.capex = v;
        continue;
      }
      const cur = metrics[key];
      if (cur == null || Math.abs(v) > Math.abs(cur as number)) metrics[key] = v;
    }
    // Dedupe LNST: nếu netIncome và netIncomeParent trùng nhau (DN không có lãi thiểu số)
    // chỉ giữ netIncomeParent khi giá trị khác — tránh hiển thị 2 dòng giống hệt nhau.
    if (metrics.netIncome != null && metrics.netIncomeParent != null) {
      const a = metrics.netIncome as number;
      const b = metrics.netIncomeParent as number;
      if (Math.abs(a - b) < Math.max(1, Math.abs(a) * 0.0001)) {
        metrics.netIncomeParent = a; // giữ 1 giá trị, 2 dòng vẫn hợp lệ về ý nghĩa
      }
    }
    const sourceUrls = [...new Set(group.map((r) => r.sourceUrl).filter((url): url is string => Boolean(url)))];
    const sourceUrl = sourceUrls[0] ?? sourceUrlForModel(Number(head.modelType), _symbol);
    const sourceUnits = [...new Set(group.map((r) => r.unitName ?? r.unit).filter((unit): unit is string => Boolean(unit)))];
    periods.push({
      period: meta.period,
      periodType: meta.periodType,
      fiscalDate: head.fiscalDate,
      year: meta.year,
      quarter: meta.quarter,
      statementScope: "unknown",
      auditStatus: "unknown",
      currency: "VND",
      source: "vndirect-fs",
      sourceUrl,
      sourceUrls: sourceUrls.length ? sourceUrls : [sourceUrl],
      unit: sourceUnits[0] ?? "VND",
      confidence: 0.85,
      metrics: normalizePeriodMetrics(metrics),
    });
  }
  return periods.sort((a, b) => String(b.fiscalDate).localeCompare(String(a.fiscalDate)));
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
  return res.data.data.map((row) => ({
    ...row,
    // Preserve the provider's unit when present; never scale numericValue implicitly.
    unit: row.unit ?? "VND",
    sourceUrl: sourceUrlForModel(Number(row.modelType), symbol),
  }));
}

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
  let periods = pivot(filtered, profile, sym).slice(0, limit);
  if (!periods.length) return null;

  if (profile === "bank") {
    periods = periods.map((p) => {
      const m = { ...p.metrics };
      if (m.netRevenue == null && m.revenue != null) m.netRevenue = m.revenue;
      if (m.revenue == null && m.netRevenue != null) m.revenue = m.netRevenue;
      if (m.ebit == null && m.operatingProfit != null) m.ebit = m.operatingProfit;
      if (m.operatingProfit == null && m.ebit != null) m.operatingProfit = m.ebit;
      if (m.netIncome == null && m.netIncomeParent != null) m.netIncome = m.netIncomeParent;
      return { ...p, metrics: m };
    });
  }
  return { periods, latencyMs: Math.round(performance.now() - t0), profile };
}

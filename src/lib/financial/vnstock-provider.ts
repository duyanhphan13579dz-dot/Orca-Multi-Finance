import "server-only";
import { env } from "../env";
import { getVnFinancials, type FinancialReportType } from "../providers/vnstock";
import { metricProfileForSymbol, type MetricProfile } from "./metric-dictionary";
import { normalizePeriodMetrics } from "./statements";
import type { NormalizedMetrics, NormalizedPeriod, PeriodType } from "./types";

const strip = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");

const ALIASES: Partial<Record<keyof NormalizedMetrics, string[]>> = {
  revenue: ["revenue", "totalrevenue", "sales", "netsales", "netrevenue", "doanhthu", "doanhthuthuan", "thunhaplaithuan"],
  netRevenue: ["netrevenue", "netsales", "doanhthuthuan"],
  cogs: ["cogs", "costofgoods", "costofgoodssold", "costofsales", "giavonhangban"],
  grossProfit: ["grossprofit", "loi nhuận gộp", "loi nhuận gop", "loinhuangop"],
  operatingProfit: ["operatingprofit", "operatingincome", "loi nhuan thuan tu hdkd", "loinhuantuhdkd"],
  ebit: ["ebit", "operatingprofit", "operatingincome"],
  ebitda: ["ebitda"],
  interestExpense: ["interestexpense", "financecost", "interestcost", "chiphilaivay"],
  profitBeforeTax: ["profitbeforetax", "pretaxincome", "profitbeforetaxation", "loinhuantruoc thue"],
  taxExpense: ["taxexpense", "incometaxexpense", "tax", "chiphithue"],
  netIncome: ["netincome", "netprofit", "profitaftertax", "profitfortheyear", "loinhuansauthue", "loinhuanrong"],
  netIncomeParent: ["netincomeparent", "netprofitparent", "profitattributabletoparent", "loinhuansauthuecongtyme"],
  cash: ["cash", "cashequivalents", "cashandequivalents", "cashandcashequivalents", "tienvatuongduongtien"],
  shortTermInvestments: ["shortterminvestments", "shortterminvestment", "financialinvestments"],
  receivables: ["receivables", "accountsreceivable", "tradeandotherreceivables", "phai thu"],
  inventory: ["inventory", "inventories", "hangtonkho"],
  currentAssets: ["currentassets", "taisannganhan"],
  fixedAssets: ["fixedassets", "propertyplantequipment", "tangibleassets"],
  longTermAssets: ["longtermassets", "noncurrentassets", "taisan-daihan"],
  totalAssets: ["totalassets", "tongtaisan"],
  shortTermDebt: ["shorttermdebt", "shorttermborrowings", "currentborrowings", "vaynganhan"],
  longTermDebt: ["longtermdebt", "longtermborrowings", "noncurrentborrowings", "vaydaihan"],
  currentLiabilities: ["currentliabilities", "no nganh an", "nonganhan"],
  totalLiabilities: ["totalliabilities", "totaldebtandliabilities", "nophaitra"],
  equity: ["equity", "totalequity", "owners equity", "ownerequity", "vonchusohuu"],
  retainedEarnings: ["retainedearnings", "undistributedearnings"],
  operatingCashFlow: ["operatingcashflow", "netcashfromoperatingactivities", "cashfromoperations", "luuchuyentientuthdkd"],
  investingCashFlow: ["investingcashflow", "netcashfrominvestingactivities", "cashfrominvestingactivities"],
  financingCashFlow: ["financingcashflow", "netcashfromfinancingactivities", "cashfromfinancingactivities"],
  capex: ["capex", "capitalexpenditures", "purchaseofpropertyplantequipment", "purchaseoffixedassets", "muasamtscd"],
  freeCashFlow: ["freecashflow", "fcf"],
  cashBegin: ["cashbegin", "cashatbeginningofperiod", "cashandcashequivalentsatbeginningofperiod"],
  cashEnd: ["cashend", "cashatendofperiod", "cashandcashequivalentsatendofperiod"],
};

const aliasesByKey = new Map<keyof NormalizedMetrics, Set<string>>(
  Object.entries(ALIASES).map(([key, aliases]) => [
    key as keyof NormalizedMetrics,
    new Set([key, ...(aliases ?? [])].map(strip)),
  ]),
);

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function rowPeriod(
  row: Record<string, unknown>,
  requested: "quarter" | "year",
): { period: string; fiscalDate: string; year: number; quarter: number | null; periodType: PeriodType } | null {
  const label = pickString(row, ["period", "periodLabel", "fiscalDate", "reportDate", "date", "time"]);
  const yearRaw =
    finiteNumber(row.year) ??
    finiteNumber(row.yearReport) ??
    finiteNumber(row.fiscalYear) ??
    finiteNumber(row.year_report);
  const yearMatch = label?.match(/(?:19|20)\d{2}/);
  const year = yearRaw ?? (yearMatch ? Number(yearMatch[0]) : null);
  if (year == null || year < 1900 || year > 2200) return null;

  const quarterRaw =
    finiteNumber(row.quarter) ??
    finiteNumber(row.quarterReport) ??
    finiteNumber(row.quarter_report) ??
    finiteNumber(row.lengthYear) ??
    finiteNumber(row.lengthReport);
  const quarterMatch = label?.match(/(?:^|\D)(?:q|quarter|quy)\s*([1-4])(?:\D|$)/i);
  const quarter =
    requested === "quarter"
      ? quarterRaw != null && quarterRaw >= 1 && quarterRaw <= 4
        ? quarterRaw
        : quarterMatch
          ? Number(quarterMatch[1])
          : null
      : null;
  if (requested === "quarter" && quarter == null) return null;

  const periodType: PeriodType = requested === "year" ? "year" : "quarter";
  const period = periodType === "year" ? String(year) : `${year}-Q${quarter}`;
  let fiscalDate = label && /^\d{4}-\d{2}-\d{2}/.test(label) ? label.slice(0, 10) : "";
  if (!fiscalDate) {
    const month = periodType === "year" ? 12 : (quarter ?? 4) * 3;
    const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
    fiscalDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return { period, fiscalDate, year, quarter, periodType };
}

function metricsFromRow(row: Record<string, unknown>): NormalizedMetrics {
  const result: NormalizedMetrics = {};
  const label = pickString(row, ["itemName", "metricName", "metric", "item", "name", "label", "key"]);
  const value =
    finiteNumber(row.value) ??
    finiteNumber(row.numericValue) ??
    finiteNumber(row.amount) ??
    finiteNumber(row.currentValue);

  if (label && value != null) {
    const normalizedLabel = strip(label);
    for (const [key, aliases] of aliasesByKey) {
      if (aliases.has(normalizedLabel)) {
        result[key] = value;
        break;
      }
    }
  }

  for (const [field, rawValue] of Object.entries(row)) {
    const numeric = finiteNumber(rawValue);
    if (numeric == null) continue;
    const normalizedField = strip(field);
    for (const [key, aliases] of aliasesByKey) {
      if (aliases.has(normalizedField) && result[key] == null) {
        result[key] = numeric;
        break;
      }
    }
  }
  return result;
}

/** Pure normalizer exported for provider-contract tests and schema debugging. */
export function normalizeVnStockFinancialRows(
  symbol: string,
  rows: Record<string, unknown>[],
  requested: "quarter" | "year",
  profile: MetricProfile = metricProfileForSymbol(symbol),
): NormalizedPeriod[] {
  const grouped = new Map<string, {
    period: string;
    fiscalDate: string;
    year: number;
    quarter: number | null;
    periodType: PeriodType;
    metrics: NormalizedMetrics;
    unit: string;
  }>();

  for (const row of rows) {
    const period = rowPeriod(row, requested);
    if (!period) continue;
    const key = `${period.periodType}:${period.period}`;
    const item = grouped.get(key) ?? {
      ...period,
      metrics: {},
      unit: pickString(row, ["unit", "unitName", "currency"]) ?? "VND",
    };
    const current = metricsFromRow(row);
    for (const [metric, value] of Object.entries(current)) {
      const name = metric as keyof NormalizedMetrics;
      if (item.metrics[name] == null && typeof value === "number") item.metrics[name] = value;
    }
    grouped.set(key, item);
  }

  return [...grouped.values()]
    .map((period) => ({
      period: period.period,
      periodType: period.periodType,
      fiscalDate: period.fiscalDate,
      year: period.year,
      quarter: period.quarter,
      statementScope: "unknown" as const,
      auditStatus: "unknown" as const,
      currency: "VND" as const,
      source: "vnstock-financial",
      unit: period.unit,
      confidence: 0.65,
      metrics: normalizePeriodMetrics(period.metrics),
    }))
    .sort((a, b) => String(b.fiscalDate).localeCompare(String(a.fiscalDate)));
}

export async function fetchVnstockFinancials(
  symbol: string,
  opts?: { limitPeriods?: number },
): Promise<{ periods: NormalizedPeriod[]; latencyMs: number; profile: MetricProfile } | null> {
  if (!env.vnstockApiKey || !env.vnstockBaseUrl) return null;
  const sym = symbol.toUpperCase();
  const profile = metricProfileForSymbol(sym);
  const limit = Math.max(1, Math.min(40, opts?.limitPeriods ?? 12));
  const started = performance.now();
  const reports: FinancialReportType[] = ["income", "balance", "cashflow"];
  const requests = reports.flatMap((report) =>
    (["quarter", "year"] as const).map(async (period) => {
      try {
        const rows = await getVnFinancials(sym, report, period, limit);
        return normalizeVnStockFinancialRows(sym, rows, period, profile);
      } catch {
        return [] as NormalizedPeriod[];
      }
    }),
  );
  const results = await Promise.all(requests);
  const byPeriod = new Map<string, NormalizedPeriod>();
  for (const periods of results) {
    for (const period of periods) {
      const key = `${period.periodType}:${period.period}`;
      const prior = byPeriod.get(key);
      if (!prior) {
        byPeriod.set(key, period);
        continue;
      }
      const metrics = { ...prior.metrics };
      for (const [metric, value] of Object.entries(period.metrics)) {
        const name = metric as keyof NormalizedMetrics;
        if (metrics[name] == null && typeof value === "number") metrics[name] = value;
      }
      byPeriod.set(key, { ...prior, metrics: normalizePeriodMetrics(metrics) });
    }
  }

  const periods = [...byPeriod.values()]
    .sort((a, b) => String(b.fiscalDate).localeCompare(String(a.fiscalDate)))
    .slice(0, limit);
  if (!periods.length) return null;
  return { periods, latencyMs: Math.round(performance.now() - started), profile };
}

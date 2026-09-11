import "server-only";
import type { NormalizedMetrics } from "./types";
import { getIndustryProfile } from "./industry-profiles";

/**
 * Chuẩn hóa tên chỉ tiêu BCTC theo 2 bộ:
 * - nonbank: DN sản xuất / thương mại / dịch vụ (VAS thông thường)
 * - bank: ngân hàng (mẫu BCTC đặc thù)
 * itemCodes bám itemVnName DStock (api-finfo financial_models).
 */

export type MetricKey = keyof NormalizedMetrics;
export type StatementKind = "income" | "balance" | "cashflow";
export type MetricProfile = "bank" | "nonbank";

export interface MetricDefinition {
  key: MetricKey;
  labelVi: string;
  labelEn: string;
  labelViBank?: string;
  labelEnBank?: string;
  statement: StatementKind;
  itemCodes?: number[];
  itemCodesBank?: number[];
  aliases?: string[];
  aliasesBank?: string[];
}

export const METRIC_DICTIONARY: MetricDefinition[] = [
  {
    key: "revenue",
    labelVi: "Doanh thu",
    labelEn: "Revenue",
    labelViBank: "Thu nhập lãi thuần",
    labelEnBank: "Net interest income",
    statement: "income",
    itemCodes: [21000],
    aliases: ["doanh thu", "tong doanh thu"],
  },
  {
    key: "netRevenue",
    labelVi: "Doanh thu thuần",
    labelEn: "Net revenue",
    statement: "income",
    itemCodes: [21001],
    aliases: ["doanh thu thuan"],
  },
  {
    key: "cogs",
    labelVi: "Giá vốn hàng bán",
    labelEn: "Cost of goods sold",
    statement: "income",
    itemCodes: [22100],
    aliases: ["gia von", "cogs"],
  },
  {
    key: "grossProfit",
    labelVi: "Lợi nhuận gộp",
    labelEn: "Gross profit",
    statement: "income",
    itemCodes: [23100],
    aliases: ["loi nhuan gop"],
  },
  {
    key: "operatingProfit",
    labelVi: "Lợi nhuận thuần từ hoạt động kinh doanh",
    labelEn: "Operating profit",
    statement: "income",
    itemCodes: [23110],
    aliases: ["loi nhuan tu hdkd"],
  },
  {
    key: "ebit",
    labelVi: "EBIT",
    labelEn: "EBIT",
    statement: "income",
    itemCodes: [23010],
    aliases: ["ebit"],
  },
  {
    key: "ebitda",
    labelVi: "EBITDA",
    labelEn: "EBITDA",
    statement: "income",
    itemCodes: [],
    aliases: ["ebitda"],
  },
  {
    key: "interestExpense",
    labelVi: "Chi phí lãi vay",
    labelEn: "Interest expense",
    statement: "income",
    itemCodes: [22510, 22500],
    aliases: ["chi phi lai vay"],
  },
  {
    key: "profitBeforeTax",
    labelVi: "Lợi nhuận kế toán trước thuế",
    labelEn: "Profit before tax",
    statement: "income",
    itemCodes: [23800],
    aliases: ["loi nhuan truoc thue"],
  },
  {
    key: "taxExpense",
    labelVi: "Chi phí thuế TNDN",
    labelEn: "Income tax expense",
    statement: "income",
    itemCodes: [22070, 23600],
    aliases: ["chi phi thue"],
  },
  {
    key: "netIncome",
    labelVi: "Lợi nhuận sau thuế",
    labelEn: "Net income",
    statement: "income",
    itemCodes: [23003],
    aliases: ["loi nhuan sau thue", "ln rong"],
  },
  {
    key: "netIncomeParent",
    labelVi: "LN sau thuế của công ty mẹ",
    labelEn: "Net income attributable to parent",
    statement: "income",
    itemCodes: [23000],
    aliases: ["ln cong ty me"],
  },
  {
    key: "cash",
    labelVi: "Tiền và tương đương tiền",
    labelEn: "Cash and cash equivalents",
    statement: "balance",
    itemCodes: [11100, 11110],
    aliases: ["tien"],
  },
  {
    key: "shortTermInvestments",
    labelVi: "Đầu tư tài chính ngắn hạn",
    labelEn: "Short-term investments",
    statement: "balance",
    itemCodes: [11200, 11210],
  },
  {
    key: "receivables",
    labelVi: "Phải thu ngắn hạn",
    labelEn: "Receivables",
    statement: "balance",
    itemCodes: [11300, 11310],
  },
  {
    key: "inventory",
    labelVi: "Hàng tồn kho",
    labelEn: "Inventory",
    statement: "balance",
    itemCodes: [11400, 11410],
  },
  {
    key: "currentAssets",
    labelVi: "Tài sản ngắn hạn",
    labelEn: "Current assets",
    statement: "balance",
    itemCodes: [11000],
  },
  {
    key: "fixedAssets",
    labelVi: "TSCĐ",
    labelEn: "Fixed assets",
    statement: "balance",
    itemCodes: [12100, 12110, 12180],
  },
  {
    key: "longTermAssets",
    labelVi: "Tài sản dài hạn",
    labelEn: "Long-term assets",
    statement: "balance",
    itemCodes: [12000],
  },
  {
    key: "totalAssets",
    labelVi: "Tổng tài sản",
    labelEn: "Total assets",
    statement: "balance",
    itemCodes: [14400, 12700],
  },
  {
    key: "shortTermDebt",
    labelVi: "Vay ngắn hạn",
    labelEn: "Short-term debt",
    statement: "balance",
    itemCodes: [13110],
  },
  {
    key: "longTermDebt",
    labelVi: "Vay dài hạn",
    labelEn: "Long-term debt",
    statement: "balance",
    itemCodes: [13300, 13340, 13200],
  },
  {
    key: "currentLiabilities",
    labelVi: "Nợ ngắn hạn",
    labelEn: "Current liabilities",
    statement: "balance",
    itemCodes: [13100],
  },
  {
    key: "totalLiabilities",
    labelVi: "Tổng nợ phải trả",
    labelEn: "Total liabilities",
    statement: "balance",
    itemCodes: [13000],
  },
  {
    key: "equity",
    labelVi: "Vốn chủ sở hữu",
    labelEn: "Equity",
    statement: "balance",
    itemCodes: [14000, 14100],
  },
  {
    key: "retainedEarnings",
    labelVi: "LN giữ lại",
    labelEn: "Retained earnings",
    statement: "balance",
    itemCodes: [14220],
  },
  {
    key: "operatingCashFlow",
    labelVi: "LC tiền thuần từ HĐKD",
    labelEn: "Operating cash flow",
    statement: "cashflow",
    itemCodes: [32000],
  },
  {
    key: "investingCashFlow",
    labelVi: "LC tiền thuần từ HĐ đầu tư",
    labelEn: "Investing cash flow",
    statement: "cashflow",
    itemCodes: [33000],
  },
  {
    key: "financingCashFlow",
    labelVi: "LC tiền thuần từ HĐ tài chính",
    labelEn: "Financing cash flow",
    statement: "cashflow",
    itemCodes: [34000],
  },
  {
    key: "capex",
    labelVi: "Capex (mua sắm TSCĐ)",
    labelEn: "Capex",
    statement: "cashflow",
    itemCodes: [32100],
  },
  {
    key: "freeCashFlow",
    labelVi: "FCF",
    labelEn: "Free cash flow",
    statement: "cashflow",
    itemCodes: [],
  },
  {
    key: "cashBegin",
    labelVi: "Tiền đầu kỳ",
    labelEn: "Cash beginning",
    statement: "cashflow",
    itemCodes: [36000],
  },
  {
    key: "cashEnd",
    labelVi: "Tiền cuối kỳ",
    labelEn: "Cash ending",
    statement: "cashflow",
    itemCodes: [37000],
  },
];

const BY_KEY = new Map(METRIC_DICTIONARY.map((d) => [d.key, d]));

export function getMetricDef(key: MetricKey): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function labelForMetric(key: MetricKey, lang: "vi" | "en" = "vi", profile: MetricProfile = "nonbank"): string {
  const d = BY_KEY.get(key);
  if (!d) return key;
  if (profile === "bank") {
    if (lang === "en") return d.labelEnBank ?? d.labelEn;
    return d.labelViBank ?? d.labelVi;
  }
  return lang === "en" ? d.labelEn : d.labelVi;
}

export function metricKeyFromItemCode(itemCode: number, profile: MetricProfile = "nonbank"): MetricKey | null {
  for (const d of METRIC_DICTIONARY) {
    const codes = profile === "bank" && d.itemCodesBank?.length ? d.itemCodesBank : d.itemCodes;
    if (codes?.includes(itemCode)) return d.key;
  }
  return null;
}

export function metricKeyFromAlias(alias: string, profile: MetricProfile = "nonbank"): MetricKey | null {
  const a = alias.trim().toLowerCase();
  for (const d of METRIC_DICTIONARY) {
    const list = profile === "bank" && d.aliasesBank?.length ? d.aliasesBank : d.aliases;
    if (list?.some((x) => x.toLowerCase() === a)) return d.key;
  }
  return null;
}

export function metricProfileForSymbol(symbolOrProfile?: string | MetricProfile): MetricProfile {
  if (symbolOrProfile === "bank" || symbolOrProfile === "nonbank") return symbolOrProfile;
  if (!symbolOrProfile) return "nonbank";
  const p = getIndustryProfile(String(symbolOrProfile));
  return p?.id === "bank" ? "bank" : "nonbank";
}

export const INCOME_METRIC_ORDER: MetricKey[] = [
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
];

export const BALANCE_METRIC_ORDER: MetricKey[] = [
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
];

export const CASHFLOW_METRIC_ORDER: MetricKey[] = [
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "capex",
  "freeCashFlow",
  "cashBegin",
  "cashEnd",
];

export function orderedKeysForProfile(statement: StatementKind, _profile: MetricProfile = "nonbank"): MetricKey[] {
  if (statement === "income") return INCOME_METRIC_ORDER;
  if (statement === "balance") return BALANCE_METRIC_ORDER;
  return CASHFLOW_METRIC_ORDER;
}

export function labeledMetricsForPeriod(
  metrics: NormalizedMetrics,
  statement: StatementKind,
  profile: MetricProfile = "nonbank",
  lang: "vi" | "en" = "vi",
): { key: MetricKey; label: string; labelEn: string; value: number | null }[] {
  const order = orderedKeysForProfile(statement, profile);
  return order.map((key) => ({
    key,
    label: labelForMetric(key, lang, profile),
    labelEn: labelForMetric(key, "en", profile),
    value: metrics[key] ?? null,
  }));
}

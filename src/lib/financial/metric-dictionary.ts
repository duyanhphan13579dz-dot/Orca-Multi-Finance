import "server-only";
import type { NormalizedMetrics } from "./types";

/**
 * Chuẩn hóa tên chỉ tiêu BCTC (VAS / VNDirect itemCode / alias SSC & tiếng Việt).
 * Key ổn định = NormalizedMetrics; labelVi/labelEn dùng cho UI bảng báo cáo.
 */

export type MetricKey = keyof NormalizedMetrics;

export interface MetricDefinition {
  key: MetricKey;
  labelVi: string;
  labelEn: string;
  statement: "income" | "balance" | "cashflow";
  /** VNDirect / VAS-style item codes commonly seen on finfo */
  itemCodes?: number[];
  /** Text aliases (stripped) from SSC PDF titles, CafeF, etc. */
  aliases?: string[];
}

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const METRIC_DICTIONARY: MetricDefinition[] = [
  // —— Income statement ——
  {
    key: "revenue",
    labelVi: "Doanh thu thuần",
    labelEn: "Net revenue",
    statement: "income",
    itemCodes: [21001, 21000],
    aliases: ["doanh thu", "doanh thu thuan", "net sales", "revenue", "net revenue"],
  },
  {
    key: "netRevenue",
    labelVi: "Doanh thu thuần về bán hàng và cung cấp dịch vụ",
    labelEn: "Net revenue from sales of goods and services",
    statement: "income",
    itemCodes: [21000],
    aliases: ["doanh thu thuan ve ban hang", "doanh thu thuan"],
  },
  {
    key: "cogs",
    labelVi: "Giá vốn hàng bán",
    labelEn: "Cost of goods sold",
    statement: "income",
    itemCodes: [22100],
    aliases: ["gia von hang ban", "cost of sales", "cogs", "gia von"],
  },
  {
    key: "grossProfit",
    labelVi: "Lợi nhuận gộp về bán hàng và cung cấp dịch vụ",
    labelEn: "Gross profit",
    statement: "income",
    itemCodes: [22200],
    aliases: ["loi nhuan gop", "gross profit", "lai gop"],
  },
  {
    key: "operatingProfit",
    labelVi: "Lợi nhuận thuần từ hoạt động kinh doanh",
    labelEn: "Operating profit",
    statement: "income",
    itemCodes: [23003],
    aliases: ["loi nhuan thuan tu hoat dong kinh doanh", "operating profit", "loi nhuan tu hdkd"],
  },
  {
    key: "ebit",
    labelVi: "EBIT (Lợi nhuận trước lãi vay và thuế)",
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
    itemCodes: [23100],
    aliases: ["ebitda"],
  },
  {
    key: "interestExpense",
    labelVi: "Chi phí lãi vay",
    labelEn: "Interest expense",
    statement: "income",
    itemCodes: [22510],
    aliases: ["chi phi lai vay", "interest expense", "lai vay"],
  },
  {
    key: "profitBeforeTax",
    labelVi: "Tổng lợi nhuận kế toán trước thuế",
    labelEn: "Profit before tax",
    statement: "income",
    itemCodes: [23000],
    aliases: ["loi nhuan truoc thue", "profit before tax", "tong loi nhuan ke toan truoc thue"],
  },
  {
    key: "taxExpense",
    labelVi: "Chi phí thuế TNDN",
    labelEn: "Income tax expense",
    statement: "income",
    itemCodes: [23600],
    aliases: ["chi phi thue", "thue tndn", "income tax"],
  },
  {
    key: "netIncome",
    labelVi: "Lợi nhuận sau thuế thu nhập doanh nghiệp",
    labelEn: "Net income",
    statement: "income",
    itemCodes: [23800],
    aliases: ["loi nhuan sau thue", "net income", "net profit", "lai rong"],
  },
  {
    key: "netIncomeParent",
    labelVi: "Lợi nhuận sau thuế của cổ đông công ty mẹ",
    labelEn: "Net income attributable to parent",
    statement: "income",
    itemCodes: [23810],
    aliases: ["loi nhuan sau thue cua co dong cong ty me", "parent net income"],
  },

  // —— Balance sheet ——
  {
    key: "cash",
    labelVi: "Tiền và các khoản tương đương tiền",
    labelEn: "Cash and cash equivalents",
    statement: "balance",
    itemCodes: [11100, 11110],
    aliases: ["tien va cac khoan tuong duong tien", "cash", "tien"],
  },
  {
    key: "shortTermInvestments",
    labelVi: "Đầu tư tài chính ngắn hạn",
    labelEn: "Short-term investments",
    statement: "balance",
    itemCodes: [11200, 11210],
    aliases: ["dau tu tai chinh ngan han", "short term investments"],
  },
  {
    key: "receivables",
    labelVi: "Các khoản phải thu ngắn hạn",
    labelEn: "Short-term receivables",
    statement: "balance",
    itemCodes: [11300, 11310],
    aliases: ["cac khoan phai thu ngan han", "receivables", "phai thu"],
  },
  {
    key: "inventory",
    labelVi: "Hàng tồn kho",
    labelEn: "Inventories",
    statement: "balance",
    itemCodes: [11400, 11410],
    aliases: ["hang ton kho", "inventories", "inventory"],
  },
  {
    key: "currentAssets",
    labelVi: "Tài sản ngắn hạn",
    labelEn: "Current assets",
    statement: "balance",
    itemCodes: [11000],
    aliases: ["tai san ngan han", "current assets"],
  },
  {
    key: "fixedAssets",
    labelVi: "Tài sản cố định",
    labelEn: "Fixed assets",
    statement: "balance",
    itemCodes: [12100, 12110],
    aliases: ["tai san co dinh", "fixed assets"],
  },
  {
    key: "longTermAssets",
    labelVi: "Tài sản dài hạn",
    labelEn: "Non-current assets",
    statement: "balance",
    itemCodes: [12000],
    aliases: ["tai san dai han", "long term assets", "non current assets"],
  },
  {
    key: "totalAssets",
    labelVi: "Tổng cộng tài sản",
    labelEn: "Total assets",
    statement: "balance",
    itemCodes: [14400],
    aliases: ["tong cong tai san", "tong tai san", "total assets"],
  },
  {
    key: "shortTermDebt",
    labelVi: "Vay và nợ thuê tài chính ngắn hạn",
    labelEn: "Short-term borrowings",
    statement: "balance",
    itemCodes: [13110],
    aliases: ["vay ngan han", "short term debt", "vay va no thue tai chinh ngan han"],
  },
  {
    key: "longTermDebt",
    labelVi: "Vay và nợ thuê tài chính dài hạn",
    labelEn: "Long-term borrowings",
    statement: "balance",
    itemCodes: [13200],
    aliases: ["vay dai han", "long term debt"],
  },
  {
    key: "currentLiabilities",
    labelVi: "Nợ ngắn hạn",
    labelEn: "Current liabilities",
    statement: "balance",
    itemCodes: [13100],
    aliases: ["no ngan han", "current liabilities"],
  },
  {
    key: "totalLiabilities",
    labelVi: "Nợ phải trả",
    labelEn: "Total liabilities",
    statement: "balance",
    itemCodes: [13000],
    aliases: ["no phai tra", "tong no", "total liabilities"],
  },
  {
    key: "equity",
    labelVi: "Vốn chủ sở hữu",
    labelEn: "Owners' equity",
    statement: "balance",
    itemCodes: [14000],
    aliases: ["von chu so huu", "equity", "von chu"],
  },
  {
    key: "retainedEarnings",
    labelVi: "Lợi nhuận sau thuế chưa phân phối",
    labelEn: "Retained earnings",
    statement: "balance",
    itemCodes: [14220],
    aliases: ["loi nhuan chua phan phoi", "retained earnings"],
  },

  // —— Cash flow ——
  {
    key: "operatingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
    labelEn: "Net cash from operating activities",
    statement: "cashflow",
    itemCodes: [31200],
    aliases: ["luu chuyen tien tu hoat dong kinh doanh", "operating cash flow", "ocf"],
  },
  {
    key: "investingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động đầu tư",
    labelEn: "Net cash from investing activities",
    statement: "cashflow",
    itemCodes: [32000],
    aliases: ["luu chuyen tien tu hoat dong dau tu", "investing cash flow"],
  },
  {
    key: "financingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động tài chính",
    labelEn: "Net cash from financing activities",
    statement: "cashflow",
    itemCodes: [33000],
    aliases: ["luu chuyen tien tu hoat dong tai chinh", "financing cash flow"],
  },
  {
    key: "capex",
    labelVi: "Chi đầu tư TSCĐ và tài sản dài hạn khác",
    labelEn: "Capital expenditure",
    statement: "cashflow",
    itemCodes: [32100],
    aliases: ["capex", "mua sam tscd", "chi tieu dau tu"],
  },
  {
    key: "freeCashFlow",
    labelVi: "Dòng tiền tự do (FCF)",
    labelEn: "Free cash flow",
    statement: "cashflow",
    aliases: ["free cash flow", "fcf", "dong tien tu do"],
  },
  {
    key: "cashBegin",
    labelVi: "Tiền và tương đương tiền đầu kỳ",
    labelEn: "Cash at beginning of period",
    statement: "cashflow",
    itemCodes: [36000],
    aliases: ["tien dau ky"],
  },
  {
    key: "cashEnd",
    labelVi: "Tiền và tương đương tiền cuối kỳ",
    labelEn: "Cash at end of period",
    statement: "cashflow",
    itemCodes: [37000],
    aliases: ["tien cuoi ky"],
  },
];

const BY_KEY = new Map(METRIC_DICTIONARY.map((d) => [d.key, d]));
const BY_CODE = new Map<number, MetricDefinition>();
for (const d of METRIC_DICTIONARY) {
  for (const c of d.itemCodes ?? []) BY_CODE.set(c, d);
}

export function getMetricDef(key: MetricKey): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function labelForMetric(key: MetricKey, lang: "vi" | "en" = "vi"): string {
  const d = BY_KEY.get(key);
  if (!d) return key;
  return lang === "en" ? d.labelEn : d.labelVi;
}

/** Map VNDirect itemCode → stable metric key */
export function metricKeyFromItemCode(itemCode: number): MetricKey | null {
  return BY_CODE.get(itemCode)?.key ?? null;
}

/** Resolve free-text line title (SSC / PDF / CafeF) → metric key */
export function metricKeyFromAlias(text: string): MetricKey | null {
  const s = strip(text);
  if (!s) return null;
  // exact / includes match on aliases, longest first
  let best: { key: MetricKey; len: number } | null = null;
  for (const d of METRIC_DICTIONARY) {
    for (const a of d.aliases ?? []) {
      const sa = strip(a);
      if (!sa) continue;
      if (s === sa || s.includes(sa) || sa.includes(s)) {
        if (!best || sa.length > best.len) best = { key: d.key, len: sa.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Display order for UI tables */
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

/** Build labeled rows for one period (UI-friendly). */
export function labeledMetricsForPeriod(
  metrics: NormalizedMetrics,
  statement: "income" | "balance" | "cashflow",
  lang: "vi" | "en" = "vi",
): { key: MetricKey; label: string; labelEn: string; value: number | null }[] {
  const order =
    statement === "income"
      ? INCOME_METRIC_ORDER
      : statement === "balance"
        ? BALANCE_METRIC_ORDER
        : CASHFLOW_METRIC_ORDER;
  return order.map((key) => {
    const d = BY_KEY.get(key);
    return {
      key,
      label: d ? (lang === "en" ? d.labelEn : d.labelVi) : key,
      labelEn: d?.labelEn ?? key,
      value: metrics[key] ?? null,
    };
  });
}

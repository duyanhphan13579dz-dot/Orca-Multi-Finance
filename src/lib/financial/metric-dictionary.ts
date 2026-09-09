import "server-only";
import type { NormalizedMetrics } from "./types";
import { getIndustryProfile } from "./industry-profiles";

/**
 * Chuẩn hóa tên chỉ tiêu BCTC theo 2 bộ:
 * - nonbank: DN sản xuất / thương mại / dịch vụ (VAS thông thường)
 * - bank: ngân hàng (mẫu BCTC đặc thù — thu nhập lãi, dư nợ, ...)
 */

export type MetricKey = keyof NormalizedMetrics;
export type StatementKind = "income" | "balance" | "cashflow";
export type MetricProfile = "bank" | "nonbank";

export interface MetricDefinition {
  key: MetricKey;
  /** Label mặc định (non-bank) */
  labelVi: string;
  labelEn: string;
  /** Override khi profile = bank */
  labelViBank?: string;
  labelEnBank?: string;
  statement: StatementKind;
  itemCodes?: number[];
  /** itemCode ưu tiên khi là ngân hàng (nếu khác non-bank) */
  itemCodesBank?: number[];
  aliases?: string[];
  aliasesBank?: string[];
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
  // —— Income ——
  {
    key: "revenue",
    labelVi: "Doanh thu thuần",
    labelEn: "Net revenue",
    labelViBank: "Thu nhập lãi thuần",
    labelEnBank: "Net interest income",
    statement: "income",
    itemCodes: [21001, 21000],
    aliases: ["doanh thu", "doanh thu thuan", "net sales", "revenue", "net revenue"],
    aliasesBank: ["thu nhap lai thuan", "net interest income", "lai thuan"],
  },
  {
    key: "netRevenue",
    labelVi: "Doanh thu thuần về bán hàng và cung cấp dịch vụ",
    labelEn: "Net revenue from sales of goods and services",
    labelViBank: "Tổng thu nhập hoạt động",
    labelEnBank: "Total operating income",
    statement: "income",
    itemCodes: [21000],
    aliases: ["doanh thu thuan ve ban hang", "doanh thu thuan"],
    aliasesBank: ["tong thu nhap hoat dong", "total operating income"],
  },
  {
    key: "cogs",
    labelVi: "Giá vốn hàng bán",
    labelEn: "Cost of goods sold",
    labelViBank: "Chi phí lãi và các chi phí tương tự",
    labelEnBank: "Interest and similar expenses",
    statement: "income",
    itemCodes: [22100],
    aliases: ["gia von hang ban", "cost of sales", "cogs", "gia von"],
    aliasesBank: ["chi phi lai", "interest expense", "chi phi lai va cac chi phi tuong tu"],
  },
  {
    key: "grossProfit",
    labelVi: "Lợi nhuận gộp về bán hàng và cung cấp dịch vụ",
    labelEn: "Gross profit",
    labelViBank: "Thu nhập lãi thuần sau dự phòng",
    labelEnBank: "Net interest income after provisions",
    statement: "income",
    itemCodes: [22200],
    aliases: ["loi nhuan gop", "gross profit", "lai gop"],
    aliasesBank: ["thu nhap lai thuan sau du phong"],
  },
  {
    key: "operatingProfit",
    labelVi: "Lợi nhuận thuần từ hoạt động kinh doanh",
    labelEn: "Operating profit",
    labelViBank: "Lợi nhuận thuần từ hoạt động kinh doanh trước chi phí dự phòng rủi ro tín dụng",
    labelEnBank: "Profit from banking activities before credit provisions",
    statement: "income",
    itemCodes: [23003],
    aliases: ["loi nhuan thuan tu hoat dong kinh doanh", "operating profit", "loi nhuan tu hdkd"],
    aliasesBank: ["loi nhuan tu hoat dong ngan hang", "profit from banking"],
  },
  {
    key: "ebit",
    labelVi: "EBIT (Lợi nhuận trước lãi vay và thuế)",
    labelEn: "EBIT",
    labelViBank: "Lợi nhuận trước dự phòng và thuế",
    labelEnBank: "Profit before provisions and tax",
    statement: "income",
    itemCodes: [23010],
    aliases: ["ebit"],
  },
  {
    key: "ebitda",
    labelVi: "EBITDA",
    labelEn: "EBITDA",
    labelViBank: "Lợi nhuận trước dự phòng, khấu hao và thuế",
    labelEnBank: "Profit before provisions, depreciation and tax",
    statement: "income",
    itemCodes: [23100],
    aliases: ["ebitda"],
  },
  {
    key: "interestExpense",
    labelVi: "Chi phí lãi vay",
    labelEn: "Interest expense",
    labelViBank: "Chi phí lãi và các chi phí tương tự",
    labelEnBank: "Interest and similar expenses",
    statement: "income",
    itemCodes: [22510],
    aliases: ["chi phi lai vay", "interest expense", "lai vay"],
    aliasesBank: ["chi phi lai", "chi phi lai va cac chi phi tuong tu"],
  },
  {
    key: "profitBeforeTax",
    labelVi: "Tổng lợi nhuận kế toán trước thuế",
    labelEn: "Profit before tax",
    labelViBank: "Tổng lợi nhuận trước thuế",
    labelEnBank: "Profit before tax",
    statement: "income",
    itemCodes: [23000],
    aliases: ["loi nhuan truoc thue", "profit before tax", "tong loi nhuan ke toan truoc thue"],
  },
  {
    key: "taxExpense",
    labelVi: "Chi phí thuế TNDN",
    labelEn: "Income tax expense",
    labelViBank: "Chi phí thuế thu nhập doanh nghiệp",
    labelEnBank: "Corporate income tax expense",
    statement: "income",
    itemCodes: [23600],
    aliases: ["chi phi thue", "thue tndn", "income tax"],
  },
  {
    key: "netIncome",
    labelVi: "Lợi nhuận sau thuế thu nhập doanh nghiệp",
    labelEn: "Net income",
    labelViBank: "Lợi nhuận sau thuế",
    labelEnBank: "Profit after tax",
    statement: "income",
    itemCodes: [23800],
    aliases: ["loi nhuan sau thue", "net income", "net profit", "lai rong"],
  },
  {
    key: "netIncomeParent",
    labelVi: "Lợi nhuận sau thuế của cổ đông công ty mẹ",
    labelEn: "Net income attributable to parent",
    labelViBank: "Lợi nhuận sau thuế của cổ đông ngân hàng mẹ",
    labelEnBank: "Profit attributable to equity holders of the Bank",
    statement: "income",
    itemCodes: [23810],
    aliases: ["loi nhuan sau thue cua co dong cong ty me", "parent net income"],
    aliasesBank: ["loi nhuan sau thue cua co dong ngan hang me"],
  },

  // —— Balance ——
  {
    key: "cash",
    labelVi: "Tiền và các khoản tương đương tiền",
    labelEn: "Cash and cash equivalents",
    labelViBank: "Tiền mặt, vàng bạc, đá quý",
    labelEnBank: "Cash, gold and gemstones",
    statement: "balance",
    itemCodes: [11100, 11110],
    aliases: ["tien va cac khoan tuong duong tien", "cash", "tien"],
    aliasesBank: ["tien mat vang bac", "cash gold"],
  },
  {
    key: "shortTermInvestments",
    labelVi: "Đầu tư tài chính ngắn hạn",
    labelEn: "Short-term investments",
    labelViBank: "Chứng khoán kinh doanh",
    labelEnBank: "Trading securities",
    statement: "balance",
    itemCodes: [11200, 11210],
    aliases: ["dau tu tai chinh ngan han", "short term investments"],
    aliasesBank: ["chung khoan kinh doanh", "trading securities"],
  },
  {
    key: "receivables",
    labelVi: "Các khoản phải thu ngắn hạn",
    labelEn: "Short-term receivables",
    labelViBank: "Các khoản phải thu",
    labelEnBank: "Receivables",
    statement: "balance",
    itemCodes: [11300, 11310],
    aliases: ["cac khoan phai thu ngan han", "receivables", "phai thu"],
  },
  {
    key: "inventory",
    labelVi: "Hàng tồn kho",
    labelEn: "Inventories",
    labelViBank: "— (không áp dụng NH)",
    labelEnBank: "— (N/A for banks)",
    statement: "balance",
    itemCodes: [11400, 11410],
    aliases: ["hang ton kho", "inventories", "inventory"],
  },
  {
    key: "currentAssets",
    labelVi: "Tài sản ngắn hạn",
    labelEn: "Current assets",
    labelViBank: "Tổng tài sản có",
    labelEnBank: "Total assets (bank)",
    statement: "balance",
    itemCodes: [11000],
    aliases: ["tai san ngan han", "current assets"],
    aliasesBank: ["tong tai san co"],
  },
  {
    key: "fixedAssets",
    labelVi: "Tài sản cố định",
    labelEn: "Fixed assets",
    labelViBank: "Tài sản cố định",
    labelEnBank: "Fixed assets",
    statement: "balance",
    itemCodes: [12100, 12110],
    aliases: ["tai san co dinh", "fixed assets"],
  },
  {
    key: "longTermAssets",
    labelVi: "Tài sản dài hạn",
    labelEn: "Non-current assets",
    labelViBank: "Tài sản khác",
    labelEnBank: "Other assets",
    statement: "balance",
    itemCodes: [12000],
    aliases: ["tai san dai han", "long term assets", "non current assets"],
  },
  {
    key: "totalAssets",
    labelVi: "Tổng cộng tài sản",
    labelEn: "Total assets",
    labelViBank: "Tổng tài sản",
    labelEnBank: "Total assets",
    statement: "balance",
    itemCodes: [14400],
    aliases: ["tong cong tai san", "tong tai san", "total assets"],
  },
  {
    key: "shortTermDebt",
    labelVi: "Vay và nợ thuê tài chính ngắn hạn",
    labelEn: "Short-term borrowings",
    labelViBank: "Tiền gửi và vay các TCTD khác",
    labelEnBank: "Deposits and borrowings from other credit institutions",
    statement: "balance",
    itemCodes: [13110],
    aliases: ["vay ngan han", "short term debt", "vay va no thue tai chinh ngan han"],
    aliasesBank: ["tien gui va vay cac tctd", "deposits from credit institutions"],
  },
  {
    key: "longTermDebt",
    labelVi: "Vay và nợ thuê tài chính dài hạn",
    labelEn: "Long-term borrowings",
    labelViBank: "Phát hành giấy tờ có giá",
    labelEnBank: "Valuable papers issued",
    statement: "balance",
    itemCodes: [13200],
    aliases: ["vay dai han", "long term debt"],
    aliasesBank: ["phat hanh giay to co gia", "valuable papers"],
  },
  {
    key: "currentLiabilities",
    labelVi: "Nợ ngắn hạn",
    labelEn: "Current liabilities",
    labelViBank: "Tiền gửi của khách hàng",
    labelEnBank: "Customer deposits",
    statement: "balance",
    itemCodes: [13100],
    aliases: ["no ngan han", "current liabilities"],
    aliasesBank: ["tien gui cua khach hang", "customer deposits", "tien gui khach hang"],
  },
  {
    key: "totalLiabilities",
    labelVi: "Nợ phải trả",
    labelEn: "Total liabilities",
    labelViBank: "Tổng nợ phải trả",
    labelEnBank: "Total liabilities",
    statement: "balance",
    itemCodes: [13000],
    aliases: ["no phai tra", "tong no", "total liabilities"],
  },
  {
    key: "equity",
    labelVi: "Vốn chủ sở hữu",
    labelEn: "Owners' equity",
    labelViBank: "Vốn chủ sở hữu",
    labelEnBank: "Owners' equity",
    statement: "balance",
    itemCodes: [14000],
    aliases: ["von chu so huu", "equity", "von chu"],
  },
  {
    key: "retainedEarnings",
    labelVi: "Lợi nhuận sau thuế chưa phân phối",
    labelEn: "Retained earnings",
    labelViBank: "Lợi nhuận chưa phân phối",
    labelEnBank: "Undistributed profits",
    statement: "balance",
    itemCodes: [14220],
    aliases: ["loi nhuan chua phan phoi", "retained earnings"],
  },

  // —— Cash flow ——
  {
    key: "operatingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
    labelEn: "Net cash from operating activities",
    labelViBank: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
    labelEnBank: "Net cash from operating activities",
    statement: "cashflow",
    itemCodes: [31200],
    aliases: ["luu chuyen tien tu hoat dong kinh doanh", "operating cash flow", "ocf"],
  },
  {
    key: "investingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động đầu tư",
    labelEn: "Net cash from investing activities",
    labelViBank: "Lưu chuyển tiền thuần từ hoạt động đầu tư",
    labelEnBank: "Net cash from investing activities",
    statement: "cashflow",
    itemCodes: [32000],
    aliases: ["luu chuyen tien tu hoat dong dau tu", "investing cash flow"],
  },
  {
    key: "financingCashFlow",
    labelVi: "Lưu chuyển tiền thuần từ hoạt động tài chính",
    labelEn: "Net cash from financing activities",
    labelViBank: "Lưu chuyển tiền thuần từ hoạt động tài chính",
    labelEnBank: "Net cash from financing activities",
    statement: "cashflow",
    itemCodes: [33000],
    aliases: ["luu chuyen tien tu hoat dong tai chinh", "financing cash flow"],
  },
  {
    key: "capex",
    labelVi: "Chi đầu tư TSCĐ và tài sản dài hạn khác",
    labelEn: "Capital expenditure",
    labelViBank: "Chi đầu tư TSCĐ",
    labelEnBank: "Purchases of fixed assets",
    statement: "cashflow",
    itemCodes: [32100],
    aliases: ["capex", "mua sam tscd", "chi tieu dau tu"],
  },
  {
    key: "freeCashFlow",
    labelVi: "Dòng tiền tự do (FCF)",
    labelEn: "Free cash flow",
    labelViBank: "Dòng tiền tự do (FCF)",
    labelEnBank: "Free cash flow",
    statement: "cashflow",
    aliases: ["free cash flow", "fcf", "dong tien tu do"],
  },
  {
    key: "cashBegin",
    labelVi: "Tiền và tương đương tiền đầu kỳ",
    labelEn: "Cash at beginning of period",
    labelViBank: "Tiền và tương đương tiền đầu kỳ",
    labelEnBank: "Cash at beginning of period",
    statement: "cashflow",
    itemCodes: [36000],
    aliases: ["tien dau ky"],
  },
  {
    key: "cashEnd",
    labelVi: "Tiền và tương đương tiền cuối kỳ",
    labelEn: "Cash at end of period",
    labelViBank: "Tiền và tương đương tiền cuối kỳ",
    labelEnBank: "Cash at end of period",
    statement: "cashflow",
    itemCodes: [37000],
    aliases: ["tien cuoi ky"],
  },
];

const BY_KEY = new Map(METRIC_DICTIONARY.map((d) => [d.key, d]));
const BY_CODE = new Map<number, MetricDefinition>();
const BY_CODE_BANK = new Map<number, MetricDefinition>();
for (const d of METRIC_DICTIONARY) {
  for (const c of d.itemCodes ?? []) BY_CODE.set(c, d);
  for (const c of d.itemCodesBank ?? d.itemCodes ?? []) BY_CODE_BANK.set(c, d);
}

/** Detect bank vs non-bank from ticker (uses industry profile). */
export function metricProfileForSymbol(symbol?: string | null): MetricProfile {
  if (!symbol) return "nonbank";
  try {
    const p = getIndustryProfile(symbol);
    return p.id === "BANKING" ? "bank" : "nonbank";
  } catch {
    return "nonbank";
  }
}

export function getMetricDef(key: MetricKey): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function labelForMetric(
  key: MetricKey,
  lang: "vi" | "en" = "vi",
  profile: MetricProfile = "nonbank",
): string {
  const d = BY_KEY.get(key);
  if (!d) return key;
  if (profile === "bank") {
    if (lang === "en") return d.labelEnBank ?? d.labelEn;
    return d.labelViBank ?? d.labelVi;
  }
  return lang === "en" ? d.labelEn : d.labelVi;
}

export function metricKeyFromItemCode(
  itemCode: number,
  profile: MetricProfile = "nonbank",
): MetricKey | null {
  const map = profile === "bank" ? BY_CODE_BANK : BY_CODE;
  return map.get(itemCode)?.key ?? BY_CODE.get(itemCode)?.key ?? null;
}

export function metricKeyFromAlias(
  text: string,
  profile: MetricProfile = "nonbank",
): MetricKey | null {
  const s = strip(text);
  if (!s) return null;
  let best: { key: MetricKey; len: number } | null = null;
  for (const d of METRIC_DICTIONARY) {
    const list =
      profile === "bank"
        ? [...(d.aliasesBank ?? []), ...(d.aliases ?? [])]
        : [...(d.aliases ?? []), ...(d.aliasesBank ?? [])];
    for (const a of list) {
      const sa = strip(a);
      if (!sa) continue;
      if (s === sa || s.includes(sa) || sa.includes(s)) {
        if (!best || sa.length > best.len) best = { key: d.key, len: sa.length };
      }
    }
  }
  return best?.key ?? null;
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

/** Non-bank: hide pure N/A bank-only presentation; bank: skip inventory when null. */
export function orderedKeysForProfile(
  statement: StatementKind,
  profile: MetricProfile,
): MetricKey[] {
  const base =
    statement === "income"
      ? INCOME_METRIC_ORDER
      : statement === "balance"
        ? BALANCE_METRIC_ORDER
        : CASHFLOW_METRIC_ORDER;
  if (profile === "bank") {
    return base.filter((k) => k !== "inventory");
  }
  return base;
}

export function labeledMetricsForPeriod(
  metrics: NormalizedMetrics,
  statement: StatementKind,
  lang: "vi" | "en" = "vi",
  profile: MetricProfile = "nonbank",
): { key: MetricKey; label: string; labelEn: string; value: number | null }[] {
  const order = orderedKeysForProfile(statement, profile);
  return order.map((key) => ({
    key,
    label: labelForMetric(key, lang, profile),
    labelEn: labelForMetric(key, "en", profile),
    value: metrics[key] ?? null,
  }));
}

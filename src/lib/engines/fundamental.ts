import "server-only";
import { getIndustryProfile } from "../financial/industry-profiles";

/**
 * FINANCIAL HEALTH ENGINE — deterministic ratio computation from financial
 * statement rows (any provider shape; alias-based extraction). Pure code: the
 * LLM layer only ever receives these calculated results.
 * Phase 4 complete: industry weights + expanded ratios + risk flags.
 * Phase 1 valuation: anchors.cash exported for EV.
 *
 * Perf: pre-index row keys + sort each statement once (indexAndSort).
 */

type Row = Record<string, unknown>;

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

type RowIndex = { row: Row; keys: string[]; stripped: string[] };

function indexRow(row: Row): RowIndex {
  const keys = Object.keys(row);
  return { row, keys, stripped: keys.map(strip) };
}

function findNumIndexed(ix: RowIndex, aliases: string[]): number | null {
  const { row, keys, stripped } = ix;
  for (const alias of aliases) {
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i].includes(alias)) {
        const v = row[keys[i]];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (v != null) {
          const n = Number(String(v).replace(/[,.]/g, (m) => (m === "," ? "" : m)));
          if (Number.isFinite(n)) return n;
        }
      }
    }
  }
  return null;
}

function findNum(row: Row, aliases: string[]): number | null {
  return findNumIndexed(indexRow(row), aliases);
}

const PERIOD_AL = ["year", "nam", "periodyear"];
const QUARTER_AL = ["quarter", "quy", "periodquarter", "lengthyear"];

function periodScoreIndexed(ix: RowIndex): number {
  const y = findNumIndexed(ix, PERIOD_AL) ?? 0;
  const q = findNumIndexed(ix, QUARTER_AL) ?? 0;
  return y * 10 + q;
}

function indexAndSort(rows: Row[]): RowIndex[] {
  const indexed = rows.map(indexRow);
  indexed.sort((a, b) => periodScoreIndexed(b) - periodScoreIndexed(a));
  return indexed;
}

function latestIndexed(sorted: RowIndex[], aliases: string[]): number | null {
  for (const ix of sorted) {
    const v = findNumIndexed(ix, aliases);
    if (v != null) return v;
  }
  return null;
}

function ttmIndexed(sorted: RowIndex[], aliases: string[]): number | null {
  const vals: number[] = [];
  for (const ix of sorted.slice(0, 6)) {
    const v = findNumIndexed(ix, aliases);
    if (v != null) vals.push(v);
    if (vals.length === 4) break;
  }
  if (vals.length >= 2) return vals.reduce((a, b) => a + b, 0);
  return latestIndexed(sorted, aliases);
}

function newestFirst(rows: Row[]): Row[] {
  return indexAndSort(rows).map((ix) => ix.row);
}

function latest(rows: Row[], aliases: string[]): number | null {
  return latestIndexed(indexAndSort(rows), aliases);
}

function ttm(rows: Row[], aliases: string[]): number | null {
  return ttmIndexed(indexAndSort(rows), aliases);
}

const AL = {
  revenue: ["revenue", "netsales", "netrevenue", "doanhthuthuan", "doanhthu"],
  grossProfit: ["grossprofit", "loinhuangop"],
  ebit: ["ebit", "operatingprofit", "loinhuantumohinhkinhdoanh", "loinhuantuhdkd"],
  ebitda: ["ebitda"],
  interestExpense: ["interestexpense", "chiphilaivay", "laivay"],
  netProfit: ["netprofit", "profitfortheyear", "loinhuansauthue", "loinhuanrong", "sauthue", "netincome"],
  totalAssets: ["totalassets", "tongtaisan", "tongcongtaisan"],
  currentAssets: ["currentassets", "taisannganhan", "taisannh"],
  totalLiabilities: ["totalliabilities", "nophaitra", "tongno"],
  currentLiabilities: ["currentliabilities", "nonganhan"],
  equity: ["equity", "vonchusohuu", "ownerequity"],
  cash: ["cashandequivalents", "cashequivalents", "tienvatuongduong"],
  shortDebt: ["shorttermdebt", "vaynganhan"],
  longDebt: ["longtermdebt", "vaydaihan"],
  inventory: ["inventories", "inventory", "hangtonkho"],
  receivables: ["shorttermreceivables", "receivables", "phaithu"],
  ocf: ["netcashflowoperating", "operatingcashflow", "cashfromoperations", "luuchuyentientuhoatdongkd"],
  capex: ["capex", "muasamtscd", "chitieudautu"],
  buyInvest: ["purchasesoffixedassets", "muasamxaydungtscd"],
  dividends: ["dividendspaid", "cotucdachia", "cotuc"],
  eps: ["eps", "loinhuancobantrencophieu"],
  bvps: ["bvps", "bookvaluepershare"],
  shares: ["sharesoutstanding", "soluongcophieuluuhanh", "listedshare", "cophieuluuhanh"],
};

export type RatioSet = Record<string, number | null>;

export interface FinancialHealthResult {
  groups: {
    profitability: RatioSet;
    liquidity: RatioSet;
    leverage: RatioSet;
    cashflow: RatioSet;
    efficiency: RatioSet;
  };
  scores: {
    profitability: number | null;
    liquidity: number | null;
    leverage: number | null;
    cashflow: number | null;
    efficiency: number | null;
    overall: number | null;
  };
  coverage: number;
  warnings: string[];
  riskFlags: string[];
  industry: { id: string; labelVi: string; note: string } | null;
  anchors: {
    revenue: number | null;
    netProfit: number | null;
    equity: number | null;
    totalDebt: number | null;
    cash: number | null;
    ocfTtm: number | null;
    fcfTtm: number | null;
    shares: number | null;
    epsTtm: number | null;
    ebitdaTtm: number | null;
  };
}

const div = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b !== 0 ? a / b : null;
const zz = (v: number | null, digits = 2) => (v == null ? null : Number(v.toFixed(digits)));

export function computeFinancialHealth(
  input: { income: Row[]; balance: Row[]; cashflow: Row[] },
  opts?: { symbol?: string },
): FinancialHealthResult {
  const { income, balance, cashflow } = input;
  const warnings: string[] = [];
  const riskFlags: string[] = [];
  const anyData = income.length + balance.length + cashflow.length > 0;
  if (!anyData) {
    return {
      groups: { profitability: {}, liquidity: {}, leverage: {}, cashflow: {}, efficiency: {} },
      scores: { profitability: null, liquidity: null, leverage: null, cashflow: null, efficiency: null, overall: null },
      coverage: 0,
      warnings: ["Không có dữ liệu báo cáo tài chính từ provider"],
      riskFlags: [],
      industry: null,
      anchors: {
        revenue: null,
        netProfit: null,
        equity: null,
        totalDebt: null,
        cash: null,
        ocfTtm: null,
        fcfTtm: null,
        shares: null,
        epsTtm: null,
        ebitdaTtm: null,
      },
    };
  }

  const inc = indexAndSort(income);
  const bal = indexAndSort(balance);
  const cf = indexAndSort(cashflow);

  const revenue = ttmIndexed(inc, AL.revenue) ?? latestIndexed(inc, AL.revenue);
  const grossProfit = ttmIndexed(inc, AL.grossProfit);
  const ebit = ttmIndexed(inc, AL.ebit);
  const ebitdaTtm = ttmIndexed(inc, AL.ebitda) ?? (ebit != null ? ebit * 1.15 : null);
  const netProfit = ttmIndexed(inc, AL.netProfit) ?? latestIndexed(inc, AL.netProfit);
  const interestExpense = ttmIndexed(inc, AL.interestExpense);

  const totalAssets = latestIndexed(bal, AL.totalAssets);
  const currentAssets = latestIndexed(bal, AL.currentAssets);
  const totalLiabilities = latestIndexed(bal, AL.totalLiabilities);
  const currentLiabilities = latestIndexed(bal, AL.currentLiabilities);
  const equity = latestIndexed(bal, AL.equity);
  const cash = latestIndexed(bal, AL.cash);
  const shortDebtRaw = latestIndexed(bal, AL.shortDebt);
  const longDebtRaw = latestIndexed(bal, AL.longDebt);
  const shortDebt = shortDebtRaw ?? 0;
  const longDebt = longDebtRaw ?? 0;
  const totalDebt =
    shortDebtRaw != null || longDebtRaw != null ? shortDebt + longDebt : totalLiabilities;
  const inventory = latestIndexed(bal, AL.inventory);
  const receivables = latestIndexed(bal, AL.receivables);

  const ocfTtm = ttmIndexed(cf, AL.ocf);
  const capexTtm = cf.length
    ? Math.abs(ttmIndexed(cf, AL.capex) ?? ttmIndexed(cf, AL.buyInvest) ?? 0)
    : null;
  const fcfTtm = ocfTtm != null && capexTtm != null ? ocfTtm - capexTtm : ocfTtm;
  const shares = latestIndexed(bal, AL.shares) ?? latestIndexed(inc, AL.shares);
  const epsTtm =
    latestIndexed(inc, AL.eps) ??
    (netProfit != null && shares ? netProfit / shares : null);

  // Keep findNum/newestFirst available for any residual use
  void findNum;
  void newestFirst;
  void ttm;
  void latest;

  const groups: FinancialHealthResult["groups"] = {
    profitability: {
      grossMargin: zz(div(grossProfit, revenue), 4),
      operatingMargin: zz(div(ebit, revenue), 4),
      netMargin: zz(div(netProfit, revenue), 4),
      roa: zz(div(netProfit, totalAssets), 4),
      roe: zz(div(netProfit, equity), 4),
      roic: zz(
        div(
          ebit != null ? ebit * 0.8 : null,
          totalDebt != null && equity != null ? totalDebt + equity - (cash ?? 0) : null,
        ),
        4,
      ),
    },
    liquidity: {
      currentRatio: zz(div(currentAssets, currentLiabilities), 2),
      quickRatio: zz(
        currentAssets != null && currentLiabilities != null
          ? (currentAssets - (inventory ?? 0)) / currentLiabilities
          : null,
        2,
      ),
      cashRatio: zz(div(cash, currentLiabilities), 2),
    },
    leverage: {
      debtToEquity: zz(div(totalDebt, equity), 2),
      debtToAssets: zz(div(totalDebt, totalAssets), 2),
      equityRatio: zz(div(equity, totalAssets), 2),
      interestCoverage: zz(div(ebit, interestExpense), 2),
      netDebtToEbitda: zz(
        div(
          totalDebt != null ? totalDebt - (cash ?? 0) : null,
          ebitdaTtm,
        ),
        2,
      ),
    },
    cashflow: {
      ocfToSales: zz(div(ocfTtm, revenue), 4),
      fcfToSales: zz(div(fcfTtm, revenue), 4),
      ocfToNi: zz(div(ocfTtm, netProfit), 2),
      fcfYieldProxy: zz(div(fcfTtm, equity), 4),
    },
    efficiency: {
      assetTurnover: zz(div(revenue, totalAssets), 2),
      inventoryDays:
        inventory != null && revenue != null && revenue > 0
          ? zz((inventory / (revenue / 365)), 0)
          : null,
      receivableDays:
        receivables != null && revenue != null && revenue > 0
          ? zz((receivables / (revenue / 365)), 0)
          : null,
    },
  };

  const profile = opts?.symbol ? getIndustryProfile(opts.symbol) : null;
  const industryMeta = profile
    ? { id: profile.id, labelVi: profile.labelVi, note: profile.note }
    : null;
  const w = profile?.weights ?? {
    profitability: 0.25,
    leverage: 0.2,
    cashflow: 0.2,
    liquidity: 0.15,
    efficiency: 0.2,
  };

  const scoreBand = (v: number | null, good: number, mid: number, invert = false): number | null => {
    if (v == null) return null;
    if (!invert) {
      if (v >= good) return 90;
      if (v >= mid) return 65;
      if (v > 0) return 40;
      return 20;
    }
    if (v <= good) return 90;
    if (v <= mid) return 65;
    if (v < mid * 2) return 40;
    return 20;
  };

  const sc = {
    profitability: avgDefined([
      scoreBand(groups.profitability.roe, 0.15, 0.08),
      scoreBand(groups.profitability.netMargin, 0.12, 0.05),
      scoreBand(groups.profitability.roic, 0.12, 0.06),
    ]),
    liquidity: avgDefined([
      scoreBand(groups.liquidity.currentRatio, 1.5, 1.0),
      scoreBand(groups.liquidity.quickRatio, 1.0, 0.7),
    ]),
    leverage: avgDefined([
      scoreBand(groups.leverage.debtToEquity, 1.0, 2.0, true),
      scoreBand(groups.leverage.interestCoverage, 3, 1.5),
    ]),
    cashflow: avgDefined([
      scoreBand(groups.cashflow.ocfToNi, 1.0, 0.6),
      scoreBand(groups.cashflow.fcfToSales, 0.08, 0.02),
    ]),
    efficiency: avgDefined([
      scoreBand(groups.efficiency.assetTurnover, 0.8, 0.4),
    ]),
  };

  const roe = groups.profitability.roe;
  const ic = groups.leverage.interestCoverage;
  const nde = groups.leverage.netDebtToEbitda;
  if (profile?.flags) {
    if (profile.flags.minInterestCoverage != null && ic != null && ic < profile.flags.minInterestCoverage) {
      riskFlags.push(`Interest coverage ${ic.toFixed(2)} dưới ngưỡng ngành ${profile.flags.minInterestCoverage}`);
    }
    if (profile.flags.maxNetDebtEbitda != null && nde != null && nde > profile.flags.maxNetDebtEbitda) {
      riskFlags.push(`Net debt/EBITDA ${nde.toFixed(2)} vượt ngưỡng ngành ${profile.flags.maxNetDebtEbitda}`);
    }
    if (profile.flags.minRoe != null && roe != null && roe < profile.flags.minRoe) {
      riskFlags.push(`ROE ${(roe * 100).toFixed(1)}% dưới kỳ vọng ngành ${(profile.flags.minRoe * 100).toFixed(0)}%`);
    }
  }

  const overall = avgDefined([
    sc.profitability != null ? sc.profitability * w.profitability : null,
    sc.leverage != null ? sc.leverage * w.leverage : null,
    sc.cashflow != null ? sc.cashflow * w.cashflow : null,
    sc.liquidity != null ? sc.liquidity * w.liquidity : null,
    sc.efficiency != null ? sc.efficiency * w.efficiency : null,
  ]);

  const totalSlots = Object.values(groups).reduce((a, g) => a + Object.keys(g).length, 0);
  const filled = Object.values(groups).reduce(
    (a, g) => a + Object.values(g).filter((v) => v != null).length,
    0,
  );
  const coverage = totalSlots ? filled / totalSlots : 0;
  if (coverage < 0.4)
    warnings.push("Dữ liệu báo cáo tài chính chưa đầy đủ — kết quả chỉ mang tính tham khảo phần có dữ liệu");
  if (equity != null && equity < 0) warnings.push("Vốn chủ sở hữu âm — rủi ro cơ cấu nghiêm trọng");
  if (groups.profitability.roe != null && groups.profitability.roe > 0.18 && fcfTtm != null && fcfTtm < 0)
    warnings.push("ROE cao nhưng FCF âm — chất lượng lợi nhuận cần kiểm tra");

  return {
    groups,
    scores: { ...sc, overall: overall != null ? Math.round(overall) : null },
    coverage: Number(coverage.toFixed(2)),
    warnings,
    riskFlags,
    industry: industryMeta,
    anchors: { revenue, netProfit, equity, totalDebt, cash, ocfTtm, fcfTtm, shares, epsTtm, ebitdaTtm },
  };
}

function avgDefined(vals: (number | null)[]): number | null {
  const d = vals.filter((v): v is number => v != null);
  return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
}

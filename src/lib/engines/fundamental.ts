import "server-only";
import { getIndustryProfile } from "../financial/industry-profiles";

/**
 * FINANCIAL HEALTH ENGINE — deterministic ratio computation from financial
 * statement rows (any provider shape; alias-based extraction). Pure code: the
 * LLM layer only ever receives these calculated results.
 * Phase 4: industry-specific weights + risk flags.
 */

type Row = Record<string, unknown>;

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

function findNum(row: Row, aliases: string[]): number | null {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    for (const k of keys) {
      if (strip(k).includes(alias)) {
        const v = row[k];
        const n = typeof v === "number" ? v : Number(String(v).replace(/[,.]/g, (m) => (m === "," ? "" : m)));
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function newestFirst(rows: Row[]): Row[] {
  const periodScore = (r: Row): number => {
    const y = findNum(r, ["year", "nam", "periodyear"]) ?? 0;
    const q = findNum(r, ["quarter", "quy", "periodquarter", "lengthyear"]) ?? 0;
    return y * 10 + q;
  };
  return [...rows].sort((a, b) => periodScore(b) - periodScore(a));
}

function latest(rows: Row[], aliases: string[]): number | null {
  const sorted = newestFirst(rows);
  for (const r of sorted) {
    const v = findNum(r, aliases);
    if (v != null) return v;
  }
  return null;
}

function ttm(rows: Row[], aliases: string[]): number | null {
  const sorted = newestFirst(rows);
  const vals: number[] = [];
  for (const r of sorted.slice(0, 6)) {
    const v = findNum(r, aliases);
    if (v != null) vals.push(v);
    if (vals.length === 4) break;
  }
  return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) : latest(rows, aliases);
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
        ocfTtm: null,
        fcfTtm: null,
        shares: null,
        epsTtm: null,
        ebitdaTtm: null,
      },
    };
  }

  const revenue = ttm(income, AL.revenue) ?? latest(income, AL.revenue);
  const grossProfit = ttm(income, AL.grossProfit);
  const ebit = ttm(income, AL.ebit);
  const ebitdaTtm = ttm(income, AL.ebitda) ?? (ebit != null ? ebit * 1.15 : null);
  const netProfit = ttm(income, AL.netProfit) ?? latest(income, AL.netProfit);
  const interestExpense = ttm(income, AL.interestExpense);

  const totalAssets = latest(balance, AL.totalAssets);
  const currentAssets = latest(balance, AL.currentAssets);
  const totalLiabilities = latest(balance, AL.totalLiabilities);
  const currentLiabilities = latest(balance, AL.currentLiabilities);
  const equity = latest(balance, AL.equity);
  const cash = latest(balance, AL.cash);
  const shortDebt = latest(balance, AL.shortDebt) ?? 0;
  const longDebt = latest(balance, AL.longDebt) ?? 0;
  const totalDebt =
    latest(balance, AL.shortDebt) != null || latest(balance, AL.longDebt) != null
      ? (shortDebt ?? 0) + (longDebt ?? 0)
      : totalLiabilities;
  const inventory = latest(balance, AL.inventory);
  const receivables = latest(balance, AL.receivables);

  const ocfTtm = ttm(cashflow, AL.ocf);
  const capexTtm = cashflow.length ? Math.abs(ttm(cashflow, AL.capex) ?? ttm(cashflow, AL.buyInvest) ?? 0) : null;
  const fcfTtm = ocfTtm != null && capexTtm != null ? ocfTtm - capexTtm : ocfTtm;
  const shares = latest(balance, AL.shares) ?? latest(income, AL.shares);
  const epsTtm = latest(income, AL.eps) ?? (netProfit != null && shares ? netProfit / shares : null);

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
      debtToEquity: zz(div(totalDebt ?? null, equity), 2),
      debtToAssets: zz(div(totalLiabilities ?? totalDebt ?? null, totalAssets), 2),
      netDebtToEbitda: zz(totalDebt != null && ebitdaTtm ? (totalDebt - (cash ?? 0)) / ebitdaTtm : null, 2),
      interestCoverage: zz(div(ebit, interestExpense), 2),
    },
    cashflow: {
      ocfTtm: ocfTtm != null ? Math.round(ocfTtm) : null,
      fcfTtm: fcfTtm != null ? Math.round(fcfTtm) : null,
      fcfConversion: zz(div(fcfTtm, netProfit), 2),
      ocfMargin: zz(div(ocfTtm, revenue), 4),
    },
    efficiency: {
      assetTurnover: zz(div(revenue, totalAssets), 2),
      inventoryTurnover: zz(div(revenue, inventory), 2),
      receivableTurnover: zz(div(revenue, receivables), 2),
    },
  };

  const band = (v: number | null, bands: [number, number][]): number | null => {
    if (v == null) return null;
    for (const [min, score] of bands) if (v >= min) return score;
    return 25;
  };
  const scoreProfit = avgDefined([
    band(groups.profitability.roe, [
      [0.22, 95],
      [0.15, 85],
      [0.1, 70],
      [0.05, 50],
      [0, 35],
    ]),
    band(groups.profitability.netMargin, [
      [0.2, 95],
      [0.12, 85],
      [0.07, 70],
      [0.03, 55],
      [0, 40],
    ]),
    band(groups.profitability.roa, [
      [0.12, 95],
      [0.07, 85],
      [0.04, 70],
      [0.02, 55],
      [0, 40],
    ]),
  ]);
  const scoreLiq = avgDefined([
    band(groups.liquidity.currentRatio, [
      [2, 90],
      [1.5, 75],
      [1.1, 60],
      [0.8, 40],
    ]),
    band(groups.liquidity.cashRatio, [
      [0.5, 90],
      [0.2, 70],
      [0.08, 50],
      [0.03, 35],
    ]),
  ]);
  const scoreLev = avgDefined([
    band(groups.leverage.debtToEquity != null ? -groups.leverage.debtToEquity : null, [
      [-0.3, 95],
      [-0.7, 80],
      [-1.2, 60],
      [-2, 40],
    ]),
    band(groups.leverage.interestCoverage, [
      [8, 95],
      [4, 80],
      [2, 60],
      [1, 35],
    ]),
    band(groups.leverage.netDebtToEbitda != null ? -groups.leverage.netDebtToEbitda : null, [
      [0.1, 90],
      [-1, 75],
      [-2.5, 55],
      [-4, 35],
    ]),
  ]);
  const scoreCf = avgDefined([
    band(groups.cashflow.fcfConversion, [
      [1.2, 95],
      [0.8, 80],
      [0.4, 60],
      [0, 40],
    ]),
    ocfTtm != null && netProfit != null
      ? band(div(ocfTtm, netProfit), [
          [1.2, 95],
          [0.8, 75],
          [0.4, 55],
          [0, 35],
        ])
      : null,
  ]);
  const scoreEff = avgDefined([
    band(groups.efficiency.assetTurnover, [
      [1.5, 90],
      [1, 75],
      [0.6, 60],
      [0.3, 40],
    ]),
  ]);

  const sc = {
    profitability: scoreProfit,
    liquidity: scoreLiq,
    leverage: scoreLev,
    cashflow: scoreCf,
    efficiency: scoreEff,
  };

  let industryMeta: FinancialHealthResult["industry"] = null;
  let w = { profitability: 0.3, liquidity: 0.14, leverage: 0.22, cashflow: 0.22, efficiency: 0.12 };
  if (opts?.symbol) {
    const profile = getIndustryProfile(opts.symbol);
    w = profile.weights;
    industryMeta = { id: profile.id, labelVi: profile.labelVi, note: profile.flags.note };
    const de = groups.leverage.debtToEquity;
    const cr = groups.liquidity.currentRatio;
    const ic = groups.leverage.interestCoverage;
    if (profile.flags.maxDebtEquity != null && de != null && de > profile.flags.maxDebtEquity) {
      riskFlags.push(`Nợ/VCSH ${de.toFixed(2)} vượt ngưỡng ngành ${profile.flags.maxDebtEquity}`);
    }
    if (profile.flags.minCurrentRatio != null && cr != null && cr < profile.flags.minCurrentRatio) {
      riskFlags.push(`Current ratio ${cr.toFixed(2)} dưới ngưỡng ngành ${profile.flags.minCurrentRatio}`);
    }
    if (profile.flags.minInterestCoverage != null && ic != null && ic < profile.flags.minInterestCoverage) {
      riskFlags.push(`Interest coverage ${ic.toFixed(2)} dưới ngưỡng ngành ${profile.flags.minInterestCoverage}`);
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
    anchors: { revenue, netProfit, equity, totalDebt, ocfTtm, fcfTtm, shares, epsTtm, ebitdaTtm },
  };
}

function avgDefined(vals: (number | null)[]): number | null {
  const d = vals.filter((v): v is number => v != null);
  return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
}

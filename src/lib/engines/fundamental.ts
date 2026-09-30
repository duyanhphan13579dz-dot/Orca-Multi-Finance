import "server-only";
import { getIndustryProfile } from "../financial/industry-profiles";

/**
 * FINANCIAL HEALTH ENGINE — deterministic ratio computation from financial
 * statement rows (any provider shape; alias-based extraction).
 *
 * Perf: Map-indexed rows, pre-stripped aliases, sort once, smart TTM.
 * Algo: ROE/ROA on average equity/assets; NOPAT-style ROIC; abs interest cover.
 */

type Row = Record<string, unknown>;

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type RowIndex = {
  row: Row;
  keys: string[];
  stripped: string[];
  byKey: Map<string, number>;
  periodScore: number;
};

function indexRow(row: Row): RowIndex {
  const keys = Object.keys(row);
  const stripped = keys.map(strip);
  const byKey = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    const n = toNum(row[keys[i]]);
    if (n != null && !byKey.has(stripped[i])) byKey.set(stripped[i], n);
  }
  const y = byKey.get("year") ?? byKey.get("nam") ?? byKey.get("periodyear") ?? 0;
  const q =
    byKey.get("quarter") ??
    byKey.get("quy") ??
    byKey.get("periodquarter") ??
    byKey.get("lengthyear") ??
    0;
  return { row, keys, stripped, byKey, periodScore: y * 10 + q };
}

function findNumIndexed(ix: RowIndex, aliases: string[]): number | null {
  for (const alias of aliases) {
    const exact = ix.byKey.get(alias);
    if (exact != null) return exact;
  }
  for (const alias of aliases) {
    for (let i = 0; i < ix.stripped.length; i++) {
      if (ix.stripped[i].includes(alias)) {
        const n = toNum(ix.row[ix.keys[i]]);
        if (n != null) return n;
      }
    }
  }
  return null;
}

function findNum(row: Row, aliases: string[]): number | null {
  return findNumIndexed(indexRow(row), aliases.map(strip));
}

function indexAndSort(rows: Row[]): RowIndex[] {
  const indexed = rows.map(indexRow);
  indexed.sort((a, b) => b.periodScore - a.periodScore);
  return indexed;
}

function latestIndexed(sorted: RowIndex[], aliases: string[]): number | null {
  for (const ix of sorted) {
    const v = findNumIndexed(ix, aliases);
    if (v != null) return v;
  }
  return null;
}

function avgIndexed(sorted: RowIndex[], aliases: string[], n = 2): number | null {
  const vals: number[] = [];
  for (const ix of sorted) {
    const v = findNumIndexed(ix, aliases);
    if (v != null) {
      vals.push(v);
      if (vals.length >= n) break;
    }
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Quarterly → sum ≤4 periods; annual → latest only (avoid summing years). */
function ttmIndexed(sorted: RowIndex[], aliases: string[]): number | null {
  if (!sorted.length) return null;
  const vals: number[] = [];
  let quarterlyHits = 0;
  for (const ix of sorted.slice(0, 8)) {
    const v = findNumIndexed(ix, aliases);
    if (v == null) continue;
    const q =
      ix.byKey.get("quarter") ??
      ix.byKey.get("quy") ??
      ix.byKey.get("periodquarter") ??
      0;
    if (q >= 1 && q <= 4) quarterlyHits++;
    vals.push(v);
    if (vals.length >= 4) break;
  }
  if (!vals.length) return null;
  if (quarterlyHits >= 2 && vals.length >= 2) {
    return vals.slice(0, Math.min(4, vals.length)).reduce((a, b) => a + b, 0);
  }
  return vals[0]!;
}

function newestFirst(rows: Row[]): Row[] {
  return indexAndSort(rows).map((ix) => ix.row);
}

function latest(rows: Row[], aliases: string[]): number | null {
  return latestIndexed(indexAndSort(rows), aliases.map(strip));
}

function ttm(rows: Row[], aliases: string[]): number | null {
  return ttmIndexed(indexAndSort(rows), aliases.map(strip));
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

const AL_S: { [K in keyof typeof AL]: string[] } = Object.fromEntries(
  Object.entries(AL).map(([k, arr]) => [k, (arr as string[]).map(strip)]),
) as { [K in keyof typeof AL]: string[] };

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
      scores: {
        profitability: null,
        liquidity: null,
        leverage: null,
        cashflow: null,
        efficiency: null,
        overall: null,
      },
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

  const revenue = ttmIndexed(inc, AL_S.revenue) ?? latestIndexed(inc, AL_S.revenue);
  const grossProfit = ttmIndexed(inc, AL_S.grossProfit);
  const ebit = ttmIndexed(inc, AL_S.ebit);
  const ebitdaReported = ttmIndexed(inc, AL_S.ebitda);
  const ebitdaTtm = ebitdaReported ?? (ebit != null ? ebit * 1.12 : null);
  const netProfit = ttmIndexed(inc, AL_S.netProfit) ?? latestIndexed(inc, AL_S.netProfit);
  const interestExpense = ttmIndexed(inc, AL_S.interestExpense);

  const totalAssets = latestIndexed(bal, AL_S.totalAssets);
  const currentAssets = latestIndexed(bal, AL_S.currentAssets);
  const totalLiabilities = latestIndexed(bal, AL_S.totalLiabilities);
  const currentLiabilities = latestIndexed(bal, AL_S.currentLiabilities);
  const equity = latestIndexed(bal, AL_S.equity);
  const cash = latestIndexed(bal, AL_S.cash);
  const shortDebtRaw = latestIndexed(bal, AL_S.shortDebt);
  const longDebtRaw = latestIndexed(bal, AL_S.longDebt);
  const shortDebt = shortDebtRaw ?? 0;
  const longDebt = longDebtRaw ?? 0;
  const totalDebt =
    shortDebtRaw != null || longDebtRaw != null ? shortDebt + longDebt : totalLiabilities;
  const inventory = latestIndexed(bal, AL_S.inventory);
  const receivables = latestIndexed(bal, AL_S.receivables);

  const equityAvg = avgIndexed(bal, AL_S.equity, 2) ?? equity;
  const assetsAvg = avgIndexed(bal, AL_S.totalAssets, 2) ?? totalAssets;

  const ocfTtm = ttmIndexed(cf, AL_S.ocf);
  const capexRaw = cf.length
    ? ttmIndexed(cf, AL_S.capex) ?? ttmIndexed(cf, AL_S.buyInvest)
    : null;
  const capexTtm = capexRaw != null ? Math.abs(capexRaw) : cf.length ? 0 : null;
  const fcfTtm = ocfTtm != null && capexTtm != null ? ocfTtm - capexTtm : ocfTtm;
  const shares = latestIndexed(bal, AL_S.shares) ?? latestIndexed(inc, AL_S.shares);
  const epsStmt = latestIndexed(inc, AL_S.eps);
  const epsTtm =
    epsStmt != null && epsStmt !== 0
      ? epsStmt
      : netProfit != null && shares && shares > 0
        ? netProfit / shares
        : null;

  void findNum;
  void newestFirst;
  void ttm;
  void latest;

  const groups: FinancialHealthResult["groups"] = {
    profitability: {
      grossMargin: zz(div(grossProfit, revenue), 4),
      operatingMargin: zz(div(ebit, revenue), 4),
      netMargin: zz(div(netProfit, revenue), 4),
      roa: zz(div(netProfit, assetsAvg), 4),
      roe: zz(div(netProfit, equityAvg), 4),
      roic: zz(
        div(
          ebit != null ? ebit * (1 - 0.2) : null,
          totalDebt != null && equityAvg != null
            ? totalDebt + equityAvg - (cash ?? 0)
            : null,
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
      interestCoverage: zz(
        div(ebit, interestExpense != null ? Math.abs(interestExpense) : null),
        2,
      ),
      netDebtToEbitda: zz(
        div(totalDebt != null ? totalDebt - (cash ?? 0) : null, ebitdaTtm),
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
      assetTurnover: zz(div(revenue, assetsAvg ?? totalAssets), 2),
      inventoryDays:
        inventory != null && revenue != null && revenue > 0
          ? zz(inventory / (revenue / 365), 0)
          : null,
      receivableDays:
        receivables != null && revenue != null && revenue > 0
          ? zz(receivables / (revenue / 365), 0)
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
    efficiency: avgDefined([scoreBand(groups.efficiency.assetTurnover, 0.8, 0.4)]),
  };

  const roe = groups.profitability.roe;
  const ic = groups.leverage.interestCoverage;
  const nde = groups.leverage.netDebtToEbitda;
  if (profile?.flags) {
    if (
      profile.flags.minInterestCoverage != null &&
      ic != null &&
      ic < profile.flags.minInterestCoverage
    ) {
      riskFlags.push(
        `Interest coverage ${ic.toFixed(2)} dưới ngưỡng ngành ${profile.flags.minInterestCoverage}`,
      );
    }
    if (
      profile.flags.maxNetDebtEbitda != null &&
      nde != null &&
      nde > profile.flags.maxNetDebtEbitda
    ) {
      riskFlags.push(
        `Net debt/EBITDA ${nde.toFixed(2)} vượt ngưỡng ngành ${profile.flags.maxNetDebtEbitda}`,
      );
    }
    if (profile.flags.minRoe != null && roe != null && roe < profile.flags.minRoe) {
      riskFlags.push(
        `ROE ${(roe * 100).toFixed(1)}% dưới kỳ vọng ngành ${(profile.flags.minRoe * 100).toFixed(0)}%`,
      );
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
    warnings.push(
      "Dữ liệu báo cáo tài chính chưa đầy đủ — kết quả chỉ mang tính tham khảo phần có dữ liệu",
    );
  if (equity != null && equity < 0)
    warnings.push("Vốn chủ sở hữu âm — rủi ro cơ cấu nghiêm trọng");
  if (
    groups.profitability.roe != null &&
    groups.profitability.roe > 0.18 &&
    fcfTtm != null &&
    fcfTtm < 0
  )
    warnings.push("ROE cao nhưng FCF âm — chất lượng lợi nhuận cần kiểm tra");

  return {
    groups,
    scores: { ...sc, overall: overall != null ? Math.round(overall) : null },
    coverage: Number(coverage.toFixed(2)),
    warnings,
    riskFlags,
    industry: industryMeta,
    anchors: {
      revenue,
      netProfit,
      equity,
      totalDebt,
      cash,
      ocfTtm,
      fcfTtm,
      shares,
      epsTtm,
      ebitdaTtm,
    },
  };
}

function avgDefined(vals: (number | null)[]): number | null {
  const d = vals.filter((v): v is number => v != null);
  return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
}

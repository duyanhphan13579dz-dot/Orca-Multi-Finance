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
  periodYear: number | null;
  periodQuarter: number | null;
  periodType: "quarter" | "year" | "unknown";
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

  const periodText = String(row.period ?? row.periodLabel ?? row.fiscalDate ?? row.date ?? "");
  const yearMatch = periodText.match(/(?:19|20)\d{2}/);
  let year =
    byKey.get("year") ??
    byKey.get("nam") ??
    byKey.get("periodyear") ??
    (yearMatch ? Number(yearMatch[0]) : null);
  if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2200)) year = null;

  const rawQuarter =
    byKey.get("quarter") ??
    byKey.get("quy") ??
    byKey.get("periodquarter") ??
    byKey.get("lengthyear") ??
    null;
  let quarter = rawQuarter != null && rawQuarter >= 1 && rawQuarter <= 4 ? rawQuarter : null;
  const qMatch = periodText.match(/(?:^|\D)(?:q|quarter|quy)\s*([1-4])(?:\D|$)/i);
  if (quarter == null && qMatch) quarter = Number(qMatch[1]);
  const typeText = String(row.periodType ?? row.reportType ?? "").toLowerCase();
  const periodType: RowIndex["periodType"] =
    typeText.includes("year") || typeText.includes("annual") || typeText.includes("nam")
      ? "year"
      : quarter != null || typeText.includes("quarter") || typeText.includes("quy")
        ? "quarter"
        : year != null
          ? "year"
          : "unknown";

  return {
    row,
    keys,
    stripped,
    byKey,
    periodYear: year,
    periodQuarter: periodType === "quarter" ? quarter : null,
    periodType,
    periodScore: (year ?? 0) * 10 + (periodType === "quarter" ? (quarter ?? 0) : 0),
  };
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

function uniqueByPeriod(sorted: RowIndex[], type: "quarter" | "year"): RowIndex[] {
  const seen = new Set<string>();
  const rows: RowIndex[] = [];
  for (const ix of sorted) {
    if (ix.periodType !== type || ix.periodYear == null) continue;
    const period =
      type === "quarter" && ix.periodQuarter != null
        ? `${ix.periodYear}-Q${ix.periodQuarter}`
        : String(ix.periodYear);
    if (seen.has(period)) continue;
    seen.add(period);
    rows.push(ix);
  }
  return rows;
}

function avgIndexed(sorted: RowIndex[], aliases: string[], n = 2): number | null {
  // Prefer distinct quarter-end balance snapshots when available; otherwise use annual rows.
  const quarterly = uniqueByPeriod(sorted, "quarter");
  const candidates = quarterly.length >= 2 ? quarterly : uniqueByPeriod(sorted, "year");
  const vals: number[] = [];
  for (const ix of candidates) {
    const value = findNumIndexed(ix, aliases);
    if (value != null) {
      vals.push(value);
      if (vals.length >= n) break;
    }
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * A TTM flow is only the latest four distinct, consecutive quarters. If a full
 * four-quarter window is unavailable, use the latest annual filing (if any),
 * never sum two or three quarters and label that partial sum as TTM.
 */
function ttmIndexed(sorted: RowIndex[], aliases: string[]): number | null {
  if (!sorted.length) return null;
  const quarters = uniqueByPeriod(sorted, "quarter");
  const annuals = uniqueByPeriod(sorted, "year");
  if (!quarters.length && !annuals.length) {
    // Legacy provider rows without fiscal period metadata cannot support TTM;
    // retain the single latest reported value but never sum unlabelled rows.
    for (const ix of sorted) {
      const value = findNumIndexed(ix, aliases);
      if (value != null) return value;
    }
  }
  if (quarters.length >= 4) {
    const window = quarters.slice(0, 4);
    const consecutive = window.every((ix, index) => {
      if (index === 0) return true;
      const current = (ix.periodYear! * 4) + ix.periodQuarter!;
      const previous = (window[index - 1]!.periodYear! * 4) + window[index - 1]!.periodQuarter!;
      return previous - current === 1;
    });
    const values = window.map((ix) => findNumIndexed(ix, aliases));
    if (consecutive && values.every((value): value is number => value != null)) {
      return values.reduce((sum, value) => sum + value, 0);
    }
  }

  for (const ix of annuals) {
    const value = findNumIndexed(ix, aliases);
    if (value != null) return value;
  }
  return null;
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
  profitBeforeTax: ["profitbeforetax", "profitbeforetaxation", "loinhuantruoc thue"],
  taxExpense: ["taxexpense", "incometaxexpense", "chiphithueTNDN", "thueTNDN"],
  netProfit: ["netprofit", "profitfortheyear", "loinhuansauthue", "loinhuanrong", "sauthue", "netincome"],
  totalAssets: ["totalassets", "tongtaisan", "tongcongtaisan"],
  currentAssets: ["currentassets", "taisannganhan", "taisannh"],
  totalLiabilities: ["totalliabilities", "nophaitra", "tongno"],
  currentLiabilities: ["currentliabilities", "nonganhan"],
  equity: ["equity", "vonchusohuu", "ownerequity"],
  cash: ["cash", "cashandequivalents", "cashequivalents", "tienvatuongduong", "tien"],
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

  const revenue = ttmIndexed(inc, AL_S.revenue);
  const grossProfit = ttmIndexed(inc, AL_S.grossProfit);
  const ebit = ttmIndexed(inc, AL_S.ebit);
  const ebitdaReported = ttmIndexed(inc, AL_S.ebitda);
  const ebitdaTtm = ebitdaReported;
  const netProfit = ttmIndexed(inc, AL_S.netProfit);
  const interestExpense = ttmIndexed(inc, AL_S.interestExpense);
  const profitBeforeTax = ttmIndexed(inc, AL_S.profitBeforeTax);
  const taxExpense = ttmIndexed(inc, AL_S.taxExpense);

  const totalAssets = latestIndexed(bal, AL_S.totalAssets);
  const currentAssets = latestIndexed(bal, AL_S.currentAssets);
  const totalLiabilities = latestIndexed(bal, AL_S.totalLiabilities);
  const currentLiabilities = latestIndexed(bal, AL_S.currentLiabilities);
  const equity = latestIndexed(bal, AL_S.equity);
  const cash = latestIndexed(bal, AL_S.cash);
  const shortDebtRaw = latestIndexed(bal, AL_S.shortDebt);
  const longDebtRaw = latestIndexed(bal, AL_S.longDebt);
  // Total liabilities contain trade payables, tax, deposits and other non-borrowing
  // obligations. Do not silently assume an unreported debt bucket is zero.
  const totalDebt = shortDebtRaw != null && longDebtRaw != null ? shortDebtRaw + longDebtRaw : null;
  const inventory = latestIndexed(bal, AL_S.inventory);
  const receivables = latestIndexed(bal, AL_S.receivables);

  const equityAvg = avgIndexed(bal, AL_S.equity, 2) ?? equity;
  const assetsAvg = avgIndexed(bal, AL_S.totalAssets, 2) ?? totalAssets;

  const ocfTtm = ttmIndexed(cf, AL_S.ocf);
  const capexRaw = cf.length
    ? ttmIndexed(cf, AL_S.capex) ?? ttmIndexed(cf, AL_S.buyInvest)
    : null;
  const capexTtm = capexRaw != null ? Math.abs(capexRaw) : null;
  const fcfTtm = ocfTtm != null && capexTtm != null ? ocfTtm - capexTtm : null;
  const shares = latestIndexed(bal, AL_S.shares) ?? latestIndexed(inc, AL_S.shares);
  const epsStmt = ttmIndexed(inc, AL_S.eps);
  const epsTtm =
    epsStmt != null && epsStmt !== 0
      ? epsStmt
      : netProfit != null && shares && shares > 0
        ? netProfit / shares
        : null;

  if (ebit != null && ebitdaReported == null) {
    warnings.push("Thiếu EBITDA được báo cáo — không ước EBITDA từ EBIT.");
  }
  if (ocfTtm != null && capexTtm == null) {
    warnings.push("Thiếu CAPEX — không tính FCF từ OCF.");
  }
  if (totalDebt == null) {
    if (shortDebtRaw != null || longDebtRaw != null) {
      warnings.push("Thiếu một cấu phần nợ vay ngắn/dài hạn — không giả định cấu phần thiếu bằng 0.");
    } else if (totalLiabilities != null) {
      warnings.push("Thiếu nợ vay ngắn/dài hạn — không dùng tổng nợ phải trả thay cho nợ vay.");
    }
  }

  const observedTaxRate =
    profitBeforeTax != null && profitBeforeTax > 0 && taxExpense != null
      ? taxExpense / profitBeforeTax
      : null;
  const taxRate =
    observedTaxRate != null && Number.isFinite(observedTaxRate) && observedTaxRate >= 0 && observedTaxRate < 0.6
      ? observedTaxRate
      : null;
  if (ebit != null && taxRate == null) {
    warnings.push("RoIC dùng thuế suất chuẩn 20% do thiếu/không hợp lệ thuế suất hiệu dụng TTM.");
  }

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
          ebit != null ? ebit * (1 - (taxRate ?? 0.2)) : null,
          totalDebt != null && equityAvg != null && cash != null
            ? totalDebt + equityAvg - cash
            : null,
        ),
        4,
      ),
    },
    liquidity: {
      currentRatio: zz(div(currentAssets, currentLiabilities), 2),
      quickRatio: zz(
        div(
          currentAssets != null && inventory != null
            ? currentAssets - inventory
            : cash != null && receivables != null
              ? cash + receivables
              : null,
          currentLiabilities,
        ),
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
      netDebtToEbitda:
        ebitdaTtm != null && ebitdaTtm > 0
          ? zz(
              div(totalDebt != null && cash != null ? totalDebt - cash : null, ebitdaTtm),
              2,
            )
          : null,
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
    ? { id: profile.id, labelVi: profile.labelVi, note: profile.flags.note }
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
    // invert = true (như debtToEquity): Nếu v < 0 nghĩa là VCSH âm, rủi ro vỡ nợ tối đa (10 điểm)
    if (v < 0) return 10;
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

  if (equity != null && equity < 0) {
    riskFlags.push("Vốn chủ sở hữu âm — rủi ro kiệt quệ tài chính hoặc đình chỉ giao dịch");
  }
  if (
    ebitdaTtm != null &&
    ebitdaTtm <= 0 &&
    totalDebt != null &&
    cash != null &&
    totalDebt > cash
  ) {
    riskFlags.push("EBITDA âm trong khi có nợ vay ròng — không thể đảm bảo nghĩa vụ nợ từ HĐKD");
  }

  if (profile?.flags) {
    const de = groups.leverage.debtToEquity;
    const cr = groups.liquidity.currentRatio;
    if (profile.flags.maxDebtEquity != null && de != null && de > profile.flags.maxDebtEquity) {
      riskFlags.push(`Debt/Equity ${de.toFixed(2)} vượt ngưỡng ngành ${profile.flags.maxDebtEquity}`);
    }
    if (profile.flags.minCurrentRatio != null && cr != null && cr < profile.flags.minCurrentRatio) {
      riskFlags.push(`Current ratio ${cr.toFixed(2)} dưới ngưỡng ngành ${profile.flags.minCurrentRatio}`);
    }
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

  const weightedScores = [
    { score: sc.profitability, weight: w.profitability },
    { score: sc.leverage, weight: w.leverage },
    { score: sc.cashflow, weight: w.cashflow },
    { score: sc.liquidity, weight: w.liquidity },
    { score: sc.efficiency, weight: w.efficiency },
  ].filter((x): x is { score: number; weight: number } => x.score != null && x.weight > 0);
  const activeWeight = weightedScores.reduce((sum, x) => sum + x.weight, 0);
  const overall = activeWeight > 0
    ? weightedScores.reduce((sum, x) => sum + x.score * x.weight, 0) / activeWeight
    : null;

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

/**
 * VALUATION ENGINE — Phase 1
 * Data normalization helpers + market/enterprise multiples.
 *
 * Rules (from Enterprise Valuation Engine upgrade):
 * - Never invent financial figures.
 * - Null / incomplete when inputs missing — never NaN/Infinity.
 * - EXTEND existing valuation engine; do not replace callers.
 *
 * Formulas:
 *   Market Cap = Price × Shares
 *   P/E       = Price / EPS   (or Market Cap / Net Income)
 *   P/B       = Price / BVPS  (or Market Cap / Equity)
 *   P/S       = Market Cap / Revenue
 *   EV        = Market Cap + Total Debt + Minority − Cash − Non-op Investments
 *   EV/EBITDA = EV / EBITDA
 */

export const VALUATION_ENGINE_VERSION = "2.0.0-phase1";

export type MetricStatus = "ok" | "incomplete" | "invalid" | "not_applicable";

export interface MetricCell {
  value: number | null;
  status: MetricStatus;
  note?: string;
  inputs?: string[];
}

export interface ValuationInputs {
  price: number | null;
  shares: number | null;
  dilutedShares?: number | null;
  netIncomeTtm: number | null;
  epsTtm: number | null;
  equity: number | null;
  bvps?: number | null;
  revenueTtm: number | null;
  ebitdaTtm: number | null;
  ebitTtm?: number | null;
  totalDebt: number | null;
  cash: number | null;
  minorityInterest?: number | null;
  preferredEquity?: number | null;
  nonOperatingInvestments?: number | null;
  source?: string;
  sourceTimestamp?: string | null;
}

export interface Phase1Multiples {
  marketCap: MetricCell;
  enterpriseValue: MetricCell;
  pe: MetricCell;
  pb: MetricCell;
  ps: MetricCell;
  evEbitda: MetricCell;
  evSales: MetricCell;
  earningsYield: MetricCell;
  evComponents: {
    marketCap: number | null;
    totalDebt: number | null;
    minorityInterest: number | null;
    preferredEquity: number | null;
    cash: number | null;
    nonOperatingInvestments: number | null;
    incomplete: boolean;
    missing: string[];
  };
}

export interface Phase1ValuationResult {
  currentPrice: number | null;
  multiples: Phase1Multiples;
  dataQuality: number;
  notes: string[];
  sources: string[];
  calculatedAt: string;
  valuationEngineVersion: string;
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function cell(
  value: number | null,
  status: MetricStatus,
  note?: string,
  inputs?: string[],
): MetricCell {
  if (value != null && !Number.isFinite(value)) {
    return { value: null, status: "invalid", note: note ?? "Non-finite result", inputs };
  }
  return { value, status, note, inputs };
}

function round(n: number | null, d = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function calcMarketCap(price: number | null, shares: number | null): MetricCell {
  if (!finite(price) || price <= 0) {
    return cell(null, "incomplete", "Thiếu giá hiện tại hợp lệ", ["price"]);
  }
  if (!finite(shares) || shares <= 0) {
    return cell(null, "incomplete", "Thiếu số lượng cổ phiếu lưu hành", ["shares"]);
  }
  return cell(round(price * shares, 0), "ok", undefined, ["price", "shares"]);
}

export function calcPE(input: {
  price: number | null;
  epsTtm: number | null;
  marketCap: number | null;
  netIncomeTtm: number | null;
}): MetricCell {
  const { price, epsTtm, marketCap, netIncomeTtm } = input;
  if (finite(epsTtm) && finite(price) && price > 0) {
    if (epsTtm <= 0) {
      return cell(null, "not_applicable", "EPS ≤ 0 — không tính P/E", ["price", "epsTtm"]);
    }
    return cell(round(price / epsTtm, 2), "ok", undefined, ["price", "epsTtm"]);
  }
  if (finite(marketCap) && marketCap > 0 && finite(netIncomeTtm)) {
    if (netIncomeTtm <= 0) {
      return cell(null, "not_applicable", "Net Income ≤ 0 — không tính P/E", ["marketCap", "netIncomeTtm"]);
    }
    return cell(round(marketCap / netIncomeTtm, 2), "ok", undefined, ["marketCap", "netIncomeTtm"]);
  }
  return cell(null, "incomplete", "Thiếu EPS hoặc (Market Cap + Net Income) để tính P/E", [
    "price",
    "epsTtm",
    "marketCap",
    "netIncomeTtm",
  ]);
}

export function calcEarningsYield(input: {
  price: number | null;
  epsTtm: number | null;
  marketCap: number | null;
  netIncomeTtm: number | null;
}): MetricCell {
  const { price, epsTtm, marketCap, netIncomeTtm } = input;
  if (finite(epsTtm) && finite(price) && price > 0) {
    return cell(round(epsTtm / price, 6), "ok", undefined, ["epsTtm", "price"]);
  }
  if (finite(netIncomeTtm) && finite(marketCap) && marketCap > 0) {
    return cell(round(netIncomeTtm / marketCap, 6), "ok", undefined, ["netIncomeTtm", "marketCap"]);
  }
  return cell(null, "incomplete", "Thiếu EPS/Price hoặc NI/Market Cap", ["epsTtm", "price"]);
}

export function calcPB(input: {
  price: number | null;
  bvps: number | null;
  equity: number | null;
  shares: number | null;
  marketCap: number | null;
}): MetricCell {
  const { price, bvps, equity, shares, marketCap } = input;
  if (finite(bvps) && bvps > 0 && finite(price) && price > 0) {
    return cell(round(price / bvps, 3), "ok", undefined, ["price", "bvps"]);
  }
  if (finite(equity) && equity > 0 && finite(shares) && shares > 0 && finite(price) && price > 0) {
    const computedBvps = equity / shares;
    return cell(round(price / computedBvps, 3), "ok", undefined, ["price", "equity", "shares"]);
  }
  if (finite(marketCap) && marketCap > 0 && finite(equity) && equity > 0) {
    return cell(round(marketCap / equity, 3), "ok", undefined, ["marketCap", "equity"]);
  }
  if (finite(equity) && equity <= 0) {
    return cell(null, "not_applicable", "Equity ≤ 0 — không tính P/B", ["equity"]);
  }
  return cell(null, "incomplete", "Thiếu Equity/BVPS hoặc giá để tính P/B", ["price", "equity", "shares"]);
}

export function calcPS(input: { marketCap: number | null; revenueTtm: number | null }): MetricCell {
  const { marketCap, revenueTtm } = input;
  if (!finite(marketCap) || marketCap <= 0) {
    return cell(null, "incomplete", "Thiếu Market Cap để tính P/S", ["marketCap"]);
  }
  if (!finite(revenueTtm) || revenueTtm <= 0) {
    return cell(
      null,
      revenueTtm != null && revenueTtm <= 0 ? "not_applicable" : "incomplete",
      revenueTtm != null && revenueTtm <= 0 ? "Revenue ≤ 0 — không tính P/S" : "Thiếu Revenue TTM",
      ["revenueTtm"],
    );
  }
  return cell(round(marketCap / revenueTtm, 3), "ok", undefined, ["marketCap", "revenueTtm"]);
}

export function calcEnterpriseValue(input: {
  marketCap: number | null;
  totalDebt: number | null;
  cash: number | null;
  minorityInterest?: number | null;
  preferredEquity?: number | null;
  nonOperatingInvestments?: number | null;
}): {
  cell: MetricCell;
  components: Phase1Multiples["evComponents"];
} {
  const missing: string[] = [];
  const marketCap = finite(input.marketCap) ? input.marketCap : null;
  const totalDebt = finite(input.totalDebt) ? input.totalDebt : null;
  const cash = finite(input.cash) ? input.cash : null;
  const minority = finite(input.minorityInterest) ? input.minorityInterest! : null;
  const preferred = finite(input.preferredEquity) ? input.preferredEquity! : null;
  const nonOp = finite(input.nonOperatingInvestments) ? input.nonOperatingInvestments! : null;

  if (marketCap == null) missing.push("marketCap");
  if (totalDebt == null) missing.push("totalDebt");
  if (cash == null) missing.push("cash");

  const components: Phase1Multiples["evComponents"] = {
    marketCap,
    totalDebt,
    minorityInterest: minority,
    preferredEquity: preferred,
    cash,
    nonOperatingInvestments: nonOp,
    incomplete: missing.length > 0,
    missing,
  };

  if (marketCap == null) {
    return {
      cell: cell(null, "incomplete", "Thiếu Market Cap — không tính EV", missing),
      components,
    };
  }

  const debtPart = totalDebt ?? 0;
  const cashPart = cash ?? 0;
  const minorityPart = minority ?? 0;
  const preferredPart = preferred ?? 0;
  const nonOpPart = nonOp ?? 0;

  const ev = marketCap + debtPart + minorityPart + preferredPart - cashPart - nonOpPart;
  const status: MetricStatus = missing.length ? "incomplete" : "ok";
  const note =
    missing.length > 0
      ? `EV ước lượng — thiếu: ${missing.filter((m) => m !== "marketCap").join(", ") || "một số thành phần"} (không tự suy diễn)`
      : undefined;

  return {
    cell: cell(round(ev, 0), status, note, ["marketCap", "totalDebt", "cash"]),
    components,
  };
}

export function calcEvEbitda(ev: number | null, ebitdaTtm: number | null): MetricCell {
  if (!finite(ev)) {
    return cell(null, "incomplete", "Thiếu EV để tính EV/EBITDA", ["enterpriseValue"]);
  }
  if (!finite(ebitdaTtm)) {
    return cell(null, "incomplete", "Thiếu EBITDA TTM", ["ebitdaTtm"]);
  }
  if (ebitdaTtm <= 0) {
    return cell(null, "not_applicable", "EBITDA ≤ 0 — không tính EV/EBITDA", ["ebitdaTtm"]);
  }
  return cell(round(ev / ebitdaTtm, 2), "ok", undefined, ["enterpriseValue", "ebitdaTtm"]);
}

export function calcEvSales(ev: number | null, revenueTtm: number | null): MetricCell {
  if (!finite(ev)) {
    return cell(null, "incomplete", "Thiếu EV để tính EV/Sales", ["enterpriseValue"]);
  }
  if (!finite(revenueTtm) || revenueTtm <= 0) {
    return cell(
      null,
      revenueTtm != null && revenueTtm <= 0 ? "not_applicable" : "incomplete",
      revenueTtm != null && revenueTtm <= 0 ? "Revenue ≤ 0" : "Thiếu Revenue TTM",
      ["revenueTtm"],
    );
  }
  return cell(round(ev / revenueTtm, 3), "ok", undefined, ["enterpriseValue", "revenueTtm"]);
}

export function scorePhase1DataQuality(input: ValuationInputs): number {
  const checks: boolean[] = [
    finite(input.price) && input.price! > 0,
    finite(input.shares) && input.shares! > 0,
    finite(input.epsTtm) || finite(input.netIncomeTtm),
    finite(input.equity) && input.equity! > 0,
    finite(input.revenueTtm) && input.revenueTtm! > 0,
    finite(input.ebitdaTtm),
    finite(input.totalDebt),
    finite(input.cash),
  ];
  const okCount = checks.filter(Boolean).length;
  return Math.round((okCount / checks.length) * 100);
}

export function buildPhase1Valuation(input: ValuationInputs): Phase1ValuationResult {
  const notes: string[] = [];
  const sources: string[] = [];
  if (input.source) sources.push(input.source);

  const marketCap = calcMarketCap(input.price, input.shares);
  if (marketCap.status !== "ok") notes.push(marketCap.note ?? "Market Cap incomplete");

  const pe = calcPE({
    price: input.price,
    epsTtm: input.epsTtm,
    marketCap: marketCap.value,
    netIncomeTtm: input.netIncomeTtm,
  });
  const earningsYield = calcEarningsYield({
    price: input.price,
    epsTtm: input.epsTtm,
    marketCap: marketCap.value,
    netIncomeTtm: input.netIncomeTtm,
  });
  const pb = calcPB({
    price: input.price,
    bvps: input.bvps ?? null,
    equity: input.equity,
    shares: input.shares,
    marketCap: marketCap.value,
  });
  const ps = calcPS({ marketCap: marketCap.value, revenueTtm: input.revenueTtm });

  const { cell: enterpriseValue, components: evComponents } = calcEnterpriseValue({
    marketCap: marketCap.value,
    totalDebt: input.totalDebt,
    cash: input.cash,
    minorityInterest: input.minorityInterest,
    preferredEquity: input.preferredEquity,
    nonOperatingInvestments: input.nonOperatingInvestments,
  });
  if (enterpriseValue.status === "incomplete") {
    notes.push(enterpriseValue.note ?? "EV incomplete");
  }

  const evEbitda = calcEvEbitda(enterpriseValue.value, input.ebitdaTtm);
  const evSales = calcEvSales(enterpriseValue.value, input.revenueTtm);

  for (const m of [pe, pb, ps, evEbitda]) {
    if (m.status === "incomplete" && m.note) notes.push(m.note);
    if (m.status === "not_applicable" && m.note) notes.push(m.note);
  }

  return {
    currentPrice: finite(input.price) ? input.price : null,
    multiples: {
      marketCap,
      enterpriseValue,
      pe,
      pb,
      ps,
      evEbitda,
      evSales,
      earningsYield,
      evComponents,
    },
    dataQuality: scorePhase1DataQuality(input),
    notes,
    sources,
    calculatedAt: new Date().toISOString(),
    valuationEngineVersion: VALUATION_ENGINE_VERSION,
  };
}

export function inputsFromHealthAnchors(args: {
  price: number;
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
    cash?: number | null;
  };
  source?: string;
}): ValuationInputs {
  const a = args.anchors;
  return {
    price: args.price > 0 ? args.price : null,
    shares: a.shares,
    netIncomeTtm: a.netProfit,
    epsTtm: a.epsTtm,
    equity: a.equity,
    revenueTtm: a.revenue,
    ebitdaTtm: a.ebitdaTtm,
    totalDebt: a.totalDebt,
    cash: a.cash ?? null,
    source: args.source ?? "financial-health-anchors",
  };
}

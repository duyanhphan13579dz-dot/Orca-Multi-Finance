/**
 * Client-safe fundamental metrics from BCTC snapshot + quote/bars.
 * Missing inputs → null (UI shows "Không đủ dữ liệu").
 *
 * Đơn vị VN: giá quote HOSE thường là nghìn đồng; BCTC là VND đầy đủ.
 * Số liệu dòng tiền lấy trực tiếp từ báo cáo LC tiền tệ VNDirect — không bịa.
 */

export type Band = "safe" | "ok" | "risk" | "na";

export interface MetricCell {
  key: string;
  labelVi: string;
  value: number | null;
  format: "pct" | "x" | "num" | "money" | "days";
  band?: Band;
  bandLabel?: string;
  note?: string;
  delta?: number | null;
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function div(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

/** Giá quote < 500 → nghìn đồng → nhân 1000 ra VND */
function priceToVnd(price: number | null): number | null {
  if (price == null || !(price > 0)) return null;
  if (price < 500) return price * 1000;
  return price;
}

/** Quy VND/cp về đơn vị giá quote (nghìn đồng) để hiển thị cạnh giá TT */
function vndPerShareToQuote(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) >= 500) return Math.round((v / 1000) * 100) / 100;
  return Math.round(v * 100) / 100;
}

function bandDebtEquity(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1) return { band: "safe", label: "An toàn" };
  if (v <= 2) return { band: "ok", label: "Chấp nhận" };
  return { band: "risk", label: "Rủi ro cao" };
}

function bandEbitdaAssets(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0.05) return { band: "risk", label: "Yếu" };
  if (v <= 0.12) return { band: "ok", label: "Trung bình" };
  return { band: "safe", label: "Tốt" };
}

function bandInterestCover(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1.5) return { band: "risk", label: "Rủi ro" };
  if (v <= 3) return { band: "ok", label: "Chấp nhận" };
  return { band: "safe", label: "An toàn" };
}

function bandFcfEbit(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0.5) return { band: "risk", label: "Yếu" };
  if (v <= 1) return { band: "ok", label: "Chấp nhận" };
  return { band: "safe", label: "Cao" };
}

function periodLabel(r: Record<string, unknown>): string {
  if (typeof r.period === "string" && r.period) return r.period;
  if (r.year != null && r.quarter != null) return `${r.year}-Q${r.quarter}`;
  if (r.year != null) return String(r.year);
  return "—";
}

export interface SnapshotBundle {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  price: number | null;
  closes: number[];
  shares: number | null;
  growthYoy: { metric: string; changePct: number | null }[];
  growthQoq: { metric: string; changePct: number | null }[];
  /** Hiệu suất đã tính server (ưu tiên) */
  performance?: {
    tsr?: number | null;
    tsr1y?: number | null;
    beta?: number | null;
    sharpe?: number | null;
    alpha?: number | null;
    dividendYield?: number | null;
    payoutRatio?: number | null;
    sampleDays?: number;
    note?: string;
  } | null;
  overrides?: {
    pe?: number | null;
    pb?: number | null;
    ps?: number | null;
    evEbitda?: number | null;
    peg?: number | null;
    dcfBase?: number | null;
    graham?: number | null;
    upsidePct?: number | null;
    marketCap?: number | null;
    dividendYield?: number | null;
  };
}

function rowRev(r: Record<string, unknown>) {
  return n(r.netRevenue) ?? n(r.revenue);
}
function rowNi(r: Record<string, unknown>) {
  return n(r.netIncome) ?? n(r.netProfit) ?? n(r.netIncomeParent);
}

export function buildSnapshotMetrics(b: SnapshotBundle) {
  const i0 = b.income[0] ?? {};
  const b0 = b.balance[0] ?? {};
  const c0 = b.cashflow[0] ?? {};
  const i1 = b.income[1] ?? {};

  const rev = rowRev(i0);
  const revPrev = rowRev(i1);
  const gp = n(i0.grossProfit);
  const op = n(i0.operatingProfit) ?? n(i0.ebit);
  const ebit = n(i0.ebit) ?? op;
  const ebitda = n(i0.ebitda) ?? (ebit != null ? ebit * 1.15 : null);
  const ni = rowNi(i0);
  const niPrev = rowNi(i1);
  const interest = n(i0.interestExpense) ?? n(i0.financeExpense);

  const assets = n(b0.totalAssets);
  const equity = n(b0.equity);
  const cash = n(b0.cash);
  const inventory = n(b0.inventory);
  const receivables = n(b0.receivables) ?? n(b0.accountsReceivable);
  const currentAssets = n(b0.currentAssets);
  const currentLiab = n(b0.currentLiabilities);
  const std = n(b0.shortTermDebt);
  const ltd = n(b0.longTermDebt);
  const totalLiab = n(b0.totalLiabilities);
  const debt =
    std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : totalLiab;

  const ocf = n(c0.operatingCashFlow);
  const capexRaw = n(c0.capex);
  const capex = capexRaw != null ? Math.abs(capexRaw) : null;
  const fcf =
    n(c0.freeCashFlow) ??
    (ocf != null && capex != null ? ocf - capex : null);

  const shares = b.shares;
  const priceQuote = b.price;
  const priceVnd = priceToVnd(priceQuote);

  const yoyRev =
    b.growthYoy.find((g) => /revenue|doanh thu/i.test(g.metric))?.changePct ??
    (rev != null && revPrev != null && revPrev !== 0 ? (rev - revPrev) / revPrev : null);
  const yoyNi =
    b.growthYoy.find((g) => /netIncome|lnst|lợi nhuận/i.test(g.metric))?.changePct ??
    (ni != null && niPrev != null && niPrev !== 0 ? (ni - niPrev) / niPrev : null);
  const qoqRev =
    b.growthQoq.find((g) => /revenue|doanh thu/i.test(g.metric))?.changePct ?? null;

  const grossMargin = div(gp, rev);
  const ebitdaMargin = div(ebitda, rev);
  const netMargin = div(ni, rev);
  const roe = div(ni, equity);
  const roa = div(ni, assets);
  const nopat = ebit != null ? ebit * 0.8 : null;
  const invested =
    equity != null && debt != null
      ? equity + debt - (cash ?? 0)
      : equity;
  const roic = div(nopat, invested);
  const assetTurnover = div(rev, assets);
  const invTurnover = div(rev, inventory);
  const recvTurnover = div(rev, receivables);

  const dio = invTurnover != null && invTurnover > 0 ? 365 / invTurnover : null;
  const dso = recvTurnover != null && recvTurnover > 0 ? 365 / recvTurnover : null;
  const ccc = dio != null || dso != null ? (dio ?? 0) + (dso ?? 0) : null;

  const debtEquity = div(debt, equity);
  const ebitdaAssets = div(ebitda, assets);
  const interestCover = div(ebit, interest != null ? Math.abs(interest) : null);
  const fcfEbit = div(fcf, ebit);
  const debtEbitda = div(debt, ebitda);
  const currentRatio = div(currentAssets, currentLiab);
  const quickRatio = div(
    currentAssets != null && inventory != null ? currentAssets - inventory : currentAssets,
    currentLiab,
  );

  // Altman Z (phi tài chính)
  const wc = currentAssets != null && currentLiab != null ? currentAssets - currentLiab : null;
  const x1 = div(wc, assets);
  const re = n(b0.retainedEarnings);
  const x2 = div(re, assets);
  const x3 = div(ebit, assets);
  const mcap =
    b.overrides?.marketCap ??
    (priceVnd != null && shares != null ? priceVnd * shares : null);
  const x4 = div(mcap, totalLiab ?? debt);
  const x5 = div(rev, assets);
  let altman: number | null = null;
  if (x1 != null && x3 != null && x5 != null) {
    altman =
      1.2 * (x1 ?? 0) +
      1.4 * (x2 ?? 0) +
      3.3 * (x3 ?? 0) +
      0.6 * (x4 ?? 0) +
      1.0 * (x5 ?? 0);
  }

  const epsVnd =
    shares != null && shares > 0 && ni != null ? ni / shares : n(i0.eps);
  const bvpsVnd =
    shares != null && shares > 0 && equity != null ? equity / shares : n(b0.bvps);

  const pe =
    b.overrides?.pe ??
    (priceVnd != null && epsVnd != null && epsVnd > 0 ? priceVnd / epsVnd : null);
  const pb =
    b.overrides?.pb ??
    (priceVnd != null && bvpsVnd != null && bvpsVnd > 0 ? priceVnd / bvpsVnd : null);
  const ps =
    b.overrides?.ps ??
    (mcap != null && rev != null && rev > 0 ? mcap / rev : null);
  const ev =
    mcap != null && debt != null ? mcap + debt - (cash ?? 0) : null;
  const evEbitda =
    b.overrides?.evEbitda ?? (ev != null && ebitda != null && ebitda > 0 ? ev / ebitda : null);
  const peg =
    b.overrides?.peg ??
    (pe != null && yoyNi != null && yoyNi > 0 ? pe / (yoyNi * 100) : null);

  const dcfBase = b.overrides?.dcfBase ?? null;
  const grahamQuote = b.overrides?.graham ?? null;
  let upsidePct = b.overrides?.upsidePct ?? null;
  if (upsidePct == null && dcfBase != null && priceQuote != null && priceQuote > 0) {
    upsidePct = (dcfBase / priceQuote - 1) * 100;
  }

  // —— Hiệu suất đầu tư ——
  const perf = b.performance;
  let tsr: number | null = perf?.tsr1y ?? perf?.tsr ?? null;
  if (tsr == null && b.closes.length >= 2) {
    const a0 = b.closes[0]!;
    const z = b.closes[b.closes.length - 1]!;
    if (a0 > 0) tsr = (z - a0) / a0;
  }
  const beta = perf?.beta ?? null;
  const sharpe = perf?.sharpe ?? null;
  const alpha = perf?.alpha ?? null;
  const divY =
    perf?.dividendYield ??
    b.overrides?.dividendYield ??
    null;
  const payout = perf?.payoutRatio ?? null;
  const perfNote = perf?.note;

  const deBand = bandDebtEquity(debtEquity);
  const eaBand = bandEbitdaAssets(ebitdaAssets);
  const icBand = bandInterestCover(interestCover);
  const feBand = bandFcfEbit(fcfEbit);

  const operating: MetricCell[] = [
    { key: "rev", labelVi: "Doanh thu thuần", value: rev, format: "money", delta: yoyRev, note: "YoY nếu có" },
    { key: "yoyRev", labelVi: "Tăng trưởng DT YoY", value: yoyRev, format: "pct" },
    { key: "qoqRev", labelVi: "Tăng trưởng DT QoQ", value: qoqRev, format: "pct" },
    { key: "gm", labelVi: "Biên LN gộp", value: grossMargin, format: "pct" },
    { key: "em", labelVi: "Biên EBITDA", value: ebitdaMargin, format: "pct" },
    { key: "nm", labelVi: "Biên LN ròng", value: netMargin, format: "pct" },
    { key: "roe", labelVi: "ROE", value: roe, format: "pct" },
    { key: "roa", labelVi: "ROA", value: roa, format: "pct" },
    { key: "roic", labelVi: "ROIC (ước tính)", value: roic, format: "pct", note: "NOPAT≈EBIT×0.8" },
    { key: "at", labelVi: "Vòng quay tài sản", value: assetTurnover, format: "x" },
    { key: "it", labelVi: "Vòng quay tồn kho", value: invTurnover, format: "x" },
    { key: "rt", labelVi: "Vòng quay phải thu", value: recvTurnover, format: "x" },
    {
      key: "ccc",
      labelVi: "Chu kỳ tiền mặt (CCC)",
      value: ccc,
      format: "days",
      note: "Ước tính DIO+DSO",
    },
  ];

  const investment: MetricCell[] = [
    {
      key: "eps",
      labelVi: "EPS",
      value: vndPerShareToQuote(epsVnd),
      format: "money",
      note: shares == null ? "Thiếu SL cổ phiếu" : "Đơn vị giá quote",
    },
    { key: "epsG", labelVi: "Tăng trưởng EPS YoY", value: yoyNi, format: "pct", note: "Xấp xỉ theo LNST YoY" },
    {
      key: "divY",
      labelVi: "Tỷ suất cổ tức",
      value: divY,
      format: "pct",
      note: divY != null ? "VNDirect ratios" : "Chưa có lịch sử cổ tức",
    },
    {
      key: "payout",
      labelVi: "Tỷ lệ chi trả cổ tức",
      value: payout,
      format: "pct",
      note: payout != null ? "Ước tính" : "Không đủ dữ liệu",
    },
    {
      key: "tsr",
      labelVi: "Total Shareholder Return",
      value: tsr,
      format: "pct",
      note: perf?.tsr1y != null ? "~12 tháng (giá, chưa gồm cổ tức)" : "Theo chuỗi giá (chưa gồm cổ tức)",
    },
    {
      key: "beta",
      labelVi: "Beta",
      value: beta,
      format: "num",
      note: beta != null ? (perfNote ?? "vs VNINDEX") : "Cần hiệp phương sai với VN-Index",
    },
    {
      key: "sharpe",
      labelVi: "Sharpe Ratio",
      value: sharpe,
      format: "num",
      note: sharpe != null ? "rf≈5%, annualized" : "Không đủ dữ liệu",
    },
    {
      key: "alpha",
      labelVi: "Alpha vs VN-Index",
      value: alpha,
      format: "pct",
      note: alpha != null ? "Jensen, annualized" : "Không đủ dữ liệu",
    },
  ];

  const debtPillars: MetricCell[] = [
    {
      key: "de",
      labelVi: "① Cơ cấu nợ (Nợ/VCSH)",
      value: debtEquity,
      format: "x",
      band: deBand.band,
      bandLabel: deBand.label,
    },
    {
      key: "ea",
      labelVi: "② Hiệu quả TS (EBITDA/TTS)",
      value: ebitdaAssets,
      format: "pct",
      band: eaBand.band,
      bandLabel: eaBand.label,
    },
    {
      key: "ic",
      labelVi: "③ Khả năng trả lãi",
      value: interestCover,
      format: "x",
      band: icBand.band,
      bandLabel: icBand.label,
    },
    {
      key: "fe",
      labelVi: "④ Chất lượng DT (FCF/EBIT)",
      value: fcfEbit,
      format: "pct",
      band: feBand.band,
      bandLabel: feBand.label,
    },
  ];

  const healthExtra: MetricCell[] = [
    { key: "debitda", labelVi: "Debt/EBITDA", value: debtEbitda, format: "x" },
    { key: "cr", labelVi: "Current Ratio", value: currentRatio, format: "x" },
    { key: "qr", labelVi: "Quick Ratio", value: quickRatio, format: "x" },
    {
      key: "z",
      labelVi: "Altman Z-Score",
      value: altman,
      format: "num",
      band: altman == null ? "na" : altman > 2.99 ? "safe" : altman > 1.81 ? "ok" : "risk",
      bandLabel:
        altman == null ? "Không đủ dữ liệu" : altman > 2.99 ? "An toàn" : altman > 1.81 ? "Cảnh báo" : "Nguy hiểm",
      note: "Công thức gốc cho DN phi tài chính",
    },
  ];

  const valuation: MetricCell[] = [
    { key: "pe", labelVi: "P/E", value: pe, format: "x" },
    { key: "pb", labelVi: "P/B", value: pb, format: "x" },
    { key: "ps", labelVi: "P/S", value: ps, format: "x" },
    { key: "eve", labelVi: "EV/EBITDA", value: evEbitda, format: "x" },
    { key: "peg", labelVi: "PEG", value: peg, format: "x" },
    {
      key: "upside",
      labelVi: "Upside định giá",
      value: upsidePct != null ? upsidePct / 100 : null,
      format: "pct",
    },
  ];

  const cashflow: MetricCell[] = [
    { key: "ocf", labelVi: "CFO (HĐKD)", value: ocf, format: "money" },
    { key: "fcf", labelVi: "FCF", value: fcf, format: "money", note: "CFO − |Capex|" },
    { key: "capex", labelVi: "Capex", value: capex != null ? -Math.abs(capex) : null, format: "money" },
    {
      key: "fcfYield",
      labelVi: "FCF Yield",
      value: mcap != null && fcf != null && mcap > 0 ? fcf / mcap : null,
      format: "pct",
    },
    {
      key: "ocfNi",
      labelVi: "CFO / LNST",
      value: div(ocf, ni),
      format: "x",
    },
  ];

  return {
    operating,
    investment,
    debtPillars,
    healthExtra,
    valuation,
    cashflow,
    period: periodLabel(i0),
  };
}

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
  if (v < 0) return { band: "risk", label: "FCF âm" };
  if (v < 0.5) return { band: "ok", label: "Trung bình" };
  return { band: "safe", label: "Tốt" };
}

function bandPe(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0) return { band: "risk", label: "LN âm" };
  if (v < 10) return { band: "safe", label: "Rẻ (PE thấp)" };
  if (v <= 20) return { band: "ok", label: "Hợp lý" };
  if (v <= 35) return { band: "ok", label: "Cao" };
  return { band: "risk", label: "Đắt (PE cao)" };
}

function bandPb(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0) return { band: "risk", label: "VCSH âm" };
  if (v < 1) return { band: "safe", label: "Dưới sổ sách" };
  if (v <= 2.5) return { band: "ok", label: "Hợp lý" };
  return { band: "risk", label: "Cao so với sổ sách" };
}

function bandCurrentRatio(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1) return { band: "risk", label: "Thanh khoản yếu" };
  if (v <= 1.5) return { band: "ok", label: "Chấp nhận" };
  return { band: "safe", label: "An toàn" };
}

function bandNetDebtEbitda(v: number | null): { band: Band; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0) return { band: "safe", label: "Net cash" };
  if (v <= 2) return { band: "safe", label: "An toàn" };
  if (v <= 4) return { band: "ok", label: "Chấp nhận" };
  return { band: "risk", label: "Đòn bẩy cao" };
}

export interface SnapshotBundle {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  shares: number | null;
  price: number | null;
  closes: number[];
  growthYoy: { metric: string; changePct: number | null }[];
  growthQoq: { metric: string; changePct: number | null }[];
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
  const ebitda = n(i0.ebitda);
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
  const debt = std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : null;

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
    (rev != null && revPrev != null && revPrev !== 0 ? (rev - revPrev) / Math.abs(revPrev) : null);
  const yoyNi =
    b.growthYoy.find((g) => /net.?income|lợi nhuận/i.test(g.metric))?.changePct ??
    (ni != null && niPrev != null && niPrev !== 0 ? (ni - niPrev) / Math.abs(niPrev) : null);
  const qoqRev = b.growthQoq.find((g) => /revenue|doanh thu/i.test(g.metric))?.changePct ?? null;

  const grossMargin = div(gp, rev);
  const ebitdaMargin = div(ebitda, rev);
  const netMargin = div(ni, rev);
  const roe = div(ni, equity);
  const roa = div(ni, assets);
  const nopat = ebit != null ? ebit * 0.8 : null;
  const investedCapital =
    equity != null && debt != null && cash != null
      ? equity + debt - cash
      : equity != null && debt != null
        ? equity + debt
        : null;
  const roic = div(nopat, investedCapital);

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
  const netDebt = debt != null && cash != null ? debt - cash : debt;
  const netDebtEbitda = div(netDebt, ebitda != null && ebitda > 0 ? ebitda : null);
  const currentRatio = div(currentAssets, currentLiab);
  const quickRatio = div(
    currentAssets != null && inventory != null ? currentAssets - inventory : currentAssets,
    currentLiab,
  );

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
    mcap != null && debt != null && cash != null && mcap + debt - cash > 0
      ? mcap + debt - cash
      : null;
  const evEbitda =
    b.overrides?.evEbitda ?? (ev != null && ebitda != null && ebitda > 0 ? ev / ebitda : null);
  const peg =
    b.overrides?.peg ??
    (pe != null && yoyNi != null && yoyNi > 0 ? pe / (yoyNi * 100) : null);

  let grahamVnd: number | null = null;
  if (epsVnd != null && epsVnd > 0 && bvpsVnd != null && bvpsVnd > 0) {
    grahamVnd = Math.sqrt(22.5 * epsVnd * bvpsVnd);
  }
  const dcfBase = b.overrides?.dcfBase ?? null;
  const grahamQuote = b.overrides?.graham ?? vndPerShareToQuote(grahamVnd);
  let upsidePct = b.overrides?.upsidePct ?? null;
  if (upsidePct == null && dcfBase != null && priceQuote != null && priceQuote > 0) {
    upsidePct = (dcfBase / priceQuote - 1) * 100;
  }

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
  const divY = perf?.dividendYield ?? b.overrides?.dividendYield ?? null;
  const payout = perf?.payoutRatio ?? null;

  const peBand = bandPe(pe);
  const pbBand = bandPb(pb);
  const crBand = bandCurrentRatio(currentRatio);
  const ndeBand = bandNetDebtEbitda(netDebtEbitda);
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
  ];

  const leverage: MetricCell[] = [
    { key: "de", labelVi: "Nợ / VCSH", value: debtEquity, format: "x", band: deBand.band, bandLabel: deBand.label },
    { key: "ndEbitda", labelVi: "Net Debt / EBITDA", value: netDebtEbitda, format: "x", band: ndeBand.band, bandLabel: ndeBand.label },
    { key: "debtEbitda", labelVi: "Nợ / EBITDA", value: debtEbitda, format: "x" },
    { key: "ic", labelVi: "Interest coverage", value: interestCover, format: "x", band: icBand.band, bandLabel: icBand.label },
    { key: "cr", labelVi: "Current ratio", value: currentRatio, format: "x", band: crBand.band, bandLabel: crBand.label },
    { key: "qr", labelVi: "Quick ratio", value: quickRatio, format: "x" },
    { key: "ea", labelVi: "EBITDA / Assets", value: ebitdaAssets, format: "pct", band: eaBand.band, bandLabel: eaBand.label },
    { key: "altman", labelVi: "Altman Z (ước tính)", value: altman, format: "num", note: "Công thức cổ điển" },
  ];

  const cashflow: MetricCell[] = [
    { key: "ocf", labelVi: "OCF", value: ocf, format: "money" },
    { key: "fcf", labelVi: "FCF", value: fcf, format: "money" },
    { key: "fcfEbit", labelVi: "FCF / EBIT", value: fcfEbit, format: "x", band: feBand.band, bandLabel: feBand.label },
    { key: "ccc", labelVi: "Cash conversion (ngày)", value: ccc, format: "days" },
  ];

  const valuation: MetricCell[] = [
    { key: "pe", labelVi: "P/E", value: pe, format: "x", band: peBand.band, bandLabel: peBand.label },
    { key: "pb", labelVi: "P/B", value: pb, format: "x", band: pbBand.band, bandLabel: pbBand.label },
    { key: "ps", labelVi: "P/S", value: ps, format: "x" },
    { key: "evEbitda", labelVi: "EV/EBITDA", value: evEbitda, format: "x" },
    { key: "peg", labelVi: "PEG", value: peg, format: "x" },
    { key: "graham", labelVi: "Graham (quote)", value: grahamQuote, format: "num", note: "√(22.5×EPS×BVPS)" },
    { key: "dcf", labelVi: "DCF base (quote)", value: dcfBase, format: "num" },
    { key: "upside", labelVi: "Upside vs DCF %", value: upsidePct, format: "pct" },
  ];

  const performance: MetricCell[] = [
    { key: "tsr", labelVi: "TSR / lợi nhuận giá", value: tsr, format: "pct" },
    { key: "beta", labelVi: "Beta", value: beta, format: "num" },
    { key: "sharpe", labelVi: "Sharpe", value: sharpe, format: "num" },
    { key: "alpha", labelVi: "Alpha", value: alpha, format: "pct" },
    { key: "divY", labelVi: "Dividend yield", value: divY, format: "pct" },
    { key: "payout", labelVi: "Payout ratio", value: payout, format: "pct" },
  ];

  return { operating, leverage, cashflow, valuation, performance };
}

export function formatMetric(m: MetricCell): string {
  if (m.value == null || !Number.isFinite(m.value)) return "—";
  const v = m.value;
  switch (m.format) {
    case "pct":
      return `${(v * 100).toFixed(Math.abs(v) >= 0.1 ? 1 : 2)}%`;
    case "x":
      return `${v.toFixed(2)}x`;
    case "money": {
      const abs = Math.abs(v);
      if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
      if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} tỷ`;
      if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} tr`;
      return v.toLocaleString("vi-VN");
    }
    case "days":
      return `${Math.round(v)} ngày`;
    default:
      return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  }
}

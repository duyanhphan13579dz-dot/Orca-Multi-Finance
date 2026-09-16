/**
 * Client-safe fundamental metrics from BCTC snapshot + quote/bars.
 * Missing inputs → null (UI shows "Không đủ dữ liệu").
 *
 * Đơn vị VN: giá quote HOSE thường là nghìn đồng; BCTC là VND đầy đủ.
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
  /** Override từ API valuation / VNDirect ratios */
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
  const interest = n(i0.interestExpense);

  const assets = n(b0.totalAssets);
  const equity = n(b0.equity);
  const ca = n(b0.currentAssets);
  const cl = n(b0.currentLiabilities);
  const cash = n(b0.cash);
  const inv = n(b0.inventory);
  const recv = n(b0.receivables);
  const tl = n(b0.totalLiabilities);
  const std = n(b0.shortTermDebt);
  const ltd = n(b0.longTermDebt);
  const debt = std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : tl;
  const retained = n(b0.retainedEarnings);

  const ocf = n(c0.operatingCashFlow);
  const capex = n(c0.capex) != null ? Math.abs(n(c0.capex)!) : null;
  const fcf =
    n(c0.freeCashFlow) ?? (ocf != null && capex != null ? ocf - capex : ocf);

  const shares = b.shares ?? n(b0.shares) ?? n(i0.shares);
  const epsVnd = shares && ni != null && shares > 0 ? ni / shares : null;
  const bvpsVnd = shares && equity != null && shares > 0 ? equity / shares : null;

  const priceQuote = b.price;
  const priceVnd = priceToVnd(priceQuote);

  const grossMargin = div(gp, rev);
  const ebitdaMargin = div(ebitda, rev);
  const netMargin = div(ni, rev);
  const roe = div(ni, equity);
  const roa = div(ni, assets);
  const nopat = ebit != null ? ebit * 0.8 : null;
  const invested = debt != null && equity != null ? debt + equity - (cash ?? 0) : null;
  const roic = div(nopat, invested);
  const assetTurnover = div(rev, assets);
  const invTurnover = div(n(i0.cogs) ?? (rev != null && gp != null ? rev - gp : null), inv);
  const recvTurnover = div(rev, recv);
  const dio = invTurnover ? 365 / invTurnover : inv != null && rev ? (inv * 365) / rev : null;
  const dso = recvTurnover ? 365 / recvTurnover : recv != null && rev ? (recv * 365) / rev : null;
  const ccc = dio != null && dso != null ? dio + dso : null;

  const debtEquity = div(debt, equity);
  const ebitdaAssets = div(ebitda, assets);
  const interestCover = div(ebitda ?? ebit, interest);
  const fcfEbit = div(fcf, ebit);
  const debtEbitda = div(debt, ebitda);
  const currentRatio = div(ca, cl);
  const quickRatio = ca != null && cl != null ? (ca - (inv ?? 0)) / cl : null;

  const wc = ca != null && cl != null ? ca - cl : null;
  const x1 = div(wc, assets);
  const x2 = div(retained, assets);
  const x3 = div(ebit, assets);
  const mktEquity =
    b.overrides?.marketCap && b.overrides.marketCap > 0
      ? b.overrides.marketCap
      : priceVnd != null && shares != null
        ? priceVnd * shares
        : equity;
  const x4 = div(mktEquity, tl);
  const x5 = div(rev, assets);
  const altman =
    x1 != null && x2 != null && x3 != null && x4 != null && x5 != null
      ? 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5
      : null;

  const deBand = bandDebtEquity(debtEquity);
  const eaBand = bandEbitdaAssets(ebitdaAssets);
  const icBand = bandInterestCover(interestCover);
  const feBand = bandFcfEbit(fcfEbit);

  const yoyRev =
    b.growthYoy.find((g) => g.metric === "netRevenue" || g.metric === "revenue")?.changePct ??
    div(rev != null && revPrev != null ? rev - revPrev : null, revPrev);
  const yoyNi =
    b.growthYoy.find((g) => g.metric === "netIncome")?.changePct ??
    div(ni != null && niPrev != null ? ni - niPrev : null, niPrev);
  const qoqRev =
    b.growthQoq.find((g) => g.metric === "netRevenue" || g.metric === "revenue")?.changePct ?? null;

  // Multiples: giá VND / (EPS|BVPS VND)
  let pe = div(priceVnd, epsVnd);
  let pb = div(priceVnd, bvpsVnd);
  const mcap =
    b.overrides?.marketCap && b.overrides.marketCap > 0
      ? b.overrides.marketCap
      : priceVnd != null && shares != null
        ? priceVnd * shares
        : null;
  let ps = div(mcap, rev);
  const ev = mcap != null ? mcap + (debt ?? 0) - (cash ?? 0) : null;
  let evEbitda = div(ev, ebitda);

  // PEG: P/E ÷ (tăng trưởng EPS % dạng số nguyên, vd 15 = 15%)
  let peg: number | null = null;
  if (pe != null && yoyNi != null && Math.abs(yoyNi) > 0.001) {
    const gPct = Math.abs(yoyNi) < 2 ? yoyNi * 100 : yoyNi;
    if (gPct > 0) peg = pe / gPct;
  }

  // Graham Number (VND) → hiển thị đơn vị quote
  const grahamVnd =
    epsVnd != null && bvpsVnd != null && epsVnd > 0 && bvpsVnd > 0
      ? Math.sqrt(22.5 * epsVnd * bvpsVnd)
      : null;
  let grahamQuote = vndPerShareToQuote(grahamVnd);

  // Overrides từ valuation API / ratios VNDirect (ưu tiên)
  const o = b.overrides;
  if (o?.pe != null && o.pe > 0) pe = o.pe;
  if (o?.pb != null && o.pb > 0) pb = o.pb;
  if (o?.ps != null && o.ps > 0) ps = o.ps;
  if (o?.evEbitda != null && o.evEbitda > 0) evEbitda = o.evEbitda;
  if (o?.peg != null && o.peg > 0) peg = o.peg;
  if (o?.graham != null && o.graham > 0) grahamQuote = o.graham;
  const dcfBase = o?.dcfBase ?? null;
  let upsidePct = o?.upsidePct ?? null;
  if (upsidePct == null && dcfBase != null && priceQuote != null && priceQuote > 0) {
    upsidePct = (dcfBase / priceQuote - 1) * 100;
  }
  if (upsidePct == null && grahamQuote != null && priceQuote != null && priceQuote > 0) {
    upsidePct = (grahamQuote / priceQuote - 1) * 100;
  }

  let tsr: number | null = null;
  if (b.closes.length >= 2) {
    const a0 = b.closes[0]!;
    const z = b.closes[b.closes.length - 1]!;
    if (a0 > 0) tsr = (z - a0) / a0;
  }

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
    { key: "divY", labelVi: "Tỷ suất cổ tức", value: null, format: "pct", note: "Chưa có lịch sử cổ tức" },
    { key: "payout", labelVi: "Tỷ lệ chi trả cổ tức", value: null, format: "pct", note: "Không đủ dữ liệu" },
    {
      key: "tsr",
      labelVi: "Total Shareholder Return",
      value: tsr,
      format: "pct",
      note: "Theo chuỗi giá (chưa gồm cổ tức)",
    },
    { key: "beta", labelVi: "Beta", value: null, format: "num", note: "Cần hiệp phương sai với VN-Index" },
    { key: "sharpe", labelVi: "Sharpe Ratio", value: null, format: "num", note: "Không đủ dữ liệu" },
    { key: "alpha", labelVi: "Alpha vs VN-Index", value: null, format: "pct", note: "Không đủ dữ liệu" },
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

  const cashflow: MetricCell[] = [
    { key: "fcf", labelVi: "FCF", value: fcf, format: "money" },
    { key: "fcfm", labelVi: "Biên FCF", value: div(fcf, rev), format: "pct" },
    { key: "ocfni", labelVi: "CFO / LNST", value: div(ocf, ni), format: "x", note: ">1 lợi nhuận có tiền thật" },
    { key: "ocfdebt", labelVi: "CFO / Tổng nợ vay", value: div(ocf, debt), format: "x" },
    { key: "capexrev", labelVi: "Capex / Doanh thu", value: div(capex, rev), format: "pct" },
    { key: "ccc2", labelVi: "Chu kỳ tiền mặt", value: ccc, format: "days" },
  ];

  const valuation: MetricCell[] = [
    {
      key: "pe",
      labelVi: "P/E",
      value: pe != null && pe > 0 && pe < 500 ? pe : null,
      format: "x",
      note: pe == null ? "Thiếu giá hoặc EPS" : undefined,
    },
    {
      key: "pb",
      labelVi: "P/B",
      value: pb != null && pb > 0 && pb < 100 ? pb : null,
      format: "x",
    },
    {
      key: "ps",
      labelVi: "P/S",
      value: ps != null && ps > 0 && ps < 200 ? ps : null,
      format: "x",
    },
    {
      key: "eve",
      labelVi: "EV/EBITDA",
      value: evEbitda != null && evEbitda > 0 && evEbitda < 200 ? evEbitda : null,
      format: "x",
    },
    {
      key: "peg",
      labelVi: "PEG",
      value: peg != null && peg > 0 && peg < 20 ? peg : null,
      format: "x",
      note: "P/E ÷ (EPS growth %)",
    },
    {
      key: "dcf",
      labelVi: "DCF (giá trị nội tại)",
      value: dcfBase,
      format: "money",
      note: dcfBase == null ? "Cần FCF dương — xem panel Định giá doanh nghiệp" : "Kịch bản Base",
    },
    {
      key: "graham",
      labelVi: "Graham Number",
      value: grahamQuote,
      format: "money",
      note: grahamQuote == null ? "Cần EPS & BVPS dương" : "√(22.5×EPS×BVPS)",
    },
    {
      key: "upside",
      labelVi: "Upside vs giá mục tiêu",
      value: upsidePct != null ? upsidePct / 100 : null,
      format: "pct",
      note:
        upsidePct == null
          ? "Chưa có FV/DCF/Graham"
          : dcfBase != null
            ? "So với DCF Base"
            : "So với Graham Number",
    },
  ];

  const incomeChrono = [...b.income].slice(0, 8).reverse();
  const balChrono = [...b.balance].slice(0, 8).reverse();

  const seriesIncome = incomeChrono.map((r) => ({
    period: periodLabel(r),
    revenue: rowRev(r),
    netIncome: rowNi(r),
    grossProfit: n(r.grossProfit),
    grossMargin: div(n(r.grossProfit), rowRev(r)),
    netMargin: div(rowNi(r), rowRev(r)),
    roe: div(rowNi(r), n(r.equity) ?? equity),
  }));

  const seriesRoe = incomeChrono.map((r, idx) => {
    const bal = balChrono[idx] ?? b0;
    return {
      period: periodLabel(r),
      roe: div(rowNi(r), n(bal.equity)),
      roa: div(rowNi(r), n(bal.totalAssets)),
    };
  });

  return {
    operating,
    investment,
    debtPillars,
    healthExtra,
    cashflow,
    valuation,
    seriesIncome,
    seriesRoe,
    meta: {
      priceQuote,
      priceVnd,
      shares,
      marketCap: mcap,
      epsVnd,
      bvpsVnd,
    },
  };
}

export function formatMetric(m: MetricCell): string {
  if (m.value == null || !Number.isFinite(m.value)) return "Không đủ dữ liệu";
  const v = m.value;
  switch (m.format) {
    case "pct":
      return `${(v * 100).toFixed(Math.abs(v) >= 0.1 ? 1 : 2)}%`;
    case "x":
      return `${v.toFixed(v >= 10 ? 1 : 2)}x`;
    case "days":
      return `${Math.round(v)} ngày`;
    case "money": {
      const abs = Math.abs(v);
      if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
      if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
      if (abs >= 1000) return v.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
      return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
    }
    default:
      return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  }
}

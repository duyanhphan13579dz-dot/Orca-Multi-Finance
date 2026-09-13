/**
 * VALUATION ENGINE — Phase 4
 * Residual Income (RI), Dividend Discount Model (DDM), Net Asset Value (NAV), Sum-of-the-Parts (SOTP).
 * Rules: never invent figures; null + status when inputs missing; no NaN/Infinity.
 */

import type { MetricCell } from "./valuation-phase1";

export const VALUATION_ENGINE_VERSION_PHASE4 = "2.3.0-phase4";

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function round(n: number | null, d = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function cell(
  value: number | null,
  status: MetricCell["status"],
  note?: string,
  inputs?: string[],
): MetricCell {
  if (value != null && !Number.isFinite(value)) {
    return { value: null, status: "invalid", note: note ?? "Non-finite", inputs };
  }
  return { value, status, note, inputs };
}

export interface ResidualIncomeResult {
  bookEquity: number | null;
  costOfEquity: number | null;
  residualIncomes: { year: number; ni: number; charge: number; ri: number; pv: number }[];
  terminalValue: number | null;
  pvTerminal: number | null;
  totalValue: number | null;
  shares: number | null;
  fairPrice: number | null;
  upsidePct: number | null;
  status: MetricCell["status"];
  notes: string[];
}

export function runResidualIncome(input: {
  bookEquity: number | null;
  netIncomeTtm: number | null;
  costOfEquity: number | null;
  shares: number | null;
  currentPrice: number | null;
  forecastYears?: number;
  niGrowth?: number;
  terminalGrowth?: number;
}): ResidualIncomeResult {
  const notes: string[] = [];
  const years = input.forecastYears ?? 5;
  const niG = input.niGrowth ?? 0.05;
  const gTerm = input.terminalGrowth ?? 0.02;

  const empty = (status: MetricCell["status"], note: string): ResidualIncomeResult => ({
    bookEquity: input.bookEquity,
    costOfEquity: input.costOfEquity,
    residualIncomes: [],
    terminalValue: null,
    pvTerminal: null,
    totalValue: null,
    shares: input.shares,
    fairPrice: null,
    upsidePct: null,
    status,
    notes: [note],
  });

  if (!finite(input.bookEquity) || input.bookEquity! <= 0) {
    return empty("incomplete", "Thiếu Book Equity dương cho Residual Income");
  }
  if (!finite(input.netIncomeTtm)) {
    return empty("incomplete", "Thiếu Net Income cho Residual Income");
  }
  if (!finite(input.costOfEquity) || input.costOfEquity! <= 0) {
    return empty("incomplete", "Thiếu Cost of Equity (Ke) cho Residual Income");
  }
  const ke = input.costOfEquity!;
  if (gTerm >= ke) {
    return empty("invalid", `Terminal growth ≥ Ke (${(ke * 100).toFixed(1)}%) — không hợp lệ`);
  }

  let ni = input.netIncomeTtm!;
  let book = input.bookEquity!;
  const rows: ResidualIncomeResult["residualIncomes"] = [];
  let pvRi = 0;

  for (let y = 1; y <= years; y++) {
    ni = ni * (1 + niG);
    const charge = ke * book;
    const ri = ni - charge;
    const df = 1 / (1 + ke) ** y;
    const pv = ri * df;
    rows.push({
      year: y,
      ni: round(ni, 0)!,
      charge: round(charge, 0)!,
      ri: round(ri, 0)!,
      pv: round(pv, 0)!,
    });
    pvRi += pv;
    book = book + ni;
  }

  const riN1 = rows[rows.length - 1]!.ri * (1 + gTerm);
  const tv = riN1 / (ke - gTerm);
  const pvTv = tv / (1 + ke) ** years;
  const total = input.bookEquity! + pvRi + pvTv;

  const shares = finite(input.shares) && input.shares! > 0 ? input.shares! : null;
  const fairPrice = shares != null ? total / shares : null;
  const upsidePct =
    fairPrice != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? (fairPrice / input.currentPrice! - 1) * 100
      : null;

  if (fairPrice == null) notes.push("Thiếu shares — không quy đổi fair price RI");

  return {
    bookEquity: input.bookEquity,
    costOfEquity: ke,
    residualIncomes: rows,
    terminalValue: round(tv, 0),
    pvTerminal: round(pvTv, 0),
    totalValue: round(total, 0),
    shares,
    fairPrice: fairPrice != null ? Math.round(fairPrice) : null,
    upsidePct: upsidePct != null ? round(upsidePct, 1) : null,
    status: notes.length ? "incomplete" : "ok",
    notes,
  };
}

export interface DdmResult {
  model: "gordon" | "two_stage" | "none";
  dps0: number | null;
  dps1: number | null;
  costOfEquity: number | null;
  growthStable: number | null;
  growthHigh: number | null;
  highGrowthYears: number;
  explicitPv: number | null;
  terminalPv: number | null;
  fairPrice: number | null;
  upsidePct: number | null;
  status: MetricCell["status"];
  notes: string[];
}

export function runDdm(input: {
  dps: number | null;
  costOfEquity: number | null;
  currentPrice: number | null;
  growthStable?: number | null;
  growthHigh?: number | null;
  highGrowthYears?: number;
}): DdmResult {
  const notes: string[] = [];
  const empty = (
    status: MetricCell["status"],
    note: string,
    model: DdmResult["model"] = "none",
  ): DdmResult => ({
    model,
    dps0: input.dps,
    dps1: null,
    costOfEquity: input.costOfEquity,
    growthStable: input.growthStable ?? null,
    growthHigh: input.growthHigh ?? null,
    highGrowthYears: input.highGrowthYears ?? 0,
    explicitPv: null,
    terminalPv: null,
    fairPrice: null,
    upsidePct: null,
    status,
    notes: [note],
  });

  if (!finite(input.dps) || input.dps! <= 0) {
    return empty("not_applicable", "Không có cổ tức dương — DDM không áp dụng");
  }
  if (!finite(input.costOfEquity) || input.costOfEquity! <= 0) {
    return empty("incomplete", "Thiếu Ke cho DDM");
  }
  const ke = input.costOfEquity!;
  const gStable = finite(input.growthStable) ? input.growthStable! : 0.03;
  if (gStable >= ke) {
    return empty("invalid", "g stable ≥ Ke — Gordon không hợp lệ");
  }

  const dps0 = input.dps!;
  const highYears = input.highGrowthYears ?? 0;
  const gHigh = finite(input.growthHigh) ? input.growthHigh! : null;

  if (highYears > 0 && gHigh != null && gHigh > gStable) {
    let dps = dps0;
    let pvExplicit = 0;
    for (let y = 1; y <= highYears; y++) {
      dps = dps * (1 + gHigh);
      pvExplicit += dps / (1 + ke) ** y;
    }
    const dpsStable1 = dps * (1 + gStable);
    const tv = dpsStable1 / (ke - gStable);
    const pvTv = tv / (1 + ke) ** highYears;
    const price = pvExplicit + pvTv;
    const upside =
      finite(input.currentPrice) && input.currentPrice! > 0
        ? (price / input.currentPrice! - 1) * 100
        : null;
    return {
      model: "two_stage",
      dps0,
      dps1: round(dps0 * (1 + gHigh), 2),
      costOfEquity: ke,
      growthStable: gStable,
      growthHigh: gHigh,
      highGrowthYears: highYears,
      explicitPv: round(pvExplicit, 0),
      terminalPv: round(pvTv, 0),
      fairPrice: Math.round(price),
      upsidePct: upside != null ? round(upside, 1) : null,
      status: "ok",
      notes,
    };
  }

  const dps1 = dps0 * (1 + gStable);
  const price = dps1 / (ke - gStable);
  const upside =
    finite(input.currentPrice) && input.currentPrice! > 0
      ? (price / input.currentPrice! - 1) * 100
      : null;

  return {
    model: "gordon",
    dps0,
    dps1: round(dps1, 2),
    costOfEquity: ke,
    growthStable: gStable,
    growthHigh: null,
    highGrowthYears: 0,
    explicitPv: null,
    terminalPv: null,
    fairPrice: Math.round(price),
    upsidePct: upside != null ? round(upside, 1) : null,
    status: "ok",
    notes,
  };
}

export function estimateDps(input: {
  dividendsAnnual: number | null;
  shares: number | null;
  dividendYield: number | null;
  price: number | null;
}): MetricCell {
  if (
    finite(input.dividendsAnnual) &&
    input.dividendsAnnual! > 0 &&
    finite(input.shares) &&
    input.shares! > 0
  ) {
    return cell(round(input.dividendsAnnual! / input.shares!, 2), "ok", undefined, [
      "dividendsAnnual",
      "shares",
    ]);
  }
  if (
    finite(input.dividendYield) &&
    input.dividendYield! > 0 &&
    finite(input.price) &&
    input.price! > 0
  ) {
    const y = input.dividendYield! > 1 ? input.dividendYield! / 100 : input.dividendYield!;
    return cell(round(y * input.price!, 2), "incomplete", "DPS ước từ yield × price", [
      "dividendYield",
      "price",
    ]);
  }
  return cell(null, "incomplete", "Không có dữ liệu cổ tức", ["dividendsAnnual", "dividendYield"]);
}

export interface NavResult {
  totalAssets: number | null;
  totalLiabilities: number | null;
  bookEquity: number | null;
  adjustments: number;
  adjustedEquity: number | null;
  shares: number | null;
  navPerShare: number | null;
  adjustedNavPerShare: number | null;
  upsidePct: number | null;
  status: MetricCell["status"];
  notes: string[];
}

export function runNav(input: {
  totalAssets: number | null;
  totalLiabilities: number | null;
  bookEquity: number | null;
  shares: number | null;
  currentPrice: number | null;
  fairValueAdjustments?: number | null;
}): NavResult {
  const notes: string[] = [];
  let equity = finite(input.bookEquity) ? input.bookEquity! : null;
  if (equity == null && finite(input.totalAssets) && finite(input.totalLiabilities)) {
    equity = input.totalAssets! - input.totalLiabilities!;
  }
  if (equity == null) {
    return {
      totalAssets: input.totalAssets,
      totalLiabilities: input.totalLiabilities,
      bookEquity: null,
      adjustments: 0,
      adjustedEquity: null,
      shares: input.shares,
      navPerShare: null,
      adjustedNavPerShare: null,
      upsidePct: null,
      status: "incomplete",
      notes: ["Thiếu equity / assets−liabilities cho NAV"],
    };
  }

  const adj = finite(input.fairValueAdjustments) ? input.fairValueAdjustments! : 0;
  if (adj !== 0) notes.push("Đã áp dụng fair-value adjustments do caller cung cấp");
  const adjusted = equity + adj;

  const shares = finite(input.shares) && input.shares! > 0 ? input.shares! : null;
  const navPs = shares != null ? equity / shares : null;
  const adjNavPs = shares != null ? adjusted / shares : null;
  const upside =
    adjNavPs != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? (adjNavPs / input.currentPrice! - 1) * 100
      : navPs != null && finite(input.currentPrice) && input.currentPrice! > 0
        ? (navPs / input.currentPrice! - 1) * 100
        : null;

  if (shares == null) notes.push("Thiếu shares — không quy đổi NAV/cổ phiếu");

  return {
    totalAssets: input.totalAssets,
    totalLiabilities: input.totalLiabilities,
    bookEquity: round(equity, 0),
    adjustments: adj,
    adjustedEquity: round(adjusted, 0),
    shares,
    navPerShare: navPs != null ? Math.round(navPs) : null,
    adjustedNavPerShare: adjNavPs != null ? Math.round(adjNavPs) : null,
    upsidePct: upside != null ? round(upside, 1) : null,
    status: shares == null ? "incomplete" : "ok",
    notes,
  };
}

export interface SotPSegment {
  name: string;
  value: number | null;
  valueType: "equity" | "enterprise";
  metric?: number | null;
  multiple?: number | null;
  note?: string;
}

export interface SotPResult {
  segments: SotPSegment[];
  sumEnterprise: number | null;
  sumEquity: number | null;
  netDebt: number | null;
  holdingDiscount: number;
  equityAfterDiscount: number | null;
  shares: number | null;
  fairPrice: number | null;
  upsidePct: number | null;
  status: MetricCell["status"];
  notes: string[];
}

export function runSotp(input: {
  segments: SotPSegment[];
  netDebt?: number | null;
  shares?: number | null;
  currentPrice?: number | null;
  holdingDiscount?: number | null;
}): SotPResult {
  const notes: string[] = [];
  if (!input.segments.length) {
    return {
      segments: [],
      sumEnterprise: null,
      sumEquity: null,
      netDebt: input.netDebt ?? null,
      holdingDiscount: 0,
      equityAfterDiscount: null,
      shares: input.shares ?? null,
      fairPrice: null,
      upsidePct: null,
      status: "not_applicable",
      notes: ["Không có segment — SOTP không áp dụng (cần breakdown từ data layer)"],
    };
  }

  let sumEv = 0;
  let sumEq = 0;
  let hasEv = false;
  let hasEq = false;
  let missing = 0;

  for (const s of input.segments) {
    let v = s.value;
    if (v == null && finite(s.metric) && finite(s.multiple) && s.metric! > 0 && s.multiple! > 0) {
      v = s.metric! * s.multiple!;
    }
    if (!finite(v)) {
      missing++;
      continue;
    }
    if (s.valueType === "enterprise") {
      sumEv += v!;
      hasEv = true;
    } else {
      sumEq += v!;
      hasEq = true;
    }
  }

  if (missing) notes.push(`${missing} segment thiếu value — bỏ qua khi cộng`);

  const netDebt = finite(input.netDebt) ? input.netDebt! : 0;
  let equity = (hasEq ? sumEq : 0) + (hasEv ? sumEv - netDebt : 0);
  if (hasEv && !finite(input.netDebt)) {
    notes.push("Có segment EV nhưng thiếu net debt — chưa trừ nợ ròng");
  }

  const disc =
    finite(input.holdingDiscount) && input.holdingDiscount! > 0 && input.holdingDiscount! < 1
      ? input.holdingDiscount!
      : 0;
  if (disc > 0) notes.push(`Áp dụng holding discount ${(disc * 100).toFixed(0)}%`);
  const afterDisc = equity * (1 - disc);

  const shares = finite(input.shares) && input.shares! > 0 ? input.shares! : null;
  const fairPrice = shares != null ? afterDisc / shares : null;
  const upside =
    fairPrice != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? (fairPrice / input.currentPrice! - 1) * 100
      : null;

  const status: MetricCell["status"] =
    fairPrice != null ? "ok" : "incomplete";

  return {
    segments: input.segments,
    sumEnterprise: hasEv ? round(sumEv, 0) : null,
    sumEquity: hasEq ? round(sumEq, 0) : null,
    netDebt: finite(input.netDebt) ? input.netDebt! : null,
    holdingDiscount: disc,
    equityAfterDiscount: round(afterDisc, 0),
    shares,
    fairPrice: fairPrice != null ? Math.round(fairPrice) : null,
    upsidePct: upside != null ? round(upside, 1) : null,
    status,
    notes,
  };
}

export interface Phase4ValuationResult {
  residualIncome: ResidualIncomeResult | null;
  ddm: DdmResult | null;
  nav: NavResult | null;
  sotp: SotPResult | null;
  methodPrices: {
    residualIncome: number | null;
    ddm: number | null;
    nav: number | null;
    sotp: number | null;
  };
  notes: string[];
  valuationEngineVersion: string;
}

export function buildPhase4Valuation(input: {
  currentPrice: number | null;
  shares: number | null;
  bookEquity: number | null;
  netIncomeTtm: number | null;
  costOfEquity: number | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  dividendsAnnual?: number | null;
  dividendYield?: number | null;
  industryProfileId?: string | null;
  sotpSegments?: SotPSegment[];
  netDebt?: number | null;
  fairValueAdjustments?: number | null;
  holdingDiscount?: number | null;
  niGrowth?: number | null;
  ddmGrowthStable?: number | null;
  ddmGrowthHigh?: number | null;
  ddmHighYears?: number;
}): Phase4ValuationResult {
  const notes: string[] = [];
  const profile = (input.industryProfileId ?? "").toUpperCase();

  let residualIncome: ResidualIncomeResult | null = null;
  if (finite(input.bookEquity) && finite(input.netIncomeTtm) && finite(input.costOfEquity)) {
    residualIncome = runResidualIncome({
      bookEquity: input.bookEquity,
      netIncomeTtm: input.netIncomeTtm,
      costOfEquity: input.costOfEquity,
      shares: input.shares,
      currentPrice: input.currentPrice,
      niGrowth: input.niGrowth ?? 0.05,
      terminalGrowth: 0.02,
    });
    notes.push(...residualIncome.notes.map((n) => `[RI] ${n}`));
    if (profile === "BANKING" || profile === "INSURANCE") {
      notes.push("[RI] Ưu tiên Residual Income cho ngân hàng / bảo hiểm");
    }
  } else {
    notes.push("[RI] Thiếu book equity / NI / Ke — bỏ qua Residual Income");
  }

  const dpsCell = estimateDps({
    dividendsAnnual: input.dividendsAnnual ?? null,
    shares: input.shares,
    dividendYield: input.dividendYield ?? null,
    price: input.currentPrice,
  });
  let ddm: DdmResult | null = null;
  if (dpsCell.value != null && finite(input.costOfEquity)) {
    ddm = runDdm({
      dps: dpsCell.value,
      costOfEquity: input.costOfEquity,
      currentPrice: input.currentPrice,
      growthStable: input.ddmGrowthStable ?? 0.03,
      growthHigh: input.ddmGrowthHigh ?? null,
      highGrowthYears: input.ddmHighYears ?? 0,
    });
    notes.push(...ddm.notes.map((n) => `[DDM] ${n}`));
  } else {
    notes.push("[DDM] Không đủ cổ tức / Ke — DDM không chạy");
  }

  const nav = runNav({
    totalAssets: input.totalAssets ?? null,
    totalLiabilities: input.totalLiabilities ?? null,
    bookEquity: input.bookEquity,
    shares: input.shares,
    currentPrice: input.currentPrice,
    fairValueAdjustments: input.fairValueAdjustments ?? null,
  });
  notes.push(...nav.notes.map((n) => `[NAV] ${n}`));
  if (profile === "REAL_ESTATE") {
    notes.push("[NAV] NAV quan trọng với BĐS — cần FV adjustments từ data layer nếu có");
  }

  const sotp = runSotp({
    segments: input.sotpSegments ?? [],
    netDebt: input.netDebt ?? null,
    shares: input.shares ?? null,
    currentPrice: input.currentPrice ?? null,
    holdingDiscount: input.holdingDiscount ?? null,
  });
  notes.push(...sotp.notes.map((n) => `[SOTP] ${n}`));

  return {
    residualIncome,
    ddm,
    nav,
    sotp,
    methodPrices: {
      residualIncome: residualIncome?.fairPrice ?? null,
      ddm: ddm?.fairPrice ?? null,
      nav: nav.adjustedNavPerShare ?? nav.navPerShare,
      sotp: sotp.fairPrice,
    },
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE4,
  };
}

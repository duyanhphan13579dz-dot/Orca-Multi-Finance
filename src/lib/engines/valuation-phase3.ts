/**
 * VALUATION ENGINE — Phase 3
 * Full DCF (two-stage + Gordon TV), sensitivity matrix, fair-value aggregator.
 * Rules: never invent figures; WACC > g; weights redistribute when method lacks data.
 */

import type { MetricCell } from "./valuation-phase1";

export const VALUATION_ENGINE_VERSION_PHASE3 = "2.2.0-phase3";

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function round(n: number | null, d = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function calcCostOfEquity(input: {
  riskFreeRate: number | null;
  beta: number | null;
  equityRiskPremium: number | null;
  countryRiskPremium?: number | null;
}): MetricCell {
  if (!finite(input.riskFreeRate) || !finite(input.beta) || !finite(input.equityRiskPremium)) {
    return {
      value: null,
      status: "incomplete",
      note: "Thiếu Rf / Beta / ERP để tính Cost of Equity",
      inputs: ["riskFreeRate", "beta", "equityRiskPremium"],
    };
  }
  const crp =
    finite(input.countryRiskPremium) && input.countryRiskPremium! >= 0
      ? input.countryRiskPremium!
      : 0;
  const ke = input.riskFreeRate + input.beta * input.equityRiskPremium + crp;
  if (ke <= 0 || ke > 0.5) {
    return {
      value: null,
      status: "invalid",
      note: `Ke=${ke} ngoài khoảng hợp lý`,
      inputs: ["riskFreeRate", "beta", "equityRiskPremium"],
    };
  }
  return {
    value: round(ke, 6),
    status: "ok",
    inputs: ["riskFreeRate", "beta", "equityRiskPremium"],
  };
}

export function calcWacc(input: {
  equityValue: number | null;
  debtValue: number | null;
  costOfEquity: number | null;
  costOfDebt: number | null;
  taxRate: number | null;
}): MetricCell {
  const { equityValue, debtValue, costOfEquity, costOfDebt, taxRate } = input;
  if (!finite(equityValue) || equityValue <= 0 || !finite(costOfEquity)) {
    return {
      value: null,
      status: "incomplete",
      note: "Thiếu Equity value hoặc Ke để tính WACC",
      inputs: ["equityValue", "costOfEquity"],
    };
  }
  const d = finite(debtValue) && debtValue! > 0 ? debtValue! : 0;
  const e = equityValue;
  const v = e + d;
  const t = finite(taxRate) && taxRate! >= 0 && taxRate! < 1 ? taxRate! : 0.2;
  const kd = finite(costOfDebt) && costOfDebt! > 0 ? costOfDebt! : costOfEquity * 0.6;
  const wacc = (e / v) * costOfEquity + (d / v) * kd * (1 - t);
  if (!Number.isFinite(wacc) || wacc <= 0 || wacc > 0.4) {
    return {
      value: null,
      status: "invalid",
      note: `WACC=${wacc} ngoài khoảng hợp lý`,
    };
  }
  const incomplete = !finite(debtValue) || !finite(costOfDebt) || !finite(taxRate);
  return {
    value: round(wacc, 6),
    status: incomplete ? "incomplete" : "ok",
    note: incomplete
      ? "WACC ước lượng — thiếu một phần D / Kd / tax (dùng fallback có ghi chú)"
      : undefined,
    inputs: ["equityValue", "debtValue", "costOfEquity", "costOfDebt", "taxRate"],
  };
}

export interface DcfAssumptions {
  forecastYears: number;
  growthY1toN: number;
  terminalGrowth: number;
  discountRate: number;
  cashFlowType: "fcff" | "fcfe" | "fcf_proxy";
  label: "Bear" | "Base" | "Bull" | "Custom";
}

export interface DcfYearRow {
  year: number;
  fcf: number;
  discountFactor: number;
  pv: number;
}

export interface DcfResult {
  label: DcfAssumptions["label"];
  assumptions: DcfAssumptions;
  baseFcf: number;
  explicitYears: DcfYearRow[];
  terminalValue: number | null;
  pvTerminal: number | null;
  enterpriseOrEquityValue: number | null;
  netDebt: number | null;
  equityValue: number | null;
  shares: number | null;
  fairPrice: number | null;
  upsidePct: number | null;
  status: "ok" | "incomplete" | "invalid";
  notes: string[];
}

export function runDcf(input: {
  baseFcf: number | null;
  shares: number | null;
  currentPrice: number | null;
  netDebt?: number | null;
  assumptions: DcfAssumptions;
}): DcfResult {
  const notes: string[] = [];
  const a = input.assumptions;
  const empty = (status: DcfResult["status"], note: string): DcfResult => ({
    label: a.label,
    assumptions: a,
    baseFcf: input.baseFcf ?? 0,
    explicitYears: [],
    terminalValue: null,
    pvTerminal: null,
    enterpriseOrEquityValue: null,
    netDebt: input.netDebt ?? null,
    equityValue: null,
    shares: input.shares,
    fairPrice: null,
    upsidePct: null,
    status,
    notes: [note],
  });

  if (!finite(input.baseFcf) || input.baseFcf! <= 0) {
    return empty("incomplete", "Thiếu FCF dương để chạy DCF");
  }
  if (!finite(a.discountRate) || a.discountRate <= 0) {
    return empty("invalid", "Discount rate không hợp lệ");
  }
  if (a.terminalGrowth >= a.discountRate) {
    return empty(
      "invalid",
      `Terminal growth (${(a.terminalGrowth * 100).toFixed(2)}%) ≥ discount rate (${(a.discountRate * 100).toFixed(2)}%) — không cho phép`,
    );
  }
  if (a.forecastYears < 1 || a.forecastYears > 15) {
    return empty("invalid", "forecastYears phải trong [1, 15]");
  }

  const gExplicit = a.growthY1toN;
  const gTerm = a.terminalGrowth;
  const r = a.discountRate;
  let fcf = input.baseFcf!;
  const rows: DcfYearRow[] = [];
  let pvExplicit = 0;

  for (let y = 1; y <= a.forecastYears; y++) {
    fcf = fcf * (1 + gExplicit);
    const df = 1 / (1 + r) ** y;
    const pv = fcf * df;
    rows.push({ year: y, fcf: round(fcf, 0)!, discountFactor: round(df, 6)!, pv: round(pv, 0)! });
    pvExplicit += pv;
  }

  const fcfN1 = fcf * (1 + gTerm);
  const tv = fcfN1 / (r - gTerm);
  const pvTv = tv / (1 + r) ** a.forecastYears;
  const totalPv = pvExplicit + pvTv;

  let equityValue: number | null = totalPv;
  const netDebt = finite(input.netDebt) ? input.netDebt! : null;

  if (a.cashFlowType === "fcff") {
    if (netDebt == null) {
      notes.push("FCFF path thiếu net debt — equity value ≈ EV (chưa trừ nợ ròng)");
    } else {
      equityValue = totalPv - netDebt;
    }
  }

  const shares = finite(input.shares) && input.shares! > 0 ? input.shares! : null;
  const fairPrice =
    equityValue != null && shares != null && shares > 0 ? equityValue / shares : null;
  const upsidePct =
    fairPrice != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? (fairPrice / input.currentPrice! - 1) * 100
      : null;

  if (fairPrice == null) notes.push("Thiếu shares — không quy đổi fair price/cổ phiếu");

  return {
    label: a.label,
    assumptions: a,
    baseFcf: input.baseFcf!,
    explicitYears: rows,
    terminalValue: round(tv, 0),
    pvTerminal: round(pvTv, 0),
    enterpriseOrEquityValue: round(totalPv, 0),
    netDebt,
    equityValue: equityValue != null ? round(equityValue, 0) : null,
    shares,
    fairPrice: fairPrice != null ? Math.round(fairPrice) : null,
    upsidePct: upsidePct != null ? round(upsidePct, 1) : null,
    status: notes.some((n) => n.includes("Thiếu")) ? "incomplete" : "ok",
    notes,
  };
}

export function defaultDcfScenarios(discountRate: number): DcfAssumptions[] {
  const r = Math.max(0.08, Math.min(0.2, discountRate));
  return [
    {
      label: "Bear",
      forecastYears: 5,
      growthY1toN: 0.02,
      terminalGrowth: Math.min(0.015, r - 0.02),
      discountRate: r + 0.02,
      cashFlowType: "fcf_proxy",
    },
    {
      label: "Base",
      forecastYears: 5,
      growthY1toN: 0.08,
      terminalGrowth: Math.min(0.025, r - 0.015),
      discountRate: r,
      cashFlowType: "fcf_proxy",
    },
    {
      label: "Bull",
      forecastYears: 5,
      growthY1toN: 0.14,
      terminalGrowth: Math.min(0.03, r - 0.01),
      discountRate: Math.max(0.08, r - 0.015),
      cashFlowType: "fcf_proxy",
    },
  ];
}

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  fairPrice: number | null;
  equityValue: number | null;
  upsidePct: number | null;
  valid: boolean;
}

export interface SensitivityMatrix {
  waccAxis: number[];
  growthAxis: number[];
  cells: SensitivityCell[][];
  baseWacc: number;
  baseGrowth: number;
  notes: string[];
}

export function buildSensitivityMatrix(input: {
  baseFcf: number | null;
  shares: number | null;
  currentPrice: number | null;
  netDebt?: number | null;
  baseWacc: number;
  baseGrowth: number;
  cashFlowType?: DcfAssumptions["cashFlowType"];
  waccAxis?: number[];
  growthAxis?: number[];
}): SensitivityMatrix {
  const notes: string[] = [];
  const baseWacc = input.baseWacc;
  const baseGrowth = input.baseGrowth;

  const waccAxis =
    input.waccAxis ??
    [baseWacc - 0.02, baseWacc - 0.01, baseWacc, baseWacc + 0.01, baseWacc + 0.02].map(
      (x) => round(Math.max(0.05, x), 4)!,
    );
  const growthAxis =
    input.growthAxis ?? [0.015, 0.02, 0.025, 0.03, 0.035].map((x) => round(x, 4)!);

  const cells: SensitivityCell[][] = [];
  for (const g of growthAxis) {
    const row: SensitivityCell[] = [];
    for (const w of waccAxis) {
      if (g >= w) {
        row.push({
          wacc: w,
          terminalGrowth: g,
          fairPrice: null,
          equityValue: null,
          upsidePct: null,
          valid: false,
        });
        continue;
      }
      const dcf = runDcf({
        baseFcf: input.baseFcf,
        shares: input.shares,
        currentPrice: input.currentPrice,
        netDebt: input.netDebt,
        assumptions: {
          label: "Custom",
          forecastYears: 5,
          growthY1toN: 0.08,
          terminalGrowth: g,
          discountRate: w,
          cashFlowType: input.cashFlowType ?? "fcf_proxy",
        },
      });
      row.push({
        wacc: w,
        terminalGrowth: g,
        fairPrice: dcf.fairPrice,
        equityValue: dcf.equityValue,
        upsidePct: dcf.upsidePct,
        valid: dcf.status !== "invalid" && dcf.fairPrice != null,
      });
    }
    cells.push(row);
  }

  if (!finite(input.baseFcf) || input.baseFcf! <= 0) {
    notes.push("Sensitivity không tính được — thiếu FCF dương");
  }

  return { waccAxis, growthAxis, cells, baseWacc, baseGrowth, notes };
}

export interface MultipleFairValue {
  method: "pe" | "pb" | "evEbitda" | "pfcf";
  fairMultiple: number | null;
  fundamentalPerShare: number | null;
  fairPrice: number | null;
  status: "ok" | "incomplete" | "not_applicable";
  note?: string;
}

export function fairFromMultiple(input: {
  method: MultipleFairValue["method"];
  fairMultiple: number | null;
  eps?: number | null;
  bvps?: number | null;
  ebitdaPerShare?: number | null;
  fcfPerShare?: number | null;
}): MultipleFairValue {
  const m = input.fairMultiple;
  if (!finite(m) || m <= 0) {
    return {
      method: input.method,
      fairMultiple: null,
      fundamentalPerShare: null,
      fairPrice: null,
      status: "incomplete",
      note: "Thiếu fair multiple",
    };
  }
  let fund: number | null = null;
  if (input.method === "pe") fund = input.eps ?? null;
  else if (input.method === "pb") fund = input.bvps ?? null;
  else if (input.method === "evEbitda") fund = input.ebitdaPerShare ?? null;
  else if (input.method === "pfcf") fund = input.fcfPerShare ?? null;

  if (!finite(fund) || fund! <= 0) {
    return {
      method: input.method,
      fairMultiple: m,
      fundamentalPerShare: fund,
      fairPrice: null,
      status: "not_applicable",
      note: "Fundamental per share ≤ 0 hoặc thiếu",
    };
  }
  return {
    method: input.method,
    fairMultiple: m,
    fundamentalPerShare: fund,
    fairPrice: Math.round(m * fund!),
    status: "ok",
  };
}

export type ValuationStatus =
  | "deep_undervalued"
  | "undervalued"
  | "fairly_valued"
  | "overvalued"
  | "deep_overvalued"
  | "insufficient_data";

export interface FairValueWeights {
  dcf: number;
  pe: number;
  pb: number;
  evEbitda: number;
  pfcf: number;
}

export interface FairValueAggregate {
  methods: {
    dcfBase: number | null;
    dcfBear: number | null;
    dcfBull: number | null;
    peBased: number | null;
    pbBased: number | null;
    evEbitdaBased: number | null;
    pfcfBased: number | null;
  };
  weightsUsed: FairValueWeights;
  blendedFairValue: number | null;
  currentPrice: number | null;
  upsidePct: number | null;
  valuationStatus: ValuationStatus;
  confidence: "very_low" | "low" | "medium" | "high" | "very_high";
  notes: string[];
}

const DEFAULT_WEIGHTS: FairValueWeights = {
  dcf: 0.35,
  pe: 0.2,
  pb: 0.15,
  evEbitda: 0.15,
  pfcf: 0.15,
};

function classifyStatus(upsidePct: number | null, methodCount: number): ValuationStatus {
  if (upsidePct == null || methodCount < 1) return "insufficient_data";
  if (upsidePct >= 40 && methodCount >= 2) return "deep_undervalued";
  if (upsidePct >= 15) return "undervalued";
  if (upsidePct > -15) return "fairly_valued";
  if (upsidePct > -40) return "overvalued";
  return "deep_overvalued";
}

function confidenceFrom(args: {
  methodCount: number;
  dataQuality: number | null;
  dcfOk: boolean;
}): FairValueAggregate["confidence"] {
  let score = 0;
  score += Math.min(args.methodCount, 4) * 15;
  if (args.dcfOk) score += 20;
  if (args.dataQuality != null) score += (args.dataQuality / 100) * 20;
  if (score >= 85) return "very_high";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "very_low";
}

export function aggregateFairValue(input: {
  currentPrice: number | null;
  dcfResults: DcfResult[];
  multipleFairs: MultipleFairValue[];
  weights?: Partial<FairValueWeights>;
  dataQuality?: number | null;
}): FairValueAggregate {
  const notes: string[] = [];
  const w: FairValueWeights = { ...DEFAULT_WEIGHTS, ...input.weights };

  const dcfBase = input.dcfResults.find((d) => d.label === "Base");
  const dcfBear = input.dcfResults.find((d) => d.label === "Bear");
  const dcfBull = input.dcfResults.find((d) => d.label === "Bull");

  const peBased = input.multipleFairs.find((m) => m.method === "pe")?.fairPrice ?? null;
  const pbBased = input.multipleFairs.find((m) => m.method === "pb")?.fairPrice ?? null;
  const evBased = input.multipleFairs.find((m) => m.method === "evEbitda")?.fairPrice ?? null;
  const pfcfBased = input.multipleFairs.find((m) => m.method === "pfcf")?.fairPrice ?? null;

  const parts: { key: keyof FairValueWeights; price: number | null; weight: number }[] = [
    { key: "dcf", price: dcfBase?.fairPrice ?? null, weight: w.dcf },
    { key: "pe", price: peBased, weight: w.pe },
    { key: "pb", price: pbBased, weight: w.pb },
    { key: "evEbitda", price: evBased, weight: w.evEbitda },
    { key: "pfcf", price: pfcfBased, weight: w.pfcf },
  ];

  const active = parts.filter((p) => finite(p.price) && p.price! > 0 && p.weight > 0);
  const weightsUsed: FairValueWeights = { dcf: 0, pe: 0, pb: 0, evEbitda: 0, pfcf: 0 };

  let blended: number | null = null;
  if (active.length) {
    const sumW = active.reduce((s, p) => s + p.weight, 0);
    blended = 0;
    for (const p of active) {
      const nw = p.weight / sumW;
      weightsUsed[p.key] = round(nw, 4)!;
      blended += p.price! * nw;
    }
    blended = Math.round(blended);
  } else {
    notes.push("Không đủ phương pháp để tổng hợp Fair Value");
  }

  for (const p of parts) {
    if (!finite(p.price) && p.weight > 0) {
      notes.push(`Phương pháp ${p.key} không đủ dữ liệu — weight = 0, phân bổ lại`);
    }
  }

  const upside =
    blended != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? round((blended / input.currentPrice! - 1) * 100, 1)
      : null;

  const methodCount = active.length;
  const dcfOk = dcfBase?.status === "ok" && dcfBase.fairPrice != null;

  return {
    methods: {
      dcfBase: dcfBase?.fairPrice ?? null,
      dcfBear: dcfBear?.fairPrice ?? null,
      dcfBull: dcfBull?.fairPrice ?? null,
      peBased,
      pbBased,
      evEbitdaBased: evBased,
      pfcfBased,
    },
    weightsUsed,
    blendedFairValue: blended,
    currentPrice: input.currentPrice,
    upsidePct: upside,
    valuationStatus: classifyStatus(upside, methodCount),
    confidence: confidenceFrom({
      methodCount,
      dataQuality: input.dataQuality ?? null,
      dcfOk,
    }),
    notes,
  };
}

export interface Phase3ValuationResult {
  dcf: DcfResult[];
  sensitivity: SensitivityMatrix | null;
  fairValue: FairValueAggregate;
  costOfCapital: {
    costOfEquity: MetricCell;
    wacc: MetricCell;
  };
  notes: string[];
  valuationEngineVersion: string;
}

export function buildPhase3Valuation(input: {
  currentPrice: number | null;
  shares: number | null;
  baseFcf: number | null;
  netDebt?: number | null;
  marketCap?: number | null;
  totalDebt?: number | null;
  riskFreeRate?: number | null;
  beta?: number | null;
  equityRiskPremium?: number | null;
  costOfDebt?: number | null;
  taxRate?: number | null;
  fallbackDiscountRate?: number;
  fairPe?: number | null;
  fairPb?: number | null;
  fairEvEbitda?: number | null;
  fairPfcf?: number | null;
  epsTtm?: number | null;
  bvps?: number | null;
  ebitdaTtm?: number | null;
  fcfTtm?: number | null;
  dataQuality?: number | null;
  weights?: Partial<FairValueWeights>;
}): Phase3ValuationResult {
  const notes: string[] = [];
  const fallbackR = input.fallbackDiscountRate ?? 0.12;

  const ke = calcCostOfEquity({
    riskFreeRate: input.riskFreeRate ?? null,
    beta: input.beta ?? null,
    equityRiskPremium: input.equityRiskPremium ?? null,
  });
  const wacc = calcWacc({
    equityValue: input.marketCap ?? null,
    debtValue: input.totalDebt ?? null,
    costOfEquity: ke.value,
    costOfDebt: input.costOfDebt ?? null,
    taxRate: input.taxRate ?? null,
  });

  const discountRate = wacc.value ?? ke.value ?? fallbackR;
  if (wacc.value == null && ke.value == null) {
    notes.push(`Dùng discount rate mặc định ${(fallbackR * 100).toFixed(1)}% — thiếu WACC/Ke`);
  }

  const scenarios = defaultDcfScenarios(discountRate);
  const dcfResults = scenarios.map((assumptions) =>
    runDcf({
      baseFcf: input.baseFcf,
      shares: input.shares,
      currentPrice: input.currentPrice,
      netDebt: input.netDebt,
      assumptions,
    }),
  );
  for (const d of dcfResults) notes.push(...d.notes.map((n) => `[DCF ${d.label}] ${n}`));

  const baseScenario = dcfResults.find((d) => d.label === "Base");
  const sensitivity =
    finite(input.baseFcf) && input.baseFcf! > 0
      ? buildSensitivityMatrix({
          baseFcf: input.baseFcf,
          shares: input.shares,
          currentPrice: input.currentPrice,
          netDebt: input.netDebt,
          baseWacc: discountRate,
          baseGrowth: baseScenario?.assumptions.terminalGrowth ?? 0.025,
        })
      : null;
  if (sensitivity) notes.push(...sensitivity.notes);

  const shares = input.shares;
  const ebitdaPerShare =
    finite(input.ebitdaTtm) && finite(shares) && shares! > 0
      ? input.ebitdaTtm! / shares!
      : null;
  const fcfPerShare =
    finite(input.fcfTtm) && finite(shares) && shares! > 0 ? input.fcfTtm! / shares! : null;

  const multipleFairs: MultipleFairValue[] = [
    fairFromMultiple({ method: "pe", fairMultiple: input.fairPe ?? null, eps: input.epsTtm }),
    fairFromMultiple({ method: "pb", fairMultiple: input.fairPb ?? null, bvps: input.bvps }),
    fairFromMultiple({
      method: "evEbitda",
      fairMultiple: input.fairEvEbitda ?? null,
      ebitdaPerShare,
    }),
    fairFromMultiple({
      method: "pfcf",
      fairMultiple: input.fairPfcf ?? null,
      fcfPerShare,
    }),
  ];

  const fairValue = aggregateFairValue({
    currentPrice: input.currentPrice,
    dcfResults,
    multipleFairs,
    weights: input.weights,
    dataQuality: input.dataQuality,
  });
  notes.push(...fairValue.notes);

  return {
    dcf: dcfResults,
    sensitivity,
    fairValue,
    costOfCapital: { costOfEquity: ke, wacc },
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE3,
  };
}

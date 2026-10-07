/**
 * VALUATION ENGINE — Phase 5
 * Industry method weighting, Valuation Score (0–100), confidence bands.
 * Rules: never invent figures; score only from computed method prices + data quality.
 */

import type { IndustryProfileId } from "../financial/industry-profiles";
import type { FairValueAggregate, ValuationStatus } from "./valuation-phase3";
import type { Phase4ValuationResult } from "./valuation-phase4";

export const VALUATION_ENGINE_VERSION_PHASE5 = "2.4.0-phase5";

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function round(n: number | null, d = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface IndustryMethodWeights {
  dcf: number;
  pe: number;
  pb: number;
  evEbitda: number;
  pfcf: number;
  residualIncome: number;
  ddm: number;
  nav: number;
  sotp: number;
}

const METHOD_WEIGHTS: Record<IndustryProfileId, IndustryMethodWeights> = {
  BANKING: {
    dcf: 0.08, pe: 0.12, pb: 0.18, evEbitda: 0.0, pfcf: 0.05,
    residualIncome: 0.28, ddm: 0.12, nav: 0.12, sotp: 0.05,
  },
  SECURITIES: {
    dcf: 0.12, pe: 0.18, pb: 0.2, evEbitda: 0.05, pfcf: 0.08,
    residualIncome: 0.15, ddm: 0.1, nav: 0.07, sotp: 0.05,
  },
  INSURANCE: {
    dcf: 0.1, pe: 0.12, pb: 0.15, evEbitda: 0.05, pfcf: 0.08,
    residualIncome: 0.25, ddm: 0.1, nav: 0.1, sotp: 0.05,
  },
  REAL_ESTATE: {
    dcf: 0.15, pe: 0.08, pb: 0.12, evEbitda: 0.08, pfcf: 0.1,
    residualIncome: 0.05, ddm: 0.05, nav: 0.27, sotp: 0.1,
  },
  MANUFACTURING: {
    dcf: 0.25, pe: 0.15, pb: 0.1, evEbitda: 0.15, pfcf: 0.12,
    residualIncome: 0.08, ddm: 0.05, nav: 0.05, sotp: 0.05,
  },
  RETAIL: {
    dcf: 0.22, pe: 0.18, pb: 0.1, evEbitda: 0.12, pfcf: 0.15,
    residualIncome: 0.05, ddm: 0.08, nav: 0.05, sotp: 0.05,
  },
  ENERGY: {
    dcf: 0.2, pe: 0.12, pb: 0.1, evEbitda: 0.18, pfcf: 0.15,
    residualIncome: 0.05, ddm: 0.08, nav: 0.07, sotp: 0.05,
  },
  TECHNOLOGY: {
    dcf: 0.28, pe: 0.2, pb: 0.08, evEbitda: 0.12, pfcf: 0.12,
    residualIncome: 0.05, ddm: 0.05, nav: 0.05, sotp: 0.05,
  },
  CONSTRUCTION: {
    dcf: 0.2, pe: 0.12, pb: 0.12, evEbitda: 0.12, pfcf: 0.12,
    residualIncome: 0.08, ddm: 0.05, nav: 0.12, sotp: 0.07,
  },
  GENERAL: {
    dcf: 0.22, pe: 0.15, pb: 0.12, evEbitda: 0.12, pfcf: 0.12,
    residualIncome: 0.1, ddm: 0.07, nav: 0.05, sotp: 0.05,
  },
};

export function getIndustryMethodWeights(
  profileId: IndustryProfileId | string | null | undefined,
): IndustryMethodWeights {
  const id = (profileId ?? "GENERAL").toUpperCase() as IndustryProfileId;
  return METHOD_WEIGHTS[id] ?? METHOD_WEIGHTS.GENERAL;
}

export interface MethodPriceBag {
  dcfBase: number | null;
  dcfBear: number | null;
  dcfBull: number | null;
  peBased: number | null;
  pbBased: number | null;
  evEbitdaBased: number | null;
  pfcfBased: number | null;
  residualIncome: number | null;
  ddm: number | null;
  nav: number | null;
  sotp: number | null;
}

export interface IndustryBlendedFairValue {
  blendedFairValue: number | null;
  weightsApplied: Partial<Record<keyof IndustryMethodWeights, number>>;
  methodsUsed: string[];
  methodCount: number;
  notes: string[];
}

export function blendByIndustry(input: {
  prices: MethodPriceBag;
  profileId: IndustryProfileId | string | null;
}): IndustryBlendedFairValue {
  const notes: string[] = [];
  const w = getIndustryMethodWeights(input.profileId);
  const p = input.prices;

  const parts: { key: keyof IndustryMethodWeights; price: number; weight: number }[] = [];
  const push = (key: keyof IndustryMethodWeights, price: number | null) => {
    if (finite(price) && price! > 0 && w[key] > 0) {
      parts.push({ key, price: price!, weight: w[key] });
    }
  };

  push("dcf", p.dcfBase);
  push("pe", p.peBased);
  push("pb", p.pbBased);
  push("evEbitda", p.evEbitdaBased);
  push("pfcf", p.pfcfBased);
  push("residualIncome", p.residualIncome);
  push("ddm", p.ddm);
  push("nav", p.nav);
  push("sotp", p.sotp);

  if (!parts.length) {
    notes.push("Không có method nào đủ data để blend theo ngành");
    return { blendedFairValue: null, weightsApplied: {}, methodsUsed: [], methodCount: 0, notes };
  }

  const sumW = parts.reduce((s, x) => s + x.weight, 0);
  const weightsApplied: IndustryBlendedFairValue["weightsApplied"] = {};
  let blended = 0;
  for (const x of parts) {
    const nw = x.weight / sumW;
    weightsApplied[x.key] = round(nw, 4)!;
    blended += x.price * nw;
  }

  notes.push(`Industry blend (${input.profileId ?? "GENERAL"}): ${parts.map((x) => x.key).join("+")}`);

  return {
    blendedFairValue: Math.round(blended),
    weightsApplied,
    methodsUsed: parts.map((x) => x.key),
    methodCount: parts.length,
    notes,
  };
}

export interface ConfidenceBands {
  low: number | null;
  base: number | null;
  high: number | null;
  bandWidthPct: number | null;
  sources: string[];
  notes: string[];
}

export function buildConfidenceBands(input: {
  baseFairValue: number | null;
  dcfBear: number | null;
  dcfBase: number | null;
  dcfBull: number | null;
  methodPrices: (number | null)[];
}): ConfidenceBands {
  const notes: string[] = [];
  const sources: string[] = [];
  const prices = input.methodPrices.filter((x): x is number => finite(x) && x! > 0);

  let low: number | null = null;
  let high: number | null = null;
  let base = input.baseFairValue;

  if (finite(input.dcfBear) || finite(input.dcfBull) || finite(input.dcfBase)) {
    sources.push("dcf_scenarios");
    const dcfVals = [input.dcfBear, input.dcfBase, input.dcfBull].filter(
      (x): x is number => finite(x) && x! > 0,
    );
    if (dcfVals.length) {
      low = Math.min(...dcfVals);
      high = Math.max(...dcfVals);
      if (base == null && finite(input.dcfBase)) base = input.dcfBase;
    }
  }

  if (prices.length >= 2) {
    sources.push("method_dispersion");
    const sorted = [...prices].sort((a, b) => a - b);
    const p25 = sorted[Math.max(0, Math.floor(sorted.length * 0.25))];
    const p75 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
    low = low != null ? Math.min(low, p25) : p25;
    high = high != null ? Math.max(high, p75) : p75;
    if (base == null) {
      base = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    }
  }

  if (base != null && (low == null || high == null)) {
    sources.push("synthetic_15pct");
    notes.push("Chỉ có 1 ước lượng — band ±15% synthetic (độ tin cậy thấp hơn)");
    low = Math.round(base * 0.85);
    high = Math.round(base * 1.15);
  }

  const bandWidthPct =
    base != null && low != null && high != null && base > 0
      ? round(((high - low) / base) * 100, 1)
      : null;

  return {
    low: low != null ? Math.round(low) : null,
    base: base != null ? Math.round(base) : null,
    high: high != null ? Math.round(high) : null,
    bandWidthPct,
    sources,
    notes,
  };
}

export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

export interface ValuationScoreBreakdown {
  upsideScore: number;
  agreementScore: number;
  dataQualityScore: number;
  coverageScore: number;
  total: number;
  grade: ScoreGrade;
  drivers: string[];
}

export interface ValuationScoreResult {
  score: number;
  grade: ScoreGrade;
  breakdown: ValuationScoreBreakdown;
  valuationStatus: ValuationStatus;
  upsidePct: number | null;
  bands: ConfidenceBands;
  industryBlend: IndustryBlendedFairValue;
  notes: string[];
}

function gradeFromScore(score: number): ScoreGrade {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

function statusFromUpside(upsidePct: number | null, methodCount: number): ValuationStatus {
  if (upsidePct == null || methodCount < 1) return "insufficient_data";
  if (upsidePct >= 40 && methodCount >= 2) return "deep_undervalued";
  if (upsidePct >= 15) return "undervalued";
  if (upsidePct > -15) return "fairly_valued";
  if (upsidePct > -40) return "overvalued";
  return "deep_overvalued";
}

export function computeValuationScore(input: {
  currentPrice: number | null;
  fairValue: number | null;
  methodPrices: MethodPriceBag;
  dataQuality: number | null;
  profileId: IndustryProfileId | string | null;
}): ValuationScoreResult {
  const notes: string[] = [];
  const industryBlend = blendByIndustry({
    prices: input.methodPrices,
    profileId: input.profileId,
  });
  notes.push(...industryBlend.notes);

  const fv = industryBlend.blendedFairValue ?? input.fairValue;
  const upsidePct =
    fv != null && finite(input.currentPrice) && input.currentPrice! > 0
      ? round((fv / input.currentPrice! - 1) * 100, 1)
      : null;

  let upsideScore = 20;
  if (upsidePct != null) {
    const capped = Math.max(-60, Math.min(60, upsidePct));
    upsideScore = round(20 + (capped / 60) * 20, 1)!;
  } else {
    notes.push("Không tính được upside — upsideScore trung tính");
  }

  const prices = Object.values(input.methodPrices).filter(
    (x): x is number => finite(x) && x! > 0,
  );
  let agreementScore = 0;
  if (prices.length >= 2 && fv != null && fv > 0) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
    const cv = Math.sqrt(variance) / mean;
    agreementScore = round(Math.max(0, 25 * (1 - Math.min(cv, 0.4) / 0.4)), 1)!;
  } else if (prices.length === 1) {
    agreementScore = 8;
    notes.push("Chỉ 1 method — agreement score thấp");
  }

  const dq = finite(input.dataQuality) ? Math.max(0, Math.min(100, input.dataQuality!)) : 40;
  const dataQualityScore = round((dq / 100) * 20, 1)!;

  const methodCount = industryBlend.methodCount;
  const coverageScore = round(Math.min(15, methodCount * 2.5), 1)!;

  const total = Math.round(
    Math.max(0, Math.min(100, upsideScore + agreementScore + dataQualityScore + coverageScore)),
  );
  const grade = gradeFromScore(total);

  const drivers: string[] = [];
  if (upsidePct != null && upsidePct >= 15) drivers.push(`Upside ${upsidePct}% hỗ trợ điểm`);
  if (upsidePct != null && upsidePct <= -15) drivers.push(`Downside ${upsidePct}% kéo điểm xuống`);
  if (agreementScore >= 18) drivers.push("Các method định giá khá hội tụ");
  if (agreementScore < 10 && prices.length >= 2) drivers.push("Method prices phân tán — cần thận trọng");
  if (dq >= 70) drivers.push("Data quality tốt");
  if (dq < 50) drivers.push("Data quality yếu — giảm tin cậy");
  if (methodCount >= 4) drivers.push(`${methodCount} phương pháp tham gia`);
  if (methodCount <= 1) drivers.push("Ít phương pháp — điểm coverage thấp");

  const bands = buildConfidenceBands({
    baseFairValue: fv,
    dcfBear: input.methodPrices.dcfBear,
    dcfBase: input.methodPrices.dcfBase,
    dcfBull: input.methodPrices.dcfBull,
    methodPrices: prices,
  });
  notes.push(...bands.notes);

  return {
    score: total,
    grade,
    breakdown: {
      upsideScore,
      agreementScore,
      dataQualityScore,
      coverageScore,
      total,
      grade,
      drivers,
    },
    valuationStatus: statusFromUpside(upsidePct, methodCount),
    upsidePct,
    bands,
    industryBlend,
    notes,
  };
}

export interface Phase5ValuationResult {
  score: ValuationScoreResult;
  industryWeights: IndustryMethodWeights;
  profileId: string | null;
  finalFairValue: number | null;
  confidenceBands: ConfidenceBands;
  valuationScore: number;
  grade: ScoreGrade;
  valuationStatus: ValuationStatus;
  notes: string[];
  valuationEngineVersion: string;
}

export function buildPhase5Valuation(input: {
  currentPrice: number | null;
  dataQuality: number | null;
  profileId: IndustryProfileId | string | null;
  phase3Fair: FairValueAggregate | null;
  phase4: Phase4ValuationResult | null;
}): Phase5ValuationResult {
  const notes: string[] = [];
  const p3 = input.phase3Fair;
  const p4 = input.phase4;

  const methodPrices: MethodPriceBag = {
    dcfBase: p3?.methods.dcfBase ?? null,
    dcfBear: p3?.methods.dcfBear ?? null,
    dcfBull: p3?.methods.dcfBull ?? null,
    peBased: p3?.methods.peBased ?? null,
    pbBased: p3?.methods.pbBased ?? null,
    evEbitdaBased: p3?.methods.evEbitdaBased ?? null,
    pfcfBased: p3?.methods.pfcfBased ?? null,
    residualIncome: p4?.methodPrices.residualIncome ?? null,
    ddm: p4?.methodPrices.ddm ?? null,
    nav: p4?.methodPrices.nav ?? null,
    sotp: p4?.methodPrices.sotp ?? null,
  };

  const score = computeValuationScore({
    currentPrice: input.currentPrice,
    fairValue: p3?.blendedFairValue ?? null,
    methodPrices,
    dataQuality: input.dataQuality,
    profileId: input.profileId,
  });
  notes.push(...score.notes);

  return {
    score,
    industryWeights: getIndustryMethodWeights(input.profileId),
    profileId: input.profileId != null ? String(input.profileId) : null,
    finalFairValue: score.industryBlend.blendedFairValue ?? p3?.blendedFairValue ?? null,
    confidenceBands: score.bands,
    valuationScore: score.score,
    grade: score.grade,
    valuationStatus: score.valuationStatus,
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE5,
  };
}

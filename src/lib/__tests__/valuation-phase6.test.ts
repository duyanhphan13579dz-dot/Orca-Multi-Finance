/**
 * Phase 6 — Analyst snapshot + deterministic narrative (no LLM required).
 */
import {
  buildAnalystSnapshot,
  buildDeterministicNarrative,
  buildPhase6ValuationSync,
} from "../engines/valuation-phase6";
import type { AnalystEngineResult } from "../engines/valuation-phase6";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.error("  ✗", msg);
  }
}

const sample: AnalystEngineResult = {
  price: 100000,
  marketCap: 5e13,
  enterpriseValue: 5.2e13,
  multiples: {
    pe: 15.2,
    pb: 2.1,
    ps: 3.0,
    pfcf: 12,
    pcf: 10,
    evEbitda: 9.5,
    fcfYield: 4.2,
    earningsYield: 6.5,
    dividendYield: 2.0,
  },
  dcf: [
    {
      label: "Bear",
      intrinsicPerShare: 80000,
      growthY1to5: 0.02,
      terminalGrowth: 0.015,
      discountRate: 0.14,
    },
    {
      label: "Base",
      intrinsicPerShare: 110000,
      growthY1to5: 0.08,
      terminalGrowth: 0.025,
      discountRate: 0.12,
    },
    {
      label: "Bull",
      intrinsicPerShare: 140000,
      growthY1to5: 0.14,
      terminalGrowth: 0.03,
      discountRate: 0.105,
    },
  ],
  fairValue: {
    blendedFairValue: 108000,
    upsidePct: 8.0,
    valuationStatus: "fairly_valued",
    confidence: "medium",
    methods: {
      dcfBase: 110000,
      dcfBear: 80000,
      dcfBull: 140000,
      peBased: 105000,
      pbBased: 100000,
      evEbitdaBased: 102000,
      pfcfBased: 98000,
    },
  },
  phase4: {
    methodPrices: {
      residualIncome: null,
      ddm: 90000,
      nav: 85000,
      sotp: null,
    },
    ddm: { status: "ok" },
    sotp: { status: "not_applicable" },
  },
  phase5: {
    finalFairValue: 108000,
    valuationScore: 62,
    grade: "C",
    valuationStatus: "fairly_valued",
    profileId: "TECHNOLOGY",
    confidenceBands: { low: 80000, base: 108000, high: 140000, bandWidthPct: 55.6 },
    score: {
      upsidePct: 8.0,
      breakdown: {
        upsideScore: 22,
        agreementScore: 18,
        dataQualityScore: 14,
        coverageScore: 12,
        drivers: ["Các method định giá khá hội tụ", "Data quality tốt"],
      },
      industryBlend: { methodsUsed: ["dcf", "pe", "pb", "pfcf"], methodCount: 4 },
    },
  },
  dataQuality: 72,
  confidence: "medium",
  notes: ["Phase4 blend: +ddm,nav"],
  valuationEngineVersion: "2.4.0-phase5",
};

console.log("\n=== Snapshot ===");
{
  const snap = buildAnalystSnapshot(sample, "FPT");
  assert(snap.symbol === "FPT", "symbol");
  assert(snap.fairValue.blended === 108000, "blended FV from phase5");
  assert(snap.score.value === 62, "score");
  assert(snap.gaps.some((g) => g.includes("SOTP")), "SOTP gap noted");
  assert(!snap.gaps.some((g) => g.includes("P/E")), "PE present — no PE gap");
}

console.log("\n=== Deterministic narrative ===");
{
  const snap = buildAnalystSnapshot(sample, "FPT");
  const text = buildDeterministicNarrative(snap);
  assert(text.includes("108") || text.includes("108.000"), "mentions FV");
  assert(text.includes("fairly valued") || text.includes("hợp lý"), "status text");
  assert(text.includes("không tính lại") || text.includes("không bịa"), "disclaimer");
  assert(text.includes("SOTP") || text.includes("segment"), "mentions SOTP gap");
}

console.log("\n=== Sync phase6 ===");
{
  const r = buildPhase6ValuationSync({ valuation: sample, symbol: "FPT" });
  assert(r.usedLlm === false, "no LLM");
  assert(r.narrative.length > 100, "narrative length");
  assert(r.valuationEngineVersion.includes("phase6"), "version");
}

console.log("\n=== Sparse data gaps ===");
{
  const sparse: AnalystEngineResult = {
    ...sample,
    multiples: {
      pe: null,
      pb: null,
      ps: null,
      pfcf: null,
      pcf: null,
      evEbitda: null,
      fcfYield: null,
      earningsYield: null,
      dividendYield: null,
    },
    dcf: null,
    fairValue: {
      blendedFairValue: null,
      upsidePct: null,
      valuationStatus: "insufficient_data",
      methods: {
        dcfBase: null,
        dcfBear: null,
        dcfBull: null,
        peBased: null,
        pbBased: null,
        evEbitdaBased: null,
        pfcfBased: null,
      },
    },
    phase4: {
      methodPrices: { residualIncome: null, ddm: null, nav: null, sotp: null },
      ddm: { status: "not_applicable" },
      sotp: { status: "not_applicable" },
    },
    phase5: null,
    dataQuality: 20,
  };
  const snap = buildAnalystSnapshot(sparse, "XYZ");
  assert(snap.gaps.length >= 3, "many gaps");
  const text = buildDeterministicNarrative(snap);
  assert(text.includes("Hạn chế") || text.includes("Thiếu"), "lists limitations");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

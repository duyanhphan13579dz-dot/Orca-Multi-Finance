/**
 * Phase 5 — Industry weights, Valuation Score, confidence bands.
 */
import {
  getIndustryMethodWeights,
  blendByIndustry,
  buildConfidenceBands,
  computeValuationScore,
  buildPhase5Valuation,
} from "../engines/valuation-phase5";

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

console.log("\n=== Industry weights ===");
{
  const bank = getIndustryMethodWeights("BANKING");
  assert(bank.residualIncome > bank.dcf, "banks prefer RI over DCF");
  assert(bank.evEbitda === 0, "banks EV/EBITDA weight 0");
  const tech = getIndustryMethodWeights("TECHNOLOGY");
  assert(tech.dcf > tech.nav, "tech prefers DCF over NAV");
  const re = getIndustryMethodWeights("REAL_ESTATE");
  assert(re.nav >= re.dcf, "RE prefers NAV");
}

console.log("\n=== Industry blend ===");
{
  const b = blendByIndustry({
    profileId: "TECHNOLOGY",
    prices: {
      dcfBase: 100000,
      dcfBear: 80000,
      dcfBull: 130000,
      peBased: 95000,
      pbBased: null,
      evEbitdaBased: 90000,
      pfcfBased: 92000,
      residualIncome: null,
      ddm: null,
      nav: null,
      sotp: null,
    },
  });
  assert(b.blendedFairValue != null && b.blendedFairValue > 0, "blended FV");
  assert(b.methodCount >= 3, "at least 3 methods");
  assert(b.weightsApplied.dcf != null && b.weightsApplied.dcf! > 0, "dcf weight applied");
}

console.log("\n=== Confidence bands ===");
{
  const bands = buildConfidenceBands({
    baseFairValue: 100000,
    dcfBear: 80000,
    dcfBase: 100000,
    dcfBull: 130000,
    methodPrices: [95000, 100000, 105000, 90000],
  });
  assert(bands.low != null && bands.high != null, "low/high set");
  assert(bands.low! < bands.high!, "low < high");
  assert(bands.base === 100000, "base");
  assert(bands.bandWidthPct != null && bands.bandWidthPct > 0, "width pct");
}

console.log("\n=== Valuation score ===");
{
  const undervalued = computeValuationScore({
    currentPrice: 70000,
    fairValue: 100000,
    dataQuality: 80,
    profileId: "TECHNOLOGY",
    methodPrices: {
      dcfBase: 100000,
      dcfBear: 85000,
      dcfBull: 120000,
      peBased: 98000,
      pbBased: 95000,
      evEbitdaBased: 97000,
      pfcfBased: 96000,
      residualIncome: null,
      ddm: null,
      nav: null,
      sotp: null,
    },
  });
  assert(undervalued.score >= 50, "undervalued scores higher");
  assert(undervalued.upsidePct != null && undervalued.upsidePct! > 0, "positive upside");
  assert(["A", "B", "C", "D", "F"].includes(undervalued.grade), "grade");

  const overvalued = computeValuationScore({
    currentPrice: 150000,
    fairValue: 100000,
    dataQuality: 80,
    profileId: "TECHNOLOGY",
    methodPrices: {
      dcfBase: 100000,
      dcfBear: 85000,
      dcfBull: 120000,
      peBased: 98000,
      pbBased: 95000,
      evEbitdaBased: 97000,
      pfcfBased: 96000,
      residualIncome: null,
      ddm: null,
      nav: null,
      sotp: null,
    },
  });
  assert(overvalued.score < undervalued.score, "overvalued scores lower");
}

console.log("\n=== Phase5 builder ===");
{
  const r = buildPhase5Valuation({
    currentPrice: 90000,
    dataQuality: 70,
    profileId: "BANKING",
    phase3Fair: {
      methods: {
        dcfBase: 100000,
        dcfBear: 80000,
        dcfBull: 125000,
        peBased: 95000,
        pbBased: 110000,
        evEbitdaBased: null,
        pfcfBased: null,
      },
      weightsUsed: { dcf: 0.4, pe: 0.3, pb: 0.3, evEbitda: 0, pfcf: 0 },
      blendedFairValue: 100000,
      currentPrice: 90000,
      upsidePct: 11.1,
      valuationStatus: "fairly_valued",
      confidence: "medium",
      notes: [],
    },
    phase4: {
      residualIncome: null,
      ddm: null,
      nav: null,
      sotp: null,
      methodPrices: {
        residualIncome: 105000,
        ddm: 90000,
        nav: 85000,
        sotp: null,
      },
      notes: [],
      valuationEngineVersion: "2.3.0-phase4",
    },
  });
  assert(r.valuationScore >= 0 && r.valuationScore <= 100, "score 0-100");
  assert(r.finalFairValue != null, "final FV");
  assert(r.confidenceBands.low != null, "bands");
  assert(r.valuationEngineVersion.includes("phase5"), "version");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

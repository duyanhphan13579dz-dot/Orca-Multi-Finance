/**
 * Integration regression tests for Vietnam market-unit conversion, financial
 * statement completeness, and configured provider failover.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { computeFinancialHealth } from "../engines/fundamental";
import { computeValuation } from "../engines/valuation";
import { normalizeCashflowMetrics } from "../financial/statements";
import { computeDetailedRatios } from "../financial/ratio-engine";
import { buildTtmPeriod } from "../financial/normalize";
import type { NormalizedPeriod } from "../financial/types";
import { vnPriceQuoteToVnd, vnPriceScale, vnVndPerShareToQuote } from "../financial/vn-units";
import { normalizeVnStockFinancialRows } from "../financial/vnstock-provider";
import { getVndirectFinancialBases } from "../financial/vndirect-http";
import type { FinancialHealthResult } from "../engines/fundamental";

const health: FinancialHealthResult = {
  groups: {
    profitability: {},
    liquidity: {},
    leverage: {},
    cashflow: {},
    efficiency: {},
  },
  scores: {
    profitability: 70,
    liquidity: 70,
    leverage: 70,
    cashflow: 70,
    efficiency: 70,
    overall: 70,
  },
  coverage: 1,
  warnings: [],
  riskFlags: [],
  industry: null,
  anchors: {
    revenue: 20e12,
    netProfit: 5e12,
    equity: 25e12,
    totalDebt: 10e12,
    cash: 2e12,
    ocfTtm: 5e12,
    fcfTtm: 4e12,
    shares: 1e9,
    epsTtm: 5_000,
    ebitdaTtm: 7e12,
  },
};

test("VN quote conversion keeps market and financial units separate", () => {
  assert.equal(vnPriceQuoteToVnd(50), 50_000);
  assert.equal(vnPriceQuoteToVnd(50_000), 50_000);
  assert.equal(vnPriceScale(50), 1_000);
  assert.equal(vnPriceScale(50_000), 1);
  assert.equal(vnVndPerShareToQuote(50_000, 1_000), 50);
  assert.equal(vnVndPerShareToQuote(50_000, 1), 50_000);
  assert.equal(vnPriceQuoteToVnd(Number.NaN), null);
});

test("computeValuation calculates VND multiples and returns fair value in quote units", () => {
  const result = computeValuation({
    price: 50,
    priceVnd: 50_000,
    marketCapOverride: 50e12,
    health,
    symbol: "FPT",
    fairPe: 15,
    fairPb: 2,
    dividendYield: 0.02,
  });

  assert.equal(result.marketCap, 50e12, "market cap uses full VND market price");
  assert.equal(result.phase1?.multiples.marketCap.value, 50e12);
  assert.equal(result.multiples.pe, 10, "PE is VND/share ÷ VND/share");
  assert.equal(result.multiples.pb, 2, "PB is VND/share ÷ VND/share");
  assert.equal(result.phase3?.fairValue.methods.peBased, 75, "multiple fair value is expressed in quote units");
  assert.equal(result.phase3?.fairValue.currentPrice, 50);
  assert.equal(result.phase4?.methodPriceUnit, "market_quote");
  assert.ok((result.phase4?.methodPrices.nav ?? 0) > 0 && (result.phase4?.methodPrices.nav ?? 0) < 100);
  assert.ok((result.phase4?.nav?.navPerShare ?? 0) > 1_000, "detailed Phase 4 result remains full VND/share");
  assert.equal(result.fairValue?.currentPrice, 50);
  assert.ok(result.fairValue?.blendedFairValue != null && result.fairValue.blendedFairValue < 1_000);
});

test("computeValuation uses statement-backed FCFF and FCFE when supplied", () => {
  const result = computeValuation({
    price: 50,
    priceVnd: 50_000,
    marketCapOverride: 50e12,
    health,
    symbol: "FPT",
    ebitTtm: 6e12,
    taxRate: 0.2,
    daTtm: 1e12,
    capexTtm: 1.5e12,
    deltaNwc: 0.2e12,
    netBorrowing: 0.4e12,
  });

  assert.equal(result.phase2?.cashFlow.fcff.status, "ok");
  assert.equal(result.phase2?.cashFlow.fcfe.status, "ok");
  assert.equal(result.phase2?.cashFlow.fcff.value, 4.1e12);
  assert.equal(result.phase2?.cashFlow.fcfe.value, 4.7e12);
  assert.equal(result.multiples.evFcff != null, true);
});

test("net-debt ratios do not treat missing cash as zero", () => {
  const missingCash = computeDetailedRatios({
    metrics: { shortTermDebt: 100, ebitda: 50 },
    priceQuote: null,
    sharesOutstanding: null,
  });
  const zeroCash = computeDetailedRatios({
    metrics: { shortTermDebt: 100, cash: 0, ebitda: 50 },
    priceQuote: null,
    sharesOutstanding: null,
  });

  assert.equal(missingCash.flat.find(({ key }) => key === "netDebtEbitda")?.value, null);
  assert.equal(zeroCash.flat.find(({ key }) => key === "netDebtEbitda")?.value, 2);
});

test("EV/EBITDA is unavailable instead of treating total liabilities as debt", () => {
  const financials = computeFinancialHealth(
    {
      income: [{ year: 2025, periodType: "year", revenue: 1_000, netProfit: 100, ebit: 120, ebitda: 150 }],
      balance: [{ year: 2025, periodType: "year", totalLiabilities: 700, totalAssets: 1_000, equity: 300, cash: 50 }],
      cashflow: [],
    },
    { symbol: "FPT" },
  );
  assert.equal(financials.anchors.totalDebt, null);
  assert.ok(financials.warnings.some((warning) => warning.includes("không dùng tổng nợ phải trả")));
});

test("financial health requires four consecutive quarters for TTM and reported CAPEX/EBITDA", () => {
  const quarters = [1, 2, 3, 4].map((quarter) => ({
    period: `2025-Q${quarter}`,
    periodType: "quarter",
    year: 2025,
    quarter,
    revenue: quarter * 100,
    netProfit: quarter * 10,
    ebit: quarter * 12,
    ebitda: quarter * 15,
    shares: 1_000,
  }));
  const balances = [
    { period: "2025-Q4", periodType: "quarter", year: 2025, quarter: 4, totalAssets: 2_000, totalLiabilities: 1_200, equity: 800, cash: 100, shortTermDebt: 300, longTermDebt: 200, shares: 1_000 },
    { period: "2025-Q3", periodType: "quarter", year: 2025, quarter: 3, totalAssets: 1_900, totalLiabilities: 1_100, equity: 800, cash: 90, shortTermDebt: 280, longTermDebt: 190, shares: 1_000 },
  ];
  const cashflows = [1, 2, 3, 4].map((quarter) => ({
    period: `2025-Q${quarter}`,
    periodType: "quarter",
    year: 2025,
    quarter,
    operatingCashFlow: quarter * 20,
    capex: -quarter * 5,
  }));
  const complete = computeFinancialHealth(
    { income: quarters, balance: balances, cashflow: cashflows },
    { symbol: "FPT" },
  );
  assert.equal(complete.anchors.revenue, 1_000);
  assert.equal(complete.anchors.netProfit, 100);
  assert.equal(complete.anchors.ebitdaTtm, 150);
  assert.equal(complete.anchors.totalDebt, 500, "borrowings only, not total liabilities");
  assert.equal(complete.anchors.ocfTtm, 200);
  assert.equal(complete.anchors.fcfTtm, 150);

  const partial = computeFinancialHealth(
    {
      income: quarters.slice(1),
      balance: balances,
      cashflow: cashflows.slice(1),
    },
    { symbol: "FPT" },
  );
  assert.equal(partial.anchors.revenue, null, "three quarters are not a TTM");
  assert.equal(partial.anchors.netProfit, null);
  assert.equal(partial.anchors.fcfTtm, null);

  const missingReportedMetrics = computeFinancialHealth(
    {
      income: quarters.map(({ ebitda: _ebitda, ...row }) => row),
      balance: balances,
      cashflow: cashflows.map(({ capex: _capex, ...row }) => row),
    },
    { symbol: "FPT" },
  );
  assert.equal(missingReportedMetrics.anchors.ebitdaTtm, null, "no EBITDA=EBIT×factor proxy");
  assert.equal(missingReportedMetrics.anchors.fcfTtm, null, "missing capex is not zero capex");
});

test("cash-flow normalizer does not equate missing CAPEX with zero", () => {
  assert.equal(normalizeCashflowMetrics({ operatingCashFlow: 100 }).freeCashFlow, undefined);
  assert.equal(normalizeCashflowMetrics({ operatingCashFlow: 100, capex: -25 }).freeCashFlow, 75);
});

test("normalized TTM requires consecutive quarters and complete flow metrics", () => {
  const makePeriod = (year: number, quarter: number, revenue: number | null): NormalizedPeriod => ({
    period: `${year}-Q${quarter}`,
    periodType: "quarter",
    fiscalDate: `${year}-${String(quarter * 3).padStart(2, "0")}-30`,
    year,
    quarter,
    statementScope: "unknown",
    auditStatus: "unknown",
    currency: "VND",
    source: "test",
    unit: "VND",
    confidence: 1,
    metrics: { ...(revenue != null ? { revenue } : {}), operatingCashFlow: 10 },
  });
  const complete = [makePeriod(2025, 4, 400), makePeriod(2025, 3, 300), makePeriod(2025, 2, 200), makePeriod(2025, 1, 100)];
  assert.equal(buildTtmPeriod(complete)?.metrics.revenue, 1_000);
  assert.equal(buildTtmPeriod(complete.map((period, index) => index === 1 ? { ...period, metrics: { ...period.metrics, revenue: undefined } } : period))?.metrics.revenue, undefined);
  const gap = [makePeriod(2025, 4, 400), makePeriod(2025, 3, 300), makePeriod(2025, 1, 100), makePeriod(2024, 4, 400)];
  assert.equal(buildTtmPeriod(gap), null, "a missing quarter cannot be filled by an older quarter");
});

test("VNStock statements normalize common wide-row payloads without inventing CAPEX", () => {
  const period = normalizeVnStockFinancialRows(
    "FPT",
    [{ year: 2025, quarter: 1, revenue: "1,000", netIncome: 120, operatingCashFlow: 200, capex: -50 }],
    "quarter",
  )[0];
  assert.equal(period?.period, "2025-Q1");
  assert.equal(period?.metrics.revenue, 1_000);
  assert.equal(period?.metrics.freeCashFlow, 150);
  const noCapex = normalizeVnStockFinancialRows(
    "FPT",
    [{ year: 2025, quarter: 1, revenue: 1_000, operatingCashFlow: 200 }],
    "quarter",
  )[0];
  assert.equal(noCapex?.metrics.freeCashFlow, undefined);
});

test("VNDirect base override is respected and failover hosts are explicit", () => {
  const oldPrimary = process.env.VNDIRECT_BASE_URL;
  const oldFallbacks = process.env.VNDIRECT_FALLBACK_BASE_URLS;
  try {
    process.env.VNDIRECT_BASE_URL = "https://private-vnd.example/";
    delete process.env.VNDIRECT_FALLBACK_BASE_URLS;
    assert.deepEqual(getVndirectFinancialBases(), ["https://private-vnd.example"]);
    process.env.VNDIRECT_FALLBACK_BASE_URLS = "https://backup-one.example, https://backup-two.example/";
    assert.deepEqual(getVndirectFinancialBases(), [
      "https://private-vnd.example",
      "https://backup-one.example",
      "https://backup-two.example",
    ]);
  } finally {
    if (oldPrimary == null) delete process.env.VNDIRECT_BASE_URL;
    else process.env.VNDIRECT_BASE_URL = oldPrimary;
    if (oldFallbacks == null) delete process.env.VNDIRECT_FALLBACK_BASE_URLS;
    else process.env.VNDIRECT_FALLBACK_BASE_URLS = oldFallbacks;
  }
});

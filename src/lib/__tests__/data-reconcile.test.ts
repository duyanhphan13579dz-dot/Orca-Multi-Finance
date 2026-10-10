import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileFinancialMetrics,
  reconcileNumericField,
  reconcileQuotes,
} from "../data-engine/reconcile";

test("reconcileNumericField: handles MATCHED when values are within tolerance", () => {
  const primary = { sourceId: "vndirect", value: 100_000 };
  const secondaries = [
    { sourceId: "ssi", value: 100_500 }, // 0.5% delta
    { sourceId: "vietcap", value: 99_800 }, // 0.2% delta
  ];

  const result = reconcileNumericField("price", primary, secondaries, 1.5);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.chosenValue, 100_000);
  assert.equal(result.chosenSource, "vndirect");
  assert.equal(result.maxDeltaPct != null && result.maxDeltaPct <= 1.5, true);
  assert.equal(result.secondarySources.length, 2);
});

test("reconcileNumericField: detects DIVERGENT when values exceed tolerance", () => {
  const primary = { sourceId: "vndirect", value: 100_000 };
  const secondaries = [
    { sourceId: "ssi", value: 105_000 }, // 5% delta > 1.5% tolerance
  ];

  const result = reconcileNumericField("price", primary, secondaries, 1.5);
  assert.equal(result.status, "DIVERGENT");
  assert.equal(result.chosenValue, 100_000); // preserves primary but flags divergence
  assert.equal(result.maxDeltaPct != null && result.maxDeltaPct >= 4.5, true);
  assert.ok(result.discrepancyNote?.includes("diverges from vndirect"));
});

test("reconcileNumericField: uses FALLBACK_USED when primary is missing", () => {
  const primary = null;
  const secondaries = [
    { sourceId: "ssi", value: 50_000, qualityScore: 80 },
    { sourceId: "vietcap", value: 50_200, qualityScore: 95 },
  ];

  const result = reconcileNumericField("price", primary, secondaries);
  assert.equal(result.status, "FALLBACK_USED");
  assert.equal(result.chosenSource, "vietcap"); // higher quality score
  assert.equal(result.chosenValue, 50_200);
});

test("reconcileNumericField: returns UNVERIFIED when only primary is available", () => {
  const primary = { sourceId: "binance", value: 65_000 };
  const result = reconcileNumericField("price", primary, []);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.chosenValue, 65_000);
});

test("reconcileQuotes: reconciles market quotes and volumes", () => {
  const primary = {
    sourceId: "vndirect",
    symbol: "FPT",
    price: 130_000,
    volume: 1_200_000,
  };
  const secondaries = [
    {
      sourceId: "ssi",
      symbol: "FPT",
      price: 130_200,
      volume: 1_210_000,
    },
  ];

  const report = reconcileQuotes(primary, secondaries, {
    priceTolerancePct: 1.0,
    volumeTolerancePct: 5.0,
  });

  assert.equal(report.entityId, "FPT");
  assert.equal(report.overallStatus, "CONSISTENT");
  assert.equal(report.discrepanciesCount, 0);
  assert.equal(report.fields.price?.status, "MATCHED");
  assert.equal(report.fields.volume?.status, "MATCHED");
});

test("reconcileFinancialMetrics: cross-checks statement metrics without silent overwrites", () => {
  const primary = {
    sourceId: "vndirect-fs",
    period: "2024-Q3",
    metrics: {
      revenue: 12_000,
      netIncome: 2_500,
      totalAssets: 50_000,
    },
  };
  const secondaries = [
    {
      sourceId: "vietcap-fs",
      period: "2024-Q3",
      metrics: {
        revenue: 12_050, // matched
        netIncome: 1_800, // divergent! (~28% diff)
        totalAssets: 50_100, // matched
      },
    },
  ];

  const report = reconcileFinancialMetrics(primary, secondaries, 3.0);
  assert.equal(report.entityId, "2024-Q3");
  assert.equal(report.overallStatus, "DISCREPANT");
  assert.equal(report.discrepanciesCount, 1);
  assert.equal(report.fields.revenue?.status, "MATCHED");
  assert.equal(report.fields.totalAssets?.status, "MATCHED");
  assert.equal(report.fields.netIncome?.status, "DIVERGENT");
  assert.ok(report.fields.netIncome?.discrepancyNote?.includes("diverges"));
});

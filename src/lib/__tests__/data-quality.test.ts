import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDataFreshness,
  checkMonotonicTimestamps,
  detectPriceAnomalies,
  evaluatePayloadQuality,
  validateSchemaContract,
} from "../data-engine/quality";

test("validateSchemaContract: validates against expected catalog schema", () => {
  // 'vndirect' expectedSchema is ['quotes', 'meta']
  const validPayload = { quotes: [{ symbol: "FPT", price: 130_000 }], meta: { source: "vndirect" } };
  const resValid = validateSchemaContract("vndirect", validPayload);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.missingFields.length, 0);

  // Missing 'meta'
  const missingPayload = { quotes: [] };
  const resMissing = validateSchemaContract("vndirect", missingPayload);
  assert.equal(resMissing.valid, false);
  assert.deepEqual(resMissing.missingFields, ["meta"]);

  // Null 'quotes'
  const nullPayload = { quotes: null, meta: {} };
  const resNull = validateSchemaContract("vndirect", nullPayload);
  assert.equal(resNull.valid, true); // field is present but null
  assert.deepEqual(resNull.nullFields, ["quotes"]);
});

test("checkMonotonicTimestamps: detects out-of-order and future timestamps", () => {
  const baseTime = 1_700_000_000_000;
  const bars = [
    { time: baseTime },
    { time: baseTime + 60_000 },
    { time: baseTime + 120_000 },
    { time: baseTime + 90_000 }, // out of order!
    { time: baseTime + 180_000 },
  ];

  const res = checkMonotonicTimestamps(bars, { nowMs: baseTime + 300_000 });
  assert.equal(res.valid, false);
  assert.equal(res.isMonotonic, false);
  assert.equal(res.outOfOrderCount, 1);
  assert.equal(res.issues.some((i) => i.code === "OUT_OF_ORDER_TIMESTAMP"), true);

  // Future timestamp
  const futureBars = [{ time: baseTime + 10 * 60_000 }]; // 10 min into the future
  const resFuture = checkMonotonicTimestamps(futureBars, {
    nowMs: baseTime,
    maxClockSkewMs: 5 * 60_000,
  });
  assert.equal(resFuture.valid, false);
  assert.equal(resFuture.hasFutureTimestamp, true);
  assert.equal(resFuture.issues.some((i) => i.code === "FUTURE_TIMESTAMP"), true);
});

test("assessDataFreshness: evaluates SLA boundaries properly", () => {
  const now = 1_700_000_000_000;
  // 'binance' SLA: live <= 10s, fresh <= 30s, stale <= 120s, expired > 240s
  const live = assessDataFreshness("binance", now - 5_000, now);
  assert.equal(live.status, "live");

  const fresh = assessDataFreshness("binance", now - 25_000, now);
  assert.equal(fresh.status, "fresh");

  const delayed = assessDataFreshness("binance", now - 50_000, now);
  assert.equal(delayed.status, "delayed");

  const stale = assessDataFreshness("binance", now - 150_000, now);
  assert.equal(stale.status, "stale");

  const expired = assessDataFreshness("binance", now - 300_000, now);
  assert.equal(expired.status, "expired");

  const missing = assessDataFreshness("binance", null, now);
  assert.equal(missing.status, "expired");
});

test("detectPriceAnomalies: flags negative prices, broken high/low, and extreme jumps", () => {
  const quotes = [
    { symbol: "VCB", price: 92_000, high: 93_000, low: 91_000, changePercent: 1.2 },
    { symbol: "BAD_PRICE", price: -50, high: 10, low: 5 },
    { symbol: "BAD_BOUND", price: 50, high: 40, low: 60 }, // high < low
    { symbol: "SPIKE", price: 100, changePercent: 28.5 }, // > 15%
  ];

  const res = detectPriceAnomalies(quotes, { maxChangePercent: 15 });
  assert.equal(res.valid, false);
  assert.equal(res.anomalyCount, 3);
  assert.equal(res.anomalies.some((a) => a.issue === "NON_POSITIVE_PRICE"), true);
  assert.equal(res.anomalies.some((a) => a.issue === "HIGH_BELOW_LOW"), true);
  assert.equal(res.anomalies.some((a) => a.issue === "EXCESSIVE_PRICE_MOVE"), true);
});

test("evaluatePayloadQuality: computes composite score and grade", () => {
  const now = 1_700_000_000_000;
  // Excellent payload
  const report1 = evaluatePayloadQuality(
    "binance",
    { symbol: "BTCUSDT", price: 65000 },
    {
      updatedAtMs: now - 2000,
      nowMs: now,
      quotes: [{ symbol: "BTCUSDT", price: 65000, changePercent: 1.5 }],
    },
  );
  assert.equal(report1.score >= 90, true);
  assert.equal(report1.grade, "EXCELLENT");
  assert.equal(report1.isUsable, true);

  // Stale and missing fields payload
  const report2 = evaluatePayloadQuality(
    "vndirect", // expects quotes, meta
    { somethingElse: 123 },
    {
      updatedAtMs: now - 400_000, // stale
      nowMs: now,
    },
  );
  assert.equal(report2.score < 70, true);
  assert.equal(report2.schema?.valid, false);
  assert.equal(report2.issues.some((i) => i.code === "DATA_STALE"), true);
});

/**
 * VN PROVIDER DATA COMPARISON ENGINE — pure diff logic tests.
 * Used during migration (Phase 5); every rule enforces:
 *  - only compare REAL snapshots (never synthesize a second source),
 *  - timestamp mismatch → TIMESTAMP-DIFF (never treat old data as realtime),
 *  - verdict MATCH/DIFF/MISSING only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compareQuoteSnapshots, compareCandleSeries, type QuoteSnapshot } from "../services/vn-provider-compare";

const snap = (over: Partial<QuoteSnapshot>): QuoteSnapshot => ({
  symbol: "VNM",
  price: 61_900,
  change: 700,
  changePercent: 1.14,
  timestamp: 1_700_000_000_000,
  ...over,
});

test("compare: khớp trong tolerance → MATCH", () => {
  const r = compareQuoteSnapshots(snap({}), snap({ price: 61_902 }), { priceTolerancePct: 0.01 });
  assert.equal(r.verdict, "MATCH");
  assert.equal(r.diffs.length, 0);
});

test("compare: lệch giá vượt tolerance → DIFF với delta/pct", () => {
  const r = compareQuoteSnapshots(snap({}), snap({ price: 62_500 }), { priceTolerancePct: 0.1 });
  assert.equal(r.verdict, "DIFF");
  assert.ok(r.diffs.some((d) => d.field === "price" && typeof d.pct === "number" && Math.abs(d.pct!) > 0.1));
});

test("compare: timestamp lệch > tolerance → TIMESTAMP-DIFF (không đánh giá dữ liệu cũ là realtime)", () => {
  const r = compareQuoteSnapshots(snap({}), snap({ timestamp: 1_700_000_000_000 + 10 * 60_000 }), { timestampToleranceMs: 5 * 60_000 });
  assert.equal(r.verdict, "TIMESTAMP-DIFF");
  assert.equal(r.diffs[0].field, "timestamp");
});

test("compare: thiếu snapshot bên nào → MISSING (không suy đoán)", () => {
  assert.equal(compareQuoteSnapshots(null, snap({})).verdict, "MISSING");
  assert.equal(compareQuoteSnapshots(snap({}), null).verdict, "MISSING");
});

test("compare: changePercent lệch > 0.01 → DIFF", () => {
  const r = compareQuoteSnapshots(snap({}), snap({ changePercent: 1.7 }));
  assert.equal(r.verdict, "DIFF");
});

test("candles: align theo timestamp, missing + out-of-range count chính xác", () => {
  const DAY = 24 * 3_600_000;
  const t0 = 1_700_000_000_000;
  const a = [
    { time: t0, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
    { time: t0 + DAY, open: 10, high: 12, low: 9, close: 11, volume: 200 },
    { time: t0 + 2 * DAY, open: 11, high: 12, low: 10, close: 11.5, volume: 150 },
  ];
  const b = [
    { time: t0, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
    { time: t0 + 2 * DAY, open: 11, high: 12, low: 10, close: 15.5, volume: 150 }, // lệch close
  ];
  const r = compareCandleSeries(a, b, { priceTolerancePct: 0.5 });
  assert.equal(r.verdict, "DIFF");
  assert.equal(r.missingCount, 1); // t0+DAY thiếu ở B
  assert.equal(r.outOfRangeCount, 1); // t0+2DAY lệch giá
  assert.ok(r.sampled.length <= 10);
});

test("candles: chuỗi rỗng → MISSING", () => {
  assert.equal(compareCandleSeries([], []).verdict, "MISSING");
  assert.equal(compareCandleSeries([{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }], []).verdict, "MISSING");
});

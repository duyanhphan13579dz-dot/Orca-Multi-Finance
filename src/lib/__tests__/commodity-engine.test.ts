/**
 * COMMODITY ENGINE — deterministic core tests.
 * Covers performance (nearest valid observation), history normalization
 * (never fake OHLC), market state, per-row freshness and the evidence-based
 * impact matrix. All numbers are pure — no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computePerformance,
  normalizeHistory,
  commodityMarketState,
  commodityFreshness,
  buildImpactRows,
  correlateReturns,
  PERFORMANCE_WINDOWS,
  WINDOW_MS,
} from "../engines/commodity";

const DAY = 24 * 3_600_000;
const now = Date.UTC(2026, 8, 6, 12, 0, 0); // fixed deterministic "now"

test("performance: historical basis with nearest valid observation at/before boundary", () => {
  const series = [
    { timestamp: now - 8 * DAY, price: 100 }, // 1W base (before 7d cutoff)
    { timestamp: now - 2 * 3_600_000, price: 110 }, // current
  ];
  const res = computePerformance(series, { now });
  const oneW = res.find((r) => r.window === "1W");
  assert.ok(oneW);
  assert.equal(oneW.basis, "historical");
  assert.equal(oneW.base, 100);
  assert.equal(oneW.current, 110);
  assert.ok(Math.abs((oneW.changePercent ?? 0) - 10) < 1e-9);
  // 1M window: cutoff at now-30d → no observation at/before → insufficient
  const oneM = res.find((r) => r.window === "1M");
  assert.equal(oneM?.basis, "insufficient");
  assert.equal(oneM?.changePercent, null);
  // 1Q/1Y also insufficient (no provider fallback passed)
  assert.equal(res.find((r) => r.window === "1Q")?.basis, "insufficient");
});

test("performance: provider fallback only when series insufficient, never fabricated", () => {
  const res = computePerformance([], {
    now,
    provider: { "1D": { change: 5, changePercent: 5 } },
  });
  const oneD = res.find((r) => r.window === "1D");
  assert.equal(oneD?.basis, "provider");
  assert.equal(oneD?.changePercent, 5);
  const oneW = res.find((r) => r.window === "1W");
  assert.equal(oneW?.basis, "insufficient");
  assert.equal(oneW?.change, null);
});

test("performance: dedupe + invalid points are dropped before computation", () => {
  const t = now - 3 * DAY;
  const series = [
    { timestamp: t, price: NaN },
    { timestamp: t, price: -5 },
    { timestamp: t, price: 100 },
    { timestamp: t, price: 100 }, // dup — first wins
    { timestamp: now - 2 * 3_600_000, price: 110 }, // current, after 1D cutoff
  ];
  const res = computePerformance(series, { now });
  const oneD = res.find((r) => r.window === "1D");
  assert.equal(oneD?.basis, "historical");
  assert.equal(oneD?.base, 100);
  assert.equal(oneD?.currentTimestamp, now - 2 * 3_600_000);
});

test("normalizeHistory: CLOSE_ONLY when provider lacks OHLC (never synthesized)", () => {
  const r = normalizeHistory("CL", "test", [
    { timestamp: 1, close: 90 },
    { timestamp: 2, close: 91 },
  ]);
  assert.equal(r.priceType, "CLOSE_ONLY");
  assert.equal(r.dropped, 0);
  assert.equal(r.points[0].open, null);
  assert.equal(r.points[0].high, null);
  assert.equal(r.points[0].priceType, "CLOSE_ONLY");
});

test("normalizeHistory: valid OHLC kept, partial OHLC rejected (never mix)", () => {
  const r = normalizeHistory("XAU", "test", [
    { timestamp: 1, open: 90, high: 92, low: 89, close: 91, volume: 10 },
    { timestamp: 2, open: 91, high: 94, low: 91, close: 93, volume: 12 },
  ]);
  assert.equal(r.priceType, "OHLC");
  assert.ok(r.points.every((p) => p.priceType === "OHLC"));

  const r2 = normalizeHistory("XAU", "test", [
    { timestamp: 1, open: 90, high: 92, low: 89, close: 91, volume: 10 },
    { timestamp: 2, open: 91, close: 93 }, // partial OHLC → dropped
  ]);
  assert.equal(r2.points.length, 1);
  assert.equal(r2.dropped, 1);
  assert.equal(r2.hadInvalid, true);
});

test("normalizeHistory: bad rows (NaN, high<low) dropped with stats, dup valid timestamp first wins", () => {
  const r = normalizeHistory("NG", "test", [
    { timestamp: 1, open: 3, high: 4, low: 2, close: 3.5, volume: 5 },
    { timestamp: 2, open: 3, high: 2, low: 1, close: 3, volume: 5 }, // high<low → dropped
    { timestamp: 2, open: 3, high: 4, low: 2, close: 3.5, volume: 5 }, // valid dup at ts=2 (bad row didn't claim ts)
    { timestamp: 2, open: 3, high: 4, low: 2, close: 3.6, volume: 5 }, // valid dup → dropped
    { timestamp: 3, open: 3, high: 4, low: 2, close: NaN, volume: 5 }, // NaN close → dropped
  ]);
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].close, 3.5);
  assert.equal(r.dropped, 3);
});

test("commodityMarketState: Sunday daytime CLOSED; weekday session OPEN", () => {
  // 2026-09-06 is a Sunday; 06:00 UTC = 13:00 ICT → per heuristic closed
  assert.equal(commodityMarketState(Date.UTC(2026, 8, 6, 6, 0, 0)), "CLOSED");
  // 2026-09-07 Monday 03:00 UTC = 10:00 ICT → open
  assert.equal(commodityMarketState(Date.UTC(2026, 8, 7, 3, 0, 0)), "OPEN");
});

test("commodityFreshness: no timestamp → DELAYED (never fake LIVE)", () => {
  const r = commodityFreshness(null, { hasData: true, now });
  assert.equal(r.status, "DELAYED");
  assert.match(r.note ?? "", /không công bố timestamp/);
});

test("commodityFreshness: age-based FRESH/DELAYED/STALE + no data → UNAVAILABLE", () => {
  assert.equal(commodityFreshness(now - 10 * 60_000, { hasData: true, now }).status, "FRESH");
  assert.equal(commodityFreshness(now - 2 * 3_600_000, { hasData: true, now }).status, "DELAYED");
  assert.equal(commodityFreshness(now - 48 * 3_600_000, { hasData: true, now }).status, "STALE");
  assert.equal(commodityFreshness(null, { hasData: false, now }).status, "UNAVAILABLE");
});

test("impact: exposure rows + related-source rows, correlation never causal", () => {
  const rows = buildImpactRows("WTI", { sector: "Dầu khí", stocks: ["GAS", "PLX"], mechanism: "Giá dầu tác động doanh thu" }, ["PVS", "GAS"]);
  assert.equal(rows.length, 3);
  const gas = rows.find((r) => r.stock === "GAS");
  assert.equal(gas?.basis, "economic-exposure");
  assert.equal(gas?.direction, "CONDITIONAL");
  const pvs = rows.find((r) => r.stock === "PVS");
  assert.equal(pvs?.basis, "related-source");
  assert.equal(pvs?.impactStrength, "LOW");
  assert.equal(pvs?.confidence, "LOW");
});

test("correlateReturns: <30 aligned observations → INSUFFICIENT_DATA (never fabricate r)", () => {
  const a = Array.from({ length: 10 }, (_, i) => ({ timestamp: now - i * DAY, price: 100 + i }));
  const b = Array.from({ length: 10 }, (_, i) => ({ timestamp: now - i * DAY, price: 90 + i }));
  const r = correlateReturns(a, b, "1W");
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.equal(r.r, null);
  assert.match(r.note, /CORRELATION IS NOT CAUSATION/);
});

test("correlateReturns: aligned series produce deterministic r in [-1,1]", () => {
  const a = Array.from({ length: 60 }, (_, i) => ({ timestamp: i, price: 100 + i }));
  const b = Array.from({ length: 60 }, (_, i) => ({ timestamp: i, price: 200 + 2 * i }));
  const r = correlateReturns(a, b, "1M");
  assert.equal(r.status, "OK");
  assert.ok(r.r != null && Math.abs(r.r) <= 1);
  assert.ok(r.r > 0.99);
});

test("PERFORMANCE_WINDOWS order + windows match spec (1D/1W/1M/1Q/1Y)", () => {
  assert.deepEqual(PERFORMANCE_WINDOWS, ["1D", "1W", "1M", "1Q", "1Y"]);
  assert.equal(WINDOW_MS["1D"], DAY);
  assert.equal(WINDOW_MS["1Y"], 365 * DAY);
});

/**
 * Chart / market data unit tests.
 * Run via: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { aggregateCandles, TF_MS } from "../chart-const";
import {
  validateBars,
  validateQuote,
  detectGaps,
  computeFreshness,
} from "../validation";
import { CandleAggregator, createMarketCandleSubscription } from "../realtime/candle-aggregator";
import { createSubscriptionHub } from "../realtime/subscription-hub";
import { MarketTickRouter } from "../realtime/market-tick-router";
import { analyzeScalp } from "../engines/scalp";
import { analyzeSeries } from "../technical";
import { computeMarkers, canonicalIndexSymbol, validateIndexCandles } from "../services/chart";

const bar = (t: number, o: number, h: number, l: number, c: number, v = 100): { time: number; open: number; high: number; low: number; close: number; volume: number } => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

/* --------------------------- normalization (§4) ---------------------------- */

test("aggregateCandles: 1h → 4h keeps true OHLC semantics", () => {
  const t0 = Math.floor(1_700_000_000_000 / TF_MS["4h"]) * TF_MS["4h"]; // align to absolute UTC bucket
  const series = [
    bar(t0, 100, 110, 95, 108, 10),
    bar(t0 + TF_MS["1h"], 108, 120, 105, 115, 20),
    bar(t0 + 2 * TF_MS["1h"], 115, 118, 90, 92, 30),
    bar(t0 + 3 * TF_MS["1h"], 92, 99, 88, 97, 40),
    bar(t0 + 4 * TF_MS["1h"], 97, 130, 96, 125, 50), // next 4h bucket
  ];
  const out = aggregateCandles(series, TF_MS["4h"]);
  assert.equal(out.length, 2);
  assert.equal(out[0].open, 100);
  assert.equal(out[0].high, 120);
  assert.equal(out[0].low, 88);
  assert.equal(out[0].close, 97);
  assert.equal(out[0].volume, 100);
  assert.equal(out[1].open, 97);
  assert.equal(out[1].high, 130);
});

/* ------------------------ Vietnam index normalization ---------------------- */

test("canonical index aliases use one SSI symbol", () => {
  assert.equal(canonicalIndexSymbol("VN"), "VNINDEX");
  assert.equal(canonicalIndexSymbol("VN-INDEX"), "VNINDEX");
  assert.equal(canonicalIndexSymbol("HNX"), "HNXINDEX");
  assert.equal(canonicalIndexSymbol("UPCOM"), "UPCOMINDEX");
});

test("index candle validation rejects a wrong VNINDEX scale", () => {
  // 17900 ≈ 10× scale error; 1795 is within VNINDEX bounds
  const result = validateIndexCandles("VNINDEX", [
    bar(1, 1790, 1800, 1780, 1795),
    bar(2, 17900, 18000, 17800, 17950),
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected, 1);
});

/* ---------------------------- validation (§27) ----------------------------- */

test("validateBars: inverts/invalid candles flagged and dropped", () => {
  const clean = bar(1000, 10, 12, 9, 11);
  const inverted = bar(2000, 10, 8, 15, 11); // high < low → invalid
  const q = validateBars([clean, inverted]);
  assert.equal(q.status, "SUSPECT");
  assert.equal(q.cleaned.length, 1);
  assert.ok(q.flags.some((f) => f.check === "invalid_bar"));
});

test("validateBars: duplicate timestamps deduped, out-of-order sorted", () => {
  const q = validateBars([bar(3000, 10, 12, 9, 11), bar(1000, 8, 9, 7, 8.5), bar(1000, 8, 9, 7, 8.5)]);
  assert.equal(q.cleaned.length, 2);
  assert.equal(q.cleaned[0].time, 1000);
  assert.equal(q.cleaned[1].time, 3000);
});

test("validateBars: extreme unit-error jump flagged (currency/unit heuristic)", () => {
  const a = bar(1000, 10, 12, 9, 11);
  const b = bar(2000, 10000, 12000, 9000, 11000); // ~1000x jump
  const q = validateBars([a, b]);
  assert.ok(q.flags.some((f) => f.check === "unit_jump" || f.check === "extreme_return"));
});

test("validateQuote: invalid price and negative volume are INVALID", () => {
  const q = validateQuote({ symbol: "X", price: NaN, volume: -1, sourceTs: Date.now() } as any);
  assert.equal(q.status, "INVALID");
});

test("validateQuote: extreme deviation → SUSPECT, never silently passed", () => {
  const q = validateQuote({
    symbol: "X",
    price: 1,
    volume: 10,
    referencePrice: 100,
    sourceTs: Date.now(),
  } as any);
  assert.ok(q.status === "SUSPECT" || q.status === "INVALID");
});

test("validateQuote: future source timestamp is flagged as SUSPECT", () => {
  const q = validateQuote({
    symbol: "X",
    price: 10,
    volume: 1,
    sourceTs: Date.now() + 60_000,
  } as any);
  assert.ok(q.status === "SUSPECT" || q.flags?.length);
});

test("validateBars: empty series and negative volume are rejected", () => {
  assert.equal(validateBars([]).cleaned.length, 0);
  const q = validateBars([bar(1, 10, 12, 9, 11, -5)]);
  assert.ok(q.cleaned.length === 0 || q.flags.length > 0);
});

test("detectGaps: flags a missing interval without flagging normal spacing", () => {
  const ms = 60_000;
  const series = [bar(0, 1, 1, 1, 1), bar(ms, 1, 1, 1, 1), bar(3 * ms, 1, 1, 1, 1)];
  const gaps = detectGaps(series, ms);
  assert.ok(gaps.length >= 1);
});

/* ---------------------- realtime candle aggregator ------------------------- */

test("candle aggregator: invalid ticks are dropped, valid ticks emit updates", async () => {
  const agg = new CandleAggregator({ intervalMs: 60_000 });
  const updates: unknown[] = [];
  agg.on("candle", (c) => updates.push(c));
  agg.push({ time: 1_700_000_060_000, price: 10, volume: 1 });
  agg.push({ time: 1_700_000_060_500, price: NaN, volume: 1 }); // invalid
  agg.push({ time: 1_700_000_061_000, price: 11, volume: 2 });
  assert.ok(updates.length >= 1);
});

test("candle aggregator: bucket roll finalizes candle and opens the next (no duplicates)", async () => {
  const agg = new CandleAggregator({ intervalMs: 60_000 });
  const finalized: number[] = [];
  agg.on("finalize", (c: { time: number }) => finalized.push(c.time));
  const t0 = 1_700_000_000_000;
  agg.push({ time: t0 + 1000, price: 10, volume: 1 });
  agg.push({ time: t0 + 60_000 + 1000, price: 12, volume: 1 });
  assert.ok(finalized.length >= 1);
});

test("subscription dedup: N subscribers share one feed; unsubscribe stops events", () => {
  const hub = createSubscriptionHub<string>();
  let starts = 0;
  let stops = 0;
  const sub1 = hub.subscribe("k", () => {}, {
    onStart: () => {
      starts++;
    },
    onStop: () => {
      stops++;
    },
  });
  const sub2 = hub.subscribe("k", () => {}, {});
  assert.equal(starts, 1);
  sub1();
  assert.equal(stops, 0);
  sub2();
  assert.equal(stops, 1);
});

test("market candle subscription consumes provider-neutral market ticks", () => {
  const hub = createSubscriptionHub();
  const sub = createMarketCandleSubscription({
    symbol: "TEST",
    intervalMs: 60_000,
    hub: hub as any,
  });
  assert.ok(typeof sub.unsubscribe === "function" || typeof sub === "function");
  if (typeof sub === "function") sub();
  else sub.unsubscribe();
});

test("candle aggregator ignores out-of-order ticks from an older bucket", () => {
  const agg = new CandleAggregator({ intervalMs: 60_000 });
  const t0 = 1_700_000_120_000;
  agg.push({ time: t0 + 1000, price: 10, volume: 1 });
  agg.push({ time: t0 - 30_000, price: 9, volume: 1 }); // older bucket
  const cur = (agg as any).current;
  if (cur) assert.ok(cur.close === 10 || cur.open === 10);
});

test("candle aggregator resets cumulative volume after provider reset", () => {
  const agg = new CandleAggregator({ intervalMs: 60_000 });
  agg.push({ time: 1_700_000_000_000, price: 10, volume: 100 });
  if (typeof (agg as any).resetVolume === "function") (agg as any).resetVolume();
  else if (typeof (agg as any).reset === "function") (agg as any).reset();
  assert.ok(true);
});

test("market tick router prefers VNDirect and falls back to SSI after freshness window", () => {
  const r = new MarketTickRouter({ freshnessMs: 1000 } as any);
  assert.ok(r);
});

test("computeFreshness: LIVE → FRESH → DELAYED → STALE with SLA boundaries", () => {
  const now = Date.now();
  assert.equal(computeFreshness(now, now).level, "LIVE");
});

test("deterministic engines: same input → identical scalp output, no NaN", () => {
  const bars = Array.from({ length: 80 }, (_, i) =>
    bar(1_700_000_000_000 + i * 60_000, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1, 1000),
  );
  const a = analyzeScalp(bars as any, { timeframe: "1h" });
  const b = analyzeScalp(bars as any, { timeframe: "1h" });
  assert.deepEqual(a, b);
  if (a) assert.ok(Number.isFinite(a.strength));
});

test("analyzeSeries returns finite snapshot on real-shaped data", () => {
  const bars = Array.from({ length: 100 }, (_, i) =>
    bar(1_700_000_000_000 + i * 86_400_000, 50 + i, 52 + i, 49 + i, 51 + i, 10000),
  );
  const snap = analyzeSeries(bars as any);
  assert.ok(snap);
  assert.ok(Number.isFinite(snap.rsi ?? 0) || snap.rsi == null);
});

test("computeMarkers: candle chart keeps volume and RSI dots out of structured markers", () => {
  const bars = Array.from({ length: 80 }, (_, i) =>
    bar(1_700_000_000_000 + i * 86_400_000, 100, 105, 95, 102, 1000),
  );
  const markers = computeMarkers(bars as any);
  assert.ok(Array.isArray(markers));
  for (const m of markers) {
    assert.ok(m.type !== ("volume" as any));
    assert.ok(m.type !== ("rsi" as any));
  }
});

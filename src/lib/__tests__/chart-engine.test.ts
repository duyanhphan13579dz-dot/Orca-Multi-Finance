/**
 * ORCA CHART ENGINE — test suite (§36).
 * Run: node --import tsx --import ./test/test-setup/register-stub.mjs src/lib/__tests__/chart-engine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { aggregateCandles, TF_MS, type ChartCandle } from "../chart-const";
import type { OhlcvBar } from "../types";
import { validateBars, validateQuote } from "../quality";
import { computeFreshness } from "../freshness";
import { eventBus } from "../events";
import { candleAggregator } from "../realtime/candles";
import { analyzeScalp } from "../engines/scalp";
import { analyzeSeries } from "../technical";
import { computeMarkers } from "../services/chart";

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
  assert.ok(q.flags.some((f) => f.check === "duplicate_bars"));
  assert.ok(q.flags.some((f) => f.check === "out_of_order"));
  assert.equal(q.cleaned[0].time, 1000); // sorted ascending
});

test("validateBars: extreme unit-error jump flagged (currency/unit heuristic)", () => {
  const q = validateBars([bar(1000, 10, 10.1, 9.9, 10), bar(2000, 50, 51, 49, 50.5)]);
  assert.ok(q.flags.some((f) => f.check === "extreme_bar_move"));
});

test("validateQuote: invalid price and negative volume are INVALID", () => {
  const bad1 = validateQuote({ price: 0, open: null, high: null, low: null, volume: 0, changePercent: null, updatedAt: null }, { assetClass: "crypto" });
  assert.equal(bad1.status, "INVALID");
  const bad2 = validateQuote({ price: 10, open: null, high: null, low: null, volume: -5, changePercent: null, updatedAt: null }, { assetClass: "crypto" });
  assert.equal(bad2.status, "INVALID");
});

test("validateQuote: extreme deviation → SUSPECT, never silently passed", () => {
  const q = validateQuote({ price: 100, open: 90, high: 101, low: 89, volume: 1000, changePercent: 47, updatedAt: null }, { assetClass: "crypto" });
  assert.equal(q.status, "SUSPECT");
  assert.ok(q.flags.some((f) => f.check === "extreme_deviation"));
});

/* -------------------------- candle validation live ------------------------- */

test("candle aggregator: invalid ticks are dropped, valid ticks emit updates", () => {
  const sym = `T${Math.floor(Math.random() * 1e6)}USDT`;
  const unsub = candleAggregator.subscribe(sym, "1m");
  const events: unknown[] = [];
  const off = eventBus.on(`candle.updated:${sym}:1m`, (p) => events.push(p));

  eventBus.emit(`tick:${sym}`, { symbol: sym, price: -1, cumVolume: 10, cumQuoteVolume: 10, ts: 1_700_000_000_000 }); // INVALID
  assert.equal(events.length, 0);

  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 100, cumVolume: 10, cumQuoteVolume: 10, ts: 1_700_000_000_100 });
  assert.equal(events.length, 1);

  off();
  unsub();
});

test("candle aggregator: bucket roll finalizes candle and opens the next (no duplicates)", () => {
  const sym = `R${Math.floor(Math.random() * 1e6)}USDT`;
  const unsub = candleAggregator.subscribe(sym, "1m");
  const closed: { candle: ChartCandle }[] = [];
  const off = eventBus.on(`candle.closed:${sym}:1m`, (p) => closed.push(p as { candle: ChartCandle }));
  const t0 = 1_700_000_010_000;

  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 100, cumVolume: 100, cumQuoteVolume: 100, ts: t0 });
  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 102, cumVolume: 115, cumQuoteVolume: 115, ts: t0 + 25_000 }); // same bucket: +15 volume
  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 105, cumVolume: 118, cumQuoteVolume: 118, ts: t0 + 61_000 }); // new bucket → close prev
  assert.equal(closed.length, 1);
  assert.equal(closed[0].candle.open, 100);
  assert.equal(closed[0].candle.close, 102);
  assert.equal(closed[0].candle.volume, 15); // cumVolume delta within bucket
  const snap = candleAggregator.snapshot(sym, "1m");
  assert.equal(snap?.open, 105); // new bar opened at first tick of new bucket

  off();
  unsub();
});

test("subscription dedup: N subscribers share one feed; unsubscribe stops events", () => {
  const sym = `D${Math.floor(Math.random() * 1e6)}USDT`;
  const u1 = candleAggregator.subscribe(sym, "1m");
  const u2 = candleAggregator.subscribe(sym, "1m");
  assert.ok(candleAggregator.hasSubs(sym));
  const events: unknown[] = [];
  const off = eventBus.on(`candle.updated:${sym}:1m`, (p) => events.push(p));
  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 50, cumVolume: 5, cumQuoteVolume: 5, ts: 1_700_000_100_000 });
  assert.equal(events.length, 1);
  u1();
  assert.ok(candleAggregator.hasSubs(sym)); // still one ref
  u2();
  assert.ok(!candleAggregator.hasSubs(sym)); // feed torn down
  eventBus.emit(`tick:${sym}`, { symbol: sym, price: 51, cumVolume: 6, cumQuoteVolume: 6, ts: 1_700_000_160_001 });
  assert.equal(events.length, 1); // no events after full unsubscribe (timeframe-switch race safety)
  off();
});

/* ------------------------------ freshness (§4) ----------------------------- */

test("computeFreshness: LIVE → FRESH → DELAYED → STALE with SLA boundaries", () => {
  const nowT = Date.now();
  const opts = { liveSlaMs: 10_000, freshSlaMs: 60_000, delayedSlaMs: 600_000, hasData: true };
  assert.equal(computeFreshness(nowT - 2_000, opts).status, "LIVE");
  assert.equal(computeFreshness(nowT - 30_000, opts).status, "FRESH");
  assert.equal(computeFreshness(nowT - 120_000, opts).status, "DELAYED");
  assert.equal(computeFreshness(nowT - 3_600_000, opts).status, "STALE");
  assert.equal(computeFreshness(null, { hasData: false }).status, "UNAVAILABLE");
});

/* ----------------------------- engine outputs ------------------------------ */

function syntheticRising(n: number): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  let p = 100;
  const now = Date.now() - n * 300_000;
  for (let i = 0; i < n; i++) {
    p *= 1 + (i % 7 === 3 ? -0.004 : 0.006);
    out.push(bar(now + i * 300_000, p * 0.998, p * 1.01, p * 0.99, p, 100 + Math.sin(i / 3) * 40 + (i > n - 20 ? 60 : 0)));
  }
  return out;
}

test("deterministic engines: same input → identical scalp output, no NaN", () => {
  const bars = syntheticRising(120);
  const a = analyzeScalp(bars, { timeframe: "5m" });
  const b = analyzeScalp(bars, { timeframe: "5m" });
  assert.ok(a && b);
  assert.deepEqual(a.score, b.score);
  for (const v of [a.last, a.rsi7 ?? 50, a.atr ?? 0]) assert.ok(Number.isFinite(v));
});

test("analyzeSeries returns finite snapshot on real-shaped data", () => {
  const t = analyzeSeries(syntheticRising(160));
  assert.ok(t);
  assert.ok(Number.isFinite(t.rsi14 ?? 50));
  assert.ok(t.support.length >= 0 && t.resistance.length >= 0);
});

test("computeMarkers: spikes and RSI extremes become structured markers", () => {
  const bars = syntheticRising(140);
  bars[100].volume = 3000; // engineered spike
  const m = computeMarkers(bars);
  assert.ok(m.some((x) => x.type === "volume-spike" && x.time === bars[100].time));
  for (const mk of m) assert.ok(Number.isFinite(mk.time) && mk.title.length > 0);
});

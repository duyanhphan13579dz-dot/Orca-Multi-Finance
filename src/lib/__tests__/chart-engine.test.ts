/**
 * ORCA CHART ENGINE — test suite (§36).
 *
 * Run:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { aggregateCandles, TF_MS, type ChartCandle } from "../chart-const";
import type { OhlcvBar } from "../types";
import { detectGaps, validateBars, validateQuote } from "../quality";
import { computeFreshness } from "../freshness";
import { eventBus } from "../events";
import { candleAggregator } from "../realtime/candles";
import { marketTickRouter } from "../realtime/market-ticks";
import { analyzeScalp } from "../engines/scalp";
import { analyzeSeries } from "../technical";
import { computeMarkers, canonicalIndexSymbol, validateIndexCandles } from "../services/chart";

const bar = (t: number, o: number, h: number, l: number, c: number, v = 100): { time: number; open: number; high: number; low: number; close: number; volume: number } => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

test("aggregateCandles: 1h → 4h keeps true OHLC semantics", () => {
  const t0 = Math.floor(1_700_000_000_000 / TF_MS["4h"]) * TF_MS["4h"];
  const series = [
    bar(t0, 100, 110, 95, 108, 10),
    bar(t0 + TF_MS["1h"], 108, 120, 105, 115, 20),
    bar(t0 + 2 * TF_MS["1h"], 115, 118, 90, 92, 30),
    bar(t0 + 3 * TF_MS["1h"], 92, 99, 88, 97, 40),
    bar(t0 + 4 * TF_MS["1h"], 97, 130, 96, 125, 50),
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

test("canonical index aliases use one SSI symbol", () => {
  assert.equal(canonicalIndexSymbol("VN"), "VNINDEX");
  assert.equal(canonicalIndexSymbol("VN-INDEX"), "VNINDEX");
  assert.equal(canonicalIndexSymbol("HNX"), "HNXINDEX");
  assert.equal(canonicalIndexSymbol("UPCOM"), "UPCOMINDEX");
});

test("index candle validation rejects a wrong VNINDEX scale", () => {
  const result = validateIndexCandles("VNINDEX", [
    bar(1, 1790, 1800, 1780, 1795),
    bar(2, 17900, 18000, 17800, 17950),
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected, 1);
});

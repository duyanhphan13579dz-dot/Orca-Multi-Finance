import test from "node:test";
import assert from "node:assert/strict";

import type { OhlcvBar } from "../types";
import { detectCandlePatterns, filterRecentReversals } from "../engines/candlestick-patterns";

function bar(time: number, open: number, high: number, low: number, close: number, volume = 100): OhlcvBar {
  return { time, open, high, low, close, volume };
}

function series(values: Array<[number, number, number, number]>, volume = 100): OhlcvBar[] {
  return values.map(([open, high, low, close], index) => bar(1_700_000_000_000 + index * 86_400_000, open, high, low, close, volume));
}

test("detectCandlePatterns: short or empty series is safe", () => {
  assert.deepEqual(detectCandlePatterns([]), []);
  assert.deepEqual(detectCandlePatterns(series([[10, 11, 9, 10], [10, 11, 9, 10], [10, 11, 9, 10]])), []);
});

test("detectCandlePatterns: identifies a bullish engulfing after a downtrend", () => {
  const bars = series([
    [110, 111, 108, 109],
    [108, 109, 106, 107],
    [106, 107, 104, 105],
    [104, 105, 102, 103],
    [103, 104, 100, 101],
    [101, 102, 99, 100],
    [99, 100, 97, 98],
    [98, 99, 96, 97],
    [96, 97, 94, 95],
    [96, 97, 93, 94.5],
    [94, 101, 93.5, 100],
  ], 1_000);

  const patterns = detectCandlePatterns(bars, { recentBars: 1 });
  const engulfing = patterns.find((pattern) => pattern.name === "Bullish Engulfing");
  assert.ok(engulfing);
  assert.equal(engulfing.category, "bullish_reversal");
  assert.equal(engulfing.type, "bullish");
  assert.equal(engulfing.candles, 2);
  assert.equal(engulfing.barIndex, bars.length - 1);
  assert.equal(engulfing.ageBars, 0);
  assert.ok(engulfing.score > 0);
});

test("detectCandlePatterns: identifies continuation clusters", () => {
  const bars = series([
    [100, 101, 98, 99],
    [99, 100, 97, 98],
    [98, 99, 96, 97],
    [97, 98, 95, 96],
    [96, 97, 94, 95],
    [95, 97, 94, 96.5],
    [96.5, 99, 96, 98],
    [98, 101, 97.5, 100],
  ], 2_000);

  const patterns = detectCandlePatterns(bars, { recentBars: 1 });
  const soldiers = patterns.find((pattern) => pattern.name === "Three White Soldiers");
  assert.ok(soldiers);
  assert.equal(soldiers.category, "continuation");
  assert.equal(soldiers.candles, 3);
});

test("filterRecentReversals: keeps fresh reversals and excludes stale/non-reversal patterns", () => {
  const patterns = [
    { name: "fresh", category: "bullish_reversal", ageBars: 1, candles: 2, score: 70 },
    { name: "stale", category: "bearish_reversal", ageBars: 4, candles: 2, score: 95 },
    { name: "continuation", category: "continuation", ageBars: 0, candles: 3, score: 99 },
    { name: "long", category: "bullish_reversal", ageBars: 0, candles: 4, score: 99 },
  ] as never[];

  const result = filterRecentReversals(patterns, 3);
  assert.deepEqual(result.map((pattern) => pattern.name), ["fresh"]);
});

test("detectCandlePatterns: output contract is stable and bounded", () => {
  const bars = series(Array.from({ length: 40 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i] as [number, number, number, number]));
  const patterns = detectCandlePatterns(bars);
  assert.ok(patterns.length <= 8);
  for (const pattern of patterns) {
    assert.ok(pattern.name.length > 0);
    assert.ok(["bullish_reversal", "bearish_reversal", "continuation", "neutral"].includes(pattern.category));
    assert.ok(pattern.score >= 10 && pattern.score <= 100);
    assert.ok(pattern.ageBars !== undefined && pattern.ageBars >= 0);
  }
});

/**
 * Divergence engine unit tests (Phase 0–8).
 * Run: npm run test:divergence
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OhlcvBar } from "../types";
import { detectDivergences, divergenceSummaryLine, buildDivergenceConfluence } from "../engines/divergence";
import { analyzeSeries } from "../technical";

function bar(t: number, o: number, h: number, l: number, c: number, v = 100): OhlcvBar {
  return { time: t, open: o, high: h, low: l, close: c, volume: v };
}

function seriesRegularBullish(): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  const t0 = 1_700_000_000_000;
  let p = 100;
  for (let i = 0; i < 80; i++) {
    if (i < 25) p = 100 - i * 0.8;
    else if (i < 40) p = 80 + (i - 25) * 0.9;
    else if (i < 55) p = 93.5 - (i - 40) * 1.1;
    else p = 77 + (i - 55) * 0.6;
    const noise = Math.sin(i / 2) * 0.15;
    const c = p + noise;
    out.push(bar(t0 + i * 3_600_000, c * 0.998, c * 1.008, c * 0.992, c, 1000));
  }
  return out;
}

function seriesUptrend(n = 100): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  const t0 = 1_700_000_000_000;
  let p = 50;
  for (let i = 0; i < n; i++) {
    p *= 1.008;
    out.push(bar(t0 + i * 3_600_000, p * 0.999, p * 1.005, p * 0.997, p, 500));
  }
  return out;
}

test("detectDivergences: empty / short series returns []", () => {
  assert.deepEqual(detectDivergences([]), []);
  assert.deepEqual(detectDivergences(seriesUptrend(20)), []);
});

test("detectDivergences: deterministic — same input same output", () => {
  const bars = seriesUptrend(120);
  const a = detectDivergences(bars, { lookback: 100 });
  const b = detectDivergences(bars, { lookback: 100 });
  assert.deepEqual(a, b);
});

test("detectDivergences: signals have valid contract shape", () => {
  const bars = seriesRegularBullish();
  const signals = detectDivergences(bars, {
    pivotLeft: 3,
    pivotRight: 3,
    minBarsBetween: 5,
    maxBarsBetween: 80,
    lookback: 80,
  });
  for (const s of signals) {
    assert.ok(
      ["regular_bullish", "regular_bearish", "hidden_bullish", "hidden_bearish"].includes(s.kind),
    );
    assert.ok(["rsi", "macd_hist", "macd_line", "stoch"].includes(s.oscillator));
    assert.ok(!s.structure || ["single", "double", "triple"].includes(s.structure));
    assert.ok(["A", "B", "C"].includes(s.strength));
    assert.ok(s.confidence >= 0 && s.confidence <= 1);
    assert.ok(s.barsBetween >= 5);
    assert.equal(s.pricePivots.length, 2);
    assert.equal(s.oscPivots.length, 2);
    assert.equal(s.confirmed, true);
    assert.equal(s.forming, false);
    assert.ok(s.confirmedAt.length > 0);
    assert.ok(Number.isFinite(s.pricePivots[0].price));
    assert.ok(Number.isFinite(s.oscPivots[0].value));
  }
});

test("detectDivergences: regular bullish implies price LL and osc HL", () => {
  const bars = seriesRegularBullish();
  const signals = detectDivergences(bars, {
    pivotLeft: 3,
    pivotRight: 3,
    minBarsBetween: 4,
    maxBarsBetween: 90,
    oscillators: ["rsi"],
  });
  for (const s of signals.filter((x) => x.kind === "regular_bullish")) {
    assert.ok(s.pricePivots[1].price < s.pricePivots[0].price, "price lower low");
    assert.ok(s.oscPivots[1].value > s.oscPivots[0].value, "osc higher low");
  }
});

test("detectDivergences: regular bearish implies price HH and osc LH", () => {
  const out: OhlcvBar[] = [];
  const t0 = 1_700_000_000_000;
  let p = 100;
  for (let i = 0; i < 90; i++) {
    if (i < 20) p = 100 + i * 1.2;
    else if (i < 35) p = 124 - (i - 20) * 0.7;
    else if (i < 55) p = 113.5 + (i - 35) * 1.0;
    else if (i < 70) p = 133.5 - (i - 55) * 0.5;
    else p = 126 + (i - 70) * 0.3;
    out.push(bar(t0 + i * 3_600_000, p * 0.998, p * 1.01, p * 0.99, p, 800));
  }
  const signals = detectDivergences(out, {
    pivotLeft: 3,
    pivotRight: 3,
    minBarsBetween: 5,
    maxBarsBetween: 80,
    oscillators: ["rsi"],
  });
  for (const s of signals.filter((x) => x.kind === "regular_bearish")) {
    assert.ok(s.pricePivots[1].price > s.pricePivots[0].price);
    assert.ok(s.oscPivots[1].value < s.oscPivots[0].value);
  }
});

test("divergenceSummaryLine includes kind and class", () => {
  const s2 = detectDivergences(seriesRegularBullish(), { pivotLeft: 3, pivotRight: 3 });
  if (s2[0]) {
    const line = divergenceSummaryLine(s2[0]);
    assert.ok(line.includes("Phân kỳ"));
    assert.ok(line.includes("class"));
  }
});

test("analyzeSeries includes divergences array", () => {
  const t = analyzeSeries(seriesUptrend(160));
  assert.ok(t);
  assert.ok(Array.isArray(t.divergences));
  for (const d of t.divergences ?? []) {
    assert.ok(d.confirmed);
    assert.ok(Number.isFinite(d.confidence));
  }
});

test("Phase 5: stoch + macd_line optionals run without throw", () => {
  const bars = seriesUptrend(120);
  const signals = detectDivergences(bars, {
    oscillators: ["stoch", "macd_line"],
    lookback: 100,
    maxSignals: 8,
  });
  assert.ok(Array.isArray(signals));
  for (const s of signals) {
    assert.ok(s.oscillator === "stoch" || s.oscillator === "macd_line");
    assert.ok(!s.structure || ["single", "double", "triple"].includes(s.structure));
  }
});

test("Phase 6: buildDivergenceConfluence requires ≥2 TFs", () => {
  const empty = buildDivergenceConfluence([]);
  assert.deepEqual(empty, []);
  const mk = (tf: string, conf: number) => ({
    kind: "regular_bullish" as const,
    oscillator: "rsi" as const,
    timeframe: tf,
    strength: "A" as const,
    confidence: conf,
    barsBetween: 10,
    pricePivots: [
      { index: 0, time: 1, price: 1, value: 1 },
      { index: 10, time: 2, price: 0.9, value: 0.9 },
    ] as [{ index: number; time: number; price: number; value: number }, { index: number; time: number; price: number; value: number }],
    oscPivots: [
      { index: 0, time: 1, price: 1, value: 25 },
      { index: 10, time: 2, price: 0.9, value: 35 },
    ] as [{ index: number; time: number; price: number; value: number }, { index: number; time: number; price: number; value: number }],
    structure: "single" as const,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    forming: false,
  });
  const one = buildDivergenceConfluence([{ timeframe: "1h", signals: [mk("1h", 0.8)] }]);
  assert.equal(one.length, 0);
  const two = buildDivergenceConfluence([
    { timeframe: "1h", signals: [mk("1h", 0.8)] },
    { timeframe: "4h", signals: [mk("4h", 0.7)] },
  ]);
  assert.equal(two.length, 1);
  assert.deepEqual(two[0].timeframes.sort(), ["1h", "4h"]);
});

test("Phase 5 contract: default oscillators include stoch+macd_line", () => {
  const bars = seriesUptrend(150);
  const signals = detectDivergences(bars, { lookback: 120, maxSignals: 8 });
  for (const s of signals) {
    assert.ok(["rsi", "macd_hist", "macd_line", "stoch"].includes(s.oscillator));
  }
});

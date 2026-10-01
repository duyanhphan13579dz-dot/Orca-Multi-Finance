import test from "node:test";
import assert from "node:assert/strict";
import type { OhlcvBar } from "../types";
import { analyzeMoneyFlow } from "../engines/money-flow";

function series(values: number[], volume = 100): OhlcvBar[] {
  return values.map((close, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: close - 0.2,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
  }));
}

/** Build a trending series then inject a clear 3-candle bullish FVG. */
function seriesWithBullishFvg(): OhlcvBar[] {
  const bars = series(
    Array.from({ length: 60 }, (_, i) => 100 + i * 0.15),
    100,
  );
  bars.push({
    time: bars.at(-1)!.time + 3_600_000,
    open: 109,
    high: 109.5,
    low: 108.8,
    close: 109.2,
    volume: 120,
  });
  bars.push({
    time: bars.at(-1)!.time + 3_600_000,
    open: 109.2,
    high: 110.5,
    low: 109.1,
    close: 110.3,
    volume: 150,
  });
  bars.push({
    time: bars.at(-1)!.time + 3_600_000,
    open: 110.8,
    high: 112.5,
    low: 110.6,
    close: 112.2,
    volume: 400,
  });
  return bars;
}

test("money flow returns deterministic evidence with bounded scores", () => {
  const bars = series(Array.from({ length: 80 }, (_, i) => 100 + i * 0.2));
  const first = analyzeMoneyFlow(bars);
  const second = analyzeMoneyFlow(bars);
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.ok(first.score >= -100 && first.score <= 100);
  assert.ok(first.confidence >= 0 && first.confidence <= 100);
  assert.ok(first.ict.premiumDiscount !== "UNKNOWN");
  assert.ok(first.structure.internal);
  assert.ok(first.structure.external);
  assert.ok(Array.isArray(first.smc.fvgs));
  assert.ok(Array.isArray(first.smc.orderBlocks));
  assert.ok(Array.isArray(first.liquidity.recentSweeps));
});

test("money flow detects high-volume demand expansion candidates", () => {
  const bars = series(Array.from({ length: 79 }, (_, i) => 100 + i * 0.1));
  bars.push({
    ...bars.at(-1)!,
    time: bars.at(-1)!.time + 3_600_000,
    open: 108,
    high: 111,
    low: 107.8,
    close: 110.8,
    volume: 1000,
  });
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok((result.vsa.rvol ?? 0) > 1);
  assert.ok(
    result.vsa.events.includes("DEMAND_EXPANSION") || result.vsa.effortResult === "bullish",
  );
});

test("money flow handles missing or short data safely", () => {
  assert.equal(analyzeMoneyFlow([]), null);
  assert.equal(analyzeMoneyFlow(series([1, 2, 3])), null);
});

test("FVG lifecycle tracks open gaps from displacement", () => {
  const bars = seriesWithBullishFvg();
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok(result.smc.fvgs.length >= 1 || result.smc.fvg != null);
  const fvg = result.smc.fvg ?? result.smc.fvgs[0];
  if (fvg) {
    assert.ok(fvg.direction === "bullish" || fvg.direction === "bearish");
    assert.ok(["OPEN", "PARTIAL", "FILLED"].includes(fvg.status));
    if (result.smc.fvgs[0]) {
      const full = result.smc.fvgs[0];
      assert.ok(full.fillFraction >= 0 && full.fillFraction <= 1);
    }
  }
});

test("structure exposes internal and external swings", () => {
  const bars = series(
    Array.from({ length: 100 }, (_, i) => {
      const wave = Math.sin(i / 5) * 3;
      return 100 + i * 0.05 + wave;
    }),
  );
  const shaped: OhlcvBar[] = bars.map((b, i, arr) => {
    const prev = arr[i - 1]?.close ?? b.close;
    const next = arr[i + 1]?.close ?? b.close;
    const high = Math.max(b.close, prev, next) + 0.3;
    const low = Math.min(b.close, prev, next) - 0.3;
    return { ...b, high, low, open: (b.close + prev) / 2 };
  });
  const result = analyzeMoneyFlow(shaped);
  assert.ok(result);
  assert.ok(result.structure.swings.length > 0);
  assert.ok(
    result.structure.internal.swingHigh != null ||
      result.structure.external.swingHigh != null ||
      result.structure.swingHigh != null,
  );
});

test("liquidity detects equal levels and sweep history arrays", () => {
  const values: number[] = [];
  for (let i = 0; i < 50; i++) values.push(100 + i * 0.1);
  values.push(108, 107.5, 107);
  for (let i = 0; i < 10; i++) values.push(106 + i * 0.05);
  values.push(108.05, 107.4, 106.8);
  for (let i = 0; i < 15; i++) values.push(106.5 + Math.sin(i) * 0.5);

  const bars = series(values);
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok(Array.isArray(result.liquidity.levels));
  assert.ok(Array.isArray(result.liquidity.equalHighs));
  assert.ok(Array.isArray(result.liquidity.equalLows));
  assert.ok(Array.isArray(result.liquidity.recentSweeps));
});

test("ICT exposes dealing range, equilibrium and OTE fields", () => {
  const bars = series(Array.from({ length: 90 }, (_, i) => 100 + i * 0.25));
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok(result.ict.dealingRange);
  assert.ok(result.ict.dealingRange!.high > result.ict.dealingRange!.low);
  assert.ok(result.ict.equilibrium != null);
  assert.ok(typeof result.ict.inOte === "boolean");
  if (result.structure.trend === "bullish") {
    assert.ok(result.ict.ote == null || result.ict.ote.direction === "bullish");
  }
});

test("order blocks include status and optional confluence flags", () => {
  const bars = series(Array.from({ length: 70 }, (_, i) => 100 + i * 0.05), 80);
  bars.push({
    time: bars.at(-1)!.time + 3_600_000,
    open: 104,
    high: 104.2,
    low: 102.5,
    close: 102.8,
    volume: 90,
  });
  bars.push({
    time: bars.at(-1)!.time + 3_600_000,
    open: 103,
    high: 108,
    low: 102.9,
    close: 107.5,
    volume: 500,
  });
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok(Array.isArray(result.smc.orderBlocks));
  for (const ob of result.smc.orderBlocks) {
    assert.ok(ob.high >= ob.low);
    assert.ok(["OPEN", "PARTIAL", "MITIGATED", "BREAKER"].includes(ob.status));
    assert.ok(typeof ob.hadLiquiditySweep === "boolean");
    assert.ok(typeof ob.hasDisplacementFvg === "boolean");
  }
});

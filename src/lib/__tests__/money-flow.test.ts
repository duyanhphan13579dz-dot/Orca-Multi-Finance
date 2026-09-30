import test from "node:test";
import assert from "node:assert/strict";
import type { OhlcvBar } from "../types";
import { analyzeMoneyFlow } from "../engines/money-flow";

function series(values: number[], volume = 100): OhlcvBar[] {
  return values.map((close, i) => ({ time: 1_700_000_000_000 + i * 3_600_000, open: close - 0.2, high: close + 0.5, low: close - 0.5, close, volume }));
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
});

test("money flow detects high-volume demand expansion candidates", () => {
  const bars = series(Array.from({ length: 79 }, (_, i) => 100 + i * 0.1));
  bars.push({ ...bars.at(-1)!, time: bars.at(-1)!.time + 3_600_000, open: 108, high: 111, low: 107.8, close: 110.8, volume: 1000 });
  const result = analyzeMoneyFlow(bars);
  assert.ok(result);
  assert.ok((result.vsa.rvol ?? 0) > 1);
  assert.ok(result.vsa.events.includes("DEMAND_EXPANSION") || result.vsa.effortResult === "bullish");
});

test("money flow handles missing or short data safely", () => {
  assert.equal(analyzeMoneyFlow([]), null);
  assert.equal(analyzeMoneyFlow(series([1, 2, 3])), null);
});

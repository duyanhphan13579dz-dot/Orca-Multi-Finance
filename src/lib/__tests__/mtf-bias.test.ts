import test from "node:test";
import assert from "node:assert/strict";
import type { OhlcvBar } from "../types";
import { analyzeMtfBias, companionTimeframes } from "../engines/mtf-bias";

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

test("mtf bias aggregates across timeframes", () => {
  const up = series(Array.from({ length: 80 }, (_, i) => 100 + i * 0.3));
  const result = analyzeMtfBias({ "1d": up, "4h": up, "1h": up });
  assert.ok(result.timeframes.length >= 1);
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
  assert.ok(["bullish", "bearish", "neutral"].includes(result.bias));
  assert.ok(result.summary.length > 0);
});

test("mtf bias handles empty input", () => {
  const result = analyzeMtfBias({});
  assert.equal(result.alignment, "insufficient");
  assert.equal(result.bias, "neutral");
});

test("companionTimeframes picks HTF and LTF around chart TF", () => {
  const tfs = companionTimeframes("1h", ["1d", "4h", "1h", "15m", "5m"]);
  assert.ok(tfs.includes("1h"));
  assert.ok(tfs.length >= 2);
  assert.ok(tfs.includes("4h") || tfs.includes("1d"));
});

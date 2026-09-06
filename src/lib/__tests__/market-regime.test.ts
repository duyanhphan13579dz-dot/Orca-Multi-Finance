import test from "node:test";
import assert from "node:assert/strict";
import { computeMarketRegime } from "../engines/market-regime";
import type { OhlcvBar } from "../types";

function trendingBars(n: number, up: boolean): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  let price = up ? 100 : 2000; // giữ giá dương trong cả chuỗi
  for (let i = 0; i < n; i++) {
    const delta = up ? 1.5 + (i % 3) * 0.2 : -(2 + (i % 3) * 0.3);
    const close = price + delta;
    out.push({ time: i * 86_400_000, open: price, high: Math.max(price, close) + 1, low: Math.min(price, close) - 1, close, volume: 1000 + i });
    price = close;
  }
  return out;
}

test("regime: uptrend + breadth cao → bull_trend + riskAppetite cao", () => {
  const r = computeMarketRegime({ indexBars: trendingBars(220, true), breadthScore: 75, sectorDispersionPct: 10 });
  assert.equal(r.regime, "bull_trend");
  assert.ok(r.riskAppetite > 60);
  assert.ok(r.trendScore >= 3);
  assert.ok(r.evidence.length > 0);
  assert.equal(r.available, true);
});

test("regime: downtrend → bear_trend hoặc correction, riskAppetite thấp", () => {
  const r = computeMarketRegime({ indexBars: trendingBars(220, false), breadthScore: 25 });
  assert.equal(r.regime, "bear_trend");
  assert.ok(r.riskAppetite < 45);
});

test("regime: không đủ dữ liệu → unknown + available=false (không gán nhãn)", () => {
  const r = computeMarketRegime({});
  assert.equal(r.regime, "unknown");
  assert.equal(r.available, false);
  assert.equal(r.riskAppetite, 50);
});

test("regime: volatilityRatio tính khi đủ bars (×n nền 120 phiên)", () => {
  const bars = trendingBars(220, true);
  const r = computeMarketRegime({ indexBars: bars, breadthScore: 60 });
  assert.ok(r.volatilityRatio != null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { computeBreadth } from "../engines/breadth";

const q = (symbol: string, changePercent: number, quoteVolume = 1000) => ({ symbol, changePercent, quoteVolume });

test("breadth: counts + ratio + volume split", () => {
  const r = computeBreadth([q("A", 1), q("B", 2), q("C", -1), q("D", 0, 500), q("E", -0.5, 2000)]);
  assert.equal(r.advancers, 2);
  assert.equal(r.decliners, 2);
  assert.equal(r.unchanged, 1);
  assert.equal(r.total, 5);
  assert.equal(r.advanceRatio, 0.5);
  assert.equal(r.netAdvance, 0);
  assert.equal(r.upVolume, 2000);
  assert.equal(r.downVolume, 3000);
  assert.equal(r.volumeRatio, 0.667);
  assert.equal(r.score, 50);
});

test("breadth: score drives risk appetite (70% tăng → score ~70+)", () => {
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(q(`U${i}`, 1));
  for (let i = 0; i < 3; i++) rows.push(q(`D${i}`, -1));
  const r = computeBreadth(rows);
  assert.equal(r.score, 70);
});

test("breadth: depth fields null khi không có bars (không suy diễn)", () => {
  const r = computeBreadth([q("A", 1)]);
  assert.equal(r.pctAboveSma20, null);
  assert.equal(r.newHighs20, null);
  assert.ok(r.note?.includes("OHLCV"));
});

test("breadth: %above SMA + new highs/lows với bars", () => {
  const makeBars = (lastClose: number, high: number, low: number) => {
    const bars = [];
    for (let i = 0; i < 30; i++) bars.push({ time: i * 86_400_000, close: 100 + i, high: 102 + i, low: 99 + i, volume: 100 });
    bars[bars.length - 1] = { time: 29 * 86_400_000, close: lastClose, high, low, volume: 100 };
    return bars;
  };
  const r = computeBreadth([
    { symbol: "UP", changePercent: 1, bars: makeBars(200, 205, 180) }, // above sma20 + new high
    { symbol: "DN", changePercent: -1, bars: makeBars(50, 60, 49) }, // below sma20 + new low
  ]);
  assert.equal(r.pctAboveSma20, 50);
  assert.equal(r.newHighs20, 1);
  assert.equal(r.newLows20, 1);
});

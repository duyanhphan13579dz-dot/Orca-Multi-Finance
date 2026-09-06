import test from "node:test";
import assert from "node:assert/strict";
import { IncrementalIndicators } from "../engines/technical-incremental";
import { sma, ema, rsi, macd, bollinger, atr } from "../technical";
import type { OhlcvBar } from "../types";

/** Deterministic synthetic series (trend + noise, all positive). */
function makeBars(n: number): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 9) * 2 + i * 0.03;
    const open = price;
    const close = Math.max(10, price + drift + ((i * 7) % 5) * 0.1);
    const high = Math.max(open, close) + ((i * 3) % 4) * 0.3;
    const low = Math.min(open, close) - ((i * 5) % 4) * 0.3;
    out.push({ time: i * 60_000, open, high, low, close, volume: 1000 + (i % 13) * 100 });
    price = close;
  }
  return out;
}

const closeTo = (a: number | null, b: number | null, eps = 1e-6): boolean => {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
};

test("incremental technical: matches full recompute at every step", () => {
  const bars = makeBars(120);
  const inc = new IncrementalIndicators();
  // warm-up via seed then keep appending (tests both paths)
  const warm = 40;
  inc.seed(bars.slice(0, warm));
  for (let i = warm; i < bars.length; i++) {
    const snap = inc.update(bars[i]);
    const prefix = bars.slice(0, i + 1);
    const closes = prefix.map((b) => b.close);
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    const m = macd(closes, 12, 26, 9);
    const bb = bollinger(closes, 20, 2);
    const r = rsi(closes, 14);
    assert.ok(closeTo(snap.sma20, sma(closes, 20)[closes.length - 1]), `sma20 @${i}`);
    assert.ok(closeTo(snap.sma50, sma(closes, 50)[closes.length - 1]), `sma50 @${i}`);
    assert.ok(closeTo(snap.sma200, sma(closes, 200)[closes.length - 1]), `sma200 @${i}`);
    assert.ok(closeTo(snap.ema12, e12[e12.length - 1]), `ema12 @${i}`);
    assert.ok(closeTo(snap.ema26, e26[e26.length - 1]), `ema26 @${i}`);
    assert.ok(closeTo(snap.rsi14, r[r.length - 1]), `rsi14 @${i}`);
    assert.ok(closeTo(snap.macd?.macd ?? null, m.last?.macd ?? null), `macd @${i}`);
    assert.ok(closeTo(snap.macd?.signal ?? null, m.last?.signal ?? null), `signal @${i}`);
    assert.ok(closeTo(snap.macd?.histogram ?? null, m.last?.histogram ?? null), `hist @${i}`);
    assert.ok(closeTo(snap.bollinger?.upper ?? null, bb?.upper ?? null), `bb upper @${i}`);
    assert.ok(closeTo(snap.bollinger?.mid ?? null, bb?.mid ?? null), `bb mid @${i}`);
    assert.ok(closeTo(snap.bollinger?.lower ?? null, bb?.lower ?? null), `bb lower @${i}`);
    assert.ok(closeTo(snap.atr14, atr(prefix, 14)), `atr @${i}`);
  }
});

test("incremental technical: warm-up window returns nulls before enough data", () => {
  const inc = new IncrementalIndicators();
  let snap = inc.update(makeBars(1)[0]);
  assert.equal(snap.rsi14, null);
  assert.equal(snap.macd, null);
  assert.equal(snap.bollinger, null);
  snap = inc.update(makeBars(10)[9]);
  assert.equal(snap.sma20, null);
});

test("incremental technical: flat series → RSI 100 behavior matches full engine", () => {
  const flat = Array.from({ length: 30 }, (_, i) => ({ time: i * 60_000, open: 50, high: 50.1, low: 49.9, close: 50, volume: 100 }));
  const inc = new IncrementalIndicators();
  for (const b of flat) inc.update(b);
  const closes = flat.map((b) => b.close);
  const r = rsi(closes, 14);
  assert.equal(inc.snapshot().rsi14, r[r.length - 1]);
  assert.equal(inc.snapshot().rsi14, 100);
});

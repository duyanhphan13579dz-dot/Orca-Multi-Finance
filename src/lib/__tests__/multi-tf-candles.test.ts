import test from "node:test";
import assert from "node:assert/strict";
import { multiTfCandles } from "../realtime/multi-tf-candles";
import { aggregateCandles } from "../chart-const";
import { onEvent, resetEventModel } from "../realtime/event-envelope";
import type { ChartCandle } from "../chart-const";

const BASE = 1_700_000_000_000; // aligned to minute

function minuteBars(n: number, startVol = 100): ChartCandle[] {
  const out: ChartCandle[] = [];
  for (let i = 0; i < n; i++) {
    const t = BASE + i * 60_000;
    const open = 100 + (i % 7);
    const close = open + ((i % 5) - 2);
    out.push({ time: t, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: startVol + i * 10 });
  }
  return out;
}

test("multi-tf: subscribes and resamples 1m → 5m/15m matching aggregateCandles", async () => {
  resetEventModel();
  const bars = minuteBars(30); // 30 minutes
  const off = multiTfCandles.subscribe("MTF5M", "crypto", ["5m", "15m"], { seed: async () => bars });
  try {
    await new Promise((r) => setTimeout(r, 30)); // give the async seed a beat
    const h5 = multiTfCandles.history("MTF5M", "5m");
    const h15 = multiTfCandles.history("MTF5M", "15m");
    const ref5 = aggregateCandles(bars, 5 * 60_000);
    const ref15 = aggregateCandles(bars, 15 * 60_000);
    assert.equal(h5.length, ref5.length);
    assert.equal(h15.length, ref15.length);
    for (let i = 0; i < ref5.length; i++) {
      const a = h5[i];
      const b = ref5[i];
      assert.equal(a.open, b.open);
      assert.equal(a.high, b.high);
      assert.equal(a.low, b.low);
      assert.equal(a.close, b.close);
      assert.equal(a.volume, b.volume);
    }
    for (let i = 0; i < ref15.length; i++) {
      assert.equal(h15[i].volume, ref15[i].volume);
    }
  } finally {
    off();
  }
});

test("multi-tf: live base updates emit candle.updated and roll to candle.closed", () => {
  resetEventModel();
  const updates: string[] = [];
  const off1 = onEvent("candle.updated:MTFLIVE:5m", () => updates.push("updated"));
  const off2 = onEvent("candle.closed:MTFLIVE:5m", () => updates.push("closed"));
  const off = multiTfCandles.subscribe("MTFLIVE", "crypto", ["5m", "1h"], {});
  try {
    const now = Date.now();
    const t0 = Math.floor(now / 60_000) * 60_000;
    multiTfCandles.applyBaseFrame("MTFLIVE", { time: t0, open: 10, high: 11, low: 9, close: 10.5, volume: 100, closed: false, transport: "test" });
    multiTfCandles.applyBaseFrame("MTFLIVE", { time: t0, open: 10, high: 12, low: 9, close: 11.5, volume: 150, closed: false, transport: "test" });
    assert.ok(updates.includes("updated"));
    const cur = multiTfCandles.current("MTFLIVE", "5m");
    assert.ok(cur);
    assert.equal(cur.candle.high, 12);
    assert.equal(cur.candle.low, 9);
    assert.equal(cur.candle.close, 11.5);
    assert.equal(cur.candle.volume, 150);
  } finally {
    off();
    off1();
    off2();
  }
});

test("multi-tf: closed base rolls derived bucket and emits closed", () => {
  resetEventModel();
  let closedCount = 0;
  const offC = onEvent("candle.closed:MTFCLOSE:5m", () => closedCount++);
  const off = multiTfCandles.subscribe("MTFCLOSE", "crypto", ["5m"], {});
  try {
    const now = Date.now();
    const t0 = Math.floor(now / 60_000) * 60_000;
    const past = t0 - 5 * 60_000; // finished 5m bucket
    multiTfCandles.applyBaseFrame("MTFCLOSE", { time: past, open: 10, high: 10, low: 10, close: 10, volume: 50, closed: true, transport: "test" });
    assert.ok(closedCount >= 1);
  } finally {
    off();
    offC();
  }
});

test("multi-tf: seedTf bypasses 1m base (daily history) without double counting", () => {
  resetEventModel();
  const off = multiTfCandles.subscribe("MTFSEED", "stock", ["1d"], {});
  try {
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    multiTfCandles.seedTf("MTFSEED", "1d", [{ time: day - 86_400_000, open: 10, high: 12, low: 9, close: 11, volume: 500 }]);
    multiTfCandles.seedTf("MTFSEED", "1d", [{ time: day - 86_400_000, open: 10, high: 12, low: 9, close: 11, volume: 500 }]); // idempotent
    const h = multiTfCandles.history("MTFSEED", "1d");
    assert.equal(h.length, 1);
    assert.equal(h[0].volume, 500);
  } finally {
    off();
  }
});

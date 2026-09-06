/**
 * PERFORMANCE ENGINE — 1D/1W/1M/1Q/1Y từ nến daily thật.
 * Mốc theo lịch (không nội suy); chuỗi thiếu → null cho mốc đó.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeDailyPerformance, PERFORMANCE_WINDOWS } from "../performance";
import type { ChartCandle } from "../chart-const";

const DAY = 86_400_000;
const base = Date.parse("2026-09-04T00:00:00Z");
const close = (offsetDays: number, price: number): ChartCandle => ({
  time: base - offsetDays * DAY,
  open: price,
  high: price,
  low: price,
  close: price,
  volume: 100,
});

test("performance: 400 ngày dữ liệu → đủ 5 mốc, % đúng theo mốc lịch", () => {
  const candles: ChartCandle[] = [];
  for (let i = 400; i >= 0; i--) candles.push(close(i, 100 + i)); // tăng dần theo thời gian
  const p = computeDailyPerformance(candles)!;
  const last = 100;
  const pivot = (days: number) => {
    // nến time = base - days*DAY chính là mốc cắt (nếu tồn tại)
    const p = candles.find((c) => c.time === base - days * DAY);
    return p ? p.close : null;
  };
  assert.ok(p);
  for (const w of PERFORMANCE_WINDOWS) {
    const pv = pivot(w.days);
    if (pv != null) {
      const expect = (last / pv - 1) * 100;
      assert.ok(Math.abs(p[w.key]! - expect) < 1e-9, `${w.key}: ${p[w.key]} vs ${expect}`);
    } else {
      assert.equal(p[w.key], null, `${w.key} thiếu pivot → null`);
    }
  }
  assert.equal(p.bars, 401);
  assert.equal(p.asOf, base);
});

test("performance: 40 nến (~40 ngày) → đủ 1D/1W/1M, 1Q/1Y = null", () => {
  const candles: ChartCandle[] = [];
  for (let i = 40; i >= 0; i--) candles.push(close(i, 100 + i));
  const p = computeDailyPerformance(candles)!;
  assert.ok(p.d1 != null);
  assert.ok(p.w1 != null);
  assert.ok(p.m1 != null, "30 ngày có pivot");
  assert.equal(p.q1, null, "90 ngày thiếu pivot → null");
  assert.equal(p.y1, null);
});

test("performance: rỗng / 1 nến → null (không hiển thị số giả)", () => {
  assert.equal(computeDailyPerformance([]), null);
  assert.equal(computeDailyPerformance([close(0, 100)]), null);
});

test("performance: nến rác (close<=0) vẫn không crash; nến bị sắp xếp lộn xộn được sort", () => {
  const candles = [close(0, 90), close(2, 100), close(1, 95), close(3, 110)];
  const p = computeDailyPerformance(candles)!;
  assert.ok(p.d1 != null);
  assert.equal(p.asOf, base, "gốc = nến mới nhất sau sort");
});

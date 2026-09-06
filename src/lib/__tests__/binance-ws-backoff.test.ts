/**
 * CRYPTO REALTIME ENGINE — reconnect/backoff + event validation (Phase 6 §11).
 * `backoffBaseMs/reconnectDelayMs` là pure functions tách từ BinanceRealtimeEngine
 * (kline + spot/futures) — bảo đảm exponential backoff bị chặn (bounded),
 * không tự tăng vô hạn, không treo process (unref timer là của engine).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { backoffBaseMs, reconnectDelayMs } from "../realtime/binance-ws";

test("backoff: exponential 2s·2^n, cap 20s cho n≤4", () => {
  assert.equal(backoffBaseMs(1), 4000);
  assert.equal(backoffBaseMs(2), 8000);
  assert.equal(backoffBaseMs(3), 16000);
  assert.equal(backoffBaseMs(4), 20000); // min(32000, 20000)
});

test("backoff: plateau 60s sau lần thứ 4 (không tăng vô hạn)", () => {
  assert.equal(backoffBaseMs(5), 60_000);
  assert.equal(backoffBaseMs(9), 60_000);
  assert.equal(backoffBaseMs(100), 60_000);
});

test("backoff: kline cap 30s (khác spot 20s)", () => {
  assert.equal(backoffBaseMs(4, 30_000), 30_000);
  assert.ok(backoffBaseMs(2, 30_000) <= 30_000);
});

test("backoff: jitter injected → delay nằm trong [base, base+jitter]", () => {
  const base = backoffBaseMs(2);
  const d = reconnectDelayMs(2, 20_000, () => 999);
  assert.ok(d > base && d < base + 1000);
});

test("backoff: attempts ≤ 0 coi như 1 (không NaN/0)", () => {
  assert.equal(backoffBaseMs(0), backoffBaseMs(1));
  assert.ok(Number.isFinite(reconnectDelayMs(0)));
});

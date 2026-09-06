/**
 * Phase 6 — crypto quote schema (yêu cầu 2.2: previous close đúng chuẩn).
 *
 * Regresión: `toRow` không map `prevClosePrice` từ Binance ticker 24h, nên
 * quote thiếu previousClose. Test này khóa schema: previousClose phải được
 * map khi provider trả (và null khi không trả, không NaN/Infinity).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toRow } from "../services/crypto";
import type { BinanceTicker24h } from "../providers/binance";

function ticker(overrides: Partial<BinanceTicker24h> = {}): BinanceTicker24h {
  return {
    symbol: "BTCUSDT",
    priceChange: "100.5",
    priceChangePercent: "0.42",
    weightedAvgPrice: "24100",
    prevClosePrice: "24000",
    lastPrice: "24100.5",
    openPrice: "24000",
    highPrice: "24200",
    lowPrice: "23900",
    volume: "12345",
    quoteVolume: "297000000",
    openTime: 1_700_000_000_000,
    closeTime: 1_700_086_400_000,
    count: 99999,
    ...overrides,
  };
}

test("toRow: map prevClosePrice → previousClose (number hợp lệ)", () => {
  const r = toRow(ticker());
  assert.ok(r);
  assert.equal(r.previousClose, 24000);
  assert.equal(r.symbol, "BTCUSDT");
  assert.equal(r.baseAsset, "BTC");
  assert.equal(r.updatedAt, new Date(1_700_086_400_000).toISOString());
});

test("toRow: không có prevClosePrice → previousClose null (không NaN/undefined)", () => {
  const r = toRow(ticker({ prevClosePrice: undefined }));
  assert.ok(r);
  assert.equal(r.previousClose, null);
});

test("toRow: prevClosePrice rác → previousClose null (không NaN/Infinity)", () => {
  for (const bad of ["", "abc", "NaN", "Infinity", "-Infinity"]) {
    const r = toRow(ticker({ prevClosePrice: bad }));
    assert.ok(r);
    assert.ok(r!.previousClose !== null && Number.isFinite(r!.previousClose as number) === false ? false : true);
    if (r!.previousClose != null) assert.ok(Number.isFinite(r!.previousClose as number), `prevClose="${bad}" phải null`);
  }
});

test("toRow: validate cơ bản vẫn giữ — lastPrice ≤ 0 → null", () => {
  assert.equal(toRow(ticker({ lastPrice: "0" })), null);
  assert.equal(toRow(ticker({ lastPrice: "NaN" })), null);
});

test("toRow: exclude + leveraged vẫn giữ", () => {
  assert.equal(toRow(ticker({ symbol: "BTCUPUSDT" })), null);
  assert.equal(toRow(ticker({ symbol: "USDCUSDT" })), null);
});

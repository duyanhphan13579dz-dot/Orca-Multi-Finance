/**
 * MÁY TÍNH QUY ĐỔI TIỀN TỆ (commodities) — toán thuần + lấy tỷ giá thật.
 * Không hard-code tỷ giá; stub chỉ mô phỏng ER-API + VietnamBiz rates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertAmount, convertPrice, CONVERTIBLE_CURRENCIES } from "../services/currency";

test("convertAmount: đúng quy đổi qua gốc USD (1 USD = 26,255 VND = 7.2 CNY)", () => {
  const rates = { USD: 1, VND: 26_255, CNY: 7.2, JPY: 148, MYR: 4.4, EUR: 0.92, GBP: 0.79 } as Record<(typeof CONVERTIBLE_CURRENCIES)[number], number>;
  assert.equal(convertAmount(100, "USD", "VND", rates), 2_625_500);
  assert.equal(convertAmount(100, "USD", "CNY", rates), 720);
  assert.ok(Math.abs(convertAmount(26_255, "VND", "CNY", rates)! - 7.2) < 1e-9);
  assert.ok(Math.abs(convertAmount(7.2, "CNY", "VND", rates)! - 26_255) < 1e-6);
  // USD là gốc: từ → đến không đổi
  assert.equal(convertAmount(50, "USD", "USD", rates), 50);
});

test("convertAmount: từ chối số không hợp lệ / thiếu rate — không đoán", () => {
  const rates = { USD: 1, VND: 26_255, CNY: 7.2, JPY: 148, MYR: 4.4, EUR: 0.92, GBP: 0.79 } as Record<(typeof CONVERTIBLE_CURRENCIES)[number], number>;
  assert.equal(convertAmount(-1, "USD", "VND", rates), null);
  assert.equal(convertAmount(Number.NaN, "USD", "VND", rates), null);
  const broken = { ...rates, CNY: 0 } as typeof rates;
  assert.equal(convertAmount(100, "USD", "CNY", broken), null);
  const missing = { ...rates } as Partial<typeof rates>;
  delete missing.JPY;
  assert.equal(convertAmount(100, "USD", "JPY", missing as typeof rates), null);
});

test("convertPrice: commodity price theo currency row → display currency; currency lạ → null", () => {
  const rates = { USD: 1, VND: 26_255, CNY: 7.2, JPY: 148, MYR: 4.4, EUR: 0.92, GBP: 0.79 } as Record<(typeof CONVERTIBLE_CURRENCIES)[number], number>;
  // vàng 4,442.4 USD/ounce → VND
  assert.ok(Math.abs(convertPrice(4_442.4, "USD", "VND", rates)! - 4_442.4 * 26_255) < 0.01);
  // nhôm 24,373 CNY/tấn → VND
  assert.ok(Math.abs(convertPrice(24_373, "CNY", "VND", rates)! - (24_373 / 7.2) * 26_255) < 0.01);
  // heo 57,833 VND/kg → USD (giá rất nhỏ, vẫn tính được)
  assert.ok(Math.abs(convertPrice(57_833, "VND", "USD", rates)! - 57_833 / 26_255) < 1e-9);
  // đồng tiền không hỗ trợ → không đoán
  assert.equal(convertPrice(100, "XXX", "USD", rates), null);
  assert.equal(convertPrice(100, "", "USD", rates), null);
});

test("CONVERTIBLE_CURRENCIES: đủ 7 loại tiền của catalog /goods (VND USD CNY JPY MYR EUR GBP)", () => {
  assert.deepEqual([...CONVERTIBLE_CURRENCIES], ["VND", "USD", "CNY", "JPY", "MYR", "EUR", "GBP"]);
});

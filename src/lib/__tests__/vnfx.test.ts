/**
 * VIETNAM FX MODEL — parse Vietcombank payload thật (fixture 2026-09-04),
 * merge với VietnamBiz /currency-interest-rate (WiFeed); mức nguồn không công
 * bố → null (KHÔNG suy diễn); giá hiển thị = sell → transfer → reference.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseVcbPayload, type VcbFxResult } from "../providers/vietcombank";
import { buildVnFxModel, parseVnbPeriod } from "../services/vnfx";
import type { VnbRateRow } from "../providers/vietnambiz-data";

const VCB = {
  Count: 20,
  Date: "2026-09-04T00:00:00",
  UpdatedDate: "2026-09-04T23:00:00+07:00",
  Data: [
    { currencyName: "US DOLLAR", currencyCode: "USD", cash: "25845.00", transfer: "25875.00", sell: "26255.00" },
    { currencyName: "EURO", currencyCode: "EUR", cash: "29514.76", transfer: "29812.89", sell: "31071.21" },
    { currencyName: "JAPANESE YEN", currencyCode: "JPY", cash: "160.90", transfer: "162.53", sell: "172.01" },
    { currencyName: "THAI BAHT", currencyCode: "THB", cash: "698.51", transfer: "776.12", sell: "809.04" },
  ],
};

const VNB: VnbRateRow[] = [
  { indicator: "Tỷ giá trung tâm", period: "Ngày 04/09/2026", current: 25605, currentRaw: "25,605", previous: 25615, previousRaw: "25,615" },
  { indicator: "Tỷ giá USD NHTM bán ra", period: "Ngày 04/09/2026", current: 26255, currentRaw: "26,255", previous: 26260, previousRaw: "26,260" },
  { indicator: "Tỷ giá USD tự do bán ra", period: "Ngày 04/09/2026", current: 25810, currentRaw: "25,810", previous: 25870, previousRaw: "25,870" },
];

test("parseVcbPayload: đúng 4 mức USD + updatedAt +15:00 UTC", () => {
  const r = parseVcbPayload(VCB);
  const usd = r.currencies.get("USD");
  assert.ok(usd);
  assert.equal(usd.cash, 25845);
  assert.equal(usd.transfer, 25875);
  assert.equal(usd.sell, 26255);
  assert.equal(r.date, "2026-09-04");
  assert.equal(r.updatedAt, Date.parse("2026-09-04T23:00:00+07:00"));
});

test("buildVnFxModel: merge VCB + VNB → đủ reference/buyCash/buyTransfer/sell/freeSell", () => {
  const m = buildVnFxModel(parseVcbPayload(VCB), VNB);
  assert.equal(m.reference?.rate, 25605);
  assert.equal(m.buyCash?.rate, 25845);
  assert.equal(m.buyTransfer?.rate, 25875);
  assert.equal(m.sell?.rate, 26255, "sell ưu tiên VCB");
  assert.equal(m.freeSell?.rate, 25810);
  assert.equal(m.rate, 26255);
  assert.match(m.source, /Vietcombank/);
  assert.match(m.source, /VietnamBiz/);
});

test("buildVnFxModel: VCB lỗi → sell từ VietnamBiz NHTM bán; buyCash/transfer null (không đoán)", () => {
  const m = buildVnFxModel(null, VNB);
  assert.equal(m.sell?.rate, 26255);
  assert.equal(m.buyCash, null);
  assert.equal(m.buyTransfer, null);
  assert.equal(m.reference?.rate, 25605);
  assert.equal(m.rate, 26255);
  assert.match(m.note, /Vietcombank API chưa khả dụng/);
});

test("buildVnFxModel: cả hai nguồn lỗi → mọi mức null, rate null", () => {
  const m = buildVnFxModel(null, []);
  assert.equal(m.rate, null);
  assert.equal(m.reference, null);
  assert.equal(m.sell, null);
  assert.equal(m.source, "unavailable");
});

test("parseVnbPeriod: 'Ngày 04/09/2026' → epoch 2026-09-04T00:00:00Z; chuỗi lạ → null", () => {
  assert.equal(parseVnbPeriod("Ngày 04/09/2026"), Date.parse("2026-09-04T00:00:00Z"));
  assert.equal(parseVnbPeriod("Tháng 05/2026"), null);
  assert.equal(parseVnbPeriod(null), null);
});

test("buildVnFxModel: cuối tuần (date Chủ nhật) vẫn giữ phiên gần nhất — không phải provider error", () => {
  const sunday = parseVcbPayload({ ...VCB, Date: "2026-09-06T00:00:00", UpdatedDate: "2026-09-05T23:00:00+07:00" });
  const m = buildVnFxModel(sunday, VNB);
  assert.equal(m.sell?.rate, 26255);
  assert.equal(m.updatedAt, Date.parse("2026-09-05T23:00:00+07:00"));
});

test("parseVcbPayload: cash 0.00 (ngân hàng không công bố) → null, không hiển thị 0", () => {
  const r = parseVcbPayload({ Data: [{ currencyCode: "DKK", cash: "0.00", transfer: "3978.43", sell: "4130.61" }] }) as VcbFxResult;
  const dkk = r.currencies.get("DKK");
  assert.ok(dkk);
  assert.equal(dkk.cash, null);
  assert.equal(dkk.transfer, 3978.43);
});

/**
 * COMMODITY CATALOG — nguồn DUY NHẤT VietnamBiz Data (data.vietnambiz.vn/goods).
 * Bỏ Simplize: không còn simplizePath, không còn Yahoo/MSN/Binance quote.
 * Universe = 66 dòng bảng /goods (mỗi dòng 1 key), unit/currency lấy nguyên văn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { COMMODITY_CATALOG, defByKeyOrSymbol, currencyForUnit, parseDecimal } from "../providers/commodities";

test("universe: đúng 66 mục — mỗi dòng bảng WiFeed là 1 commodity", () => {
  assert.equal(COMMODITY_CATALOG.length, 66);
  const keys = COMMODITY_CATALOG.map((c) => c.key);
  assert.equal(new Set(keys).size, 66, "key duy nhất");
  const symbols = COMMODITY_CATALOG.map((c) => c.symbol);
  assert.equal(new Set(symbols).size, 66, "symbol duy nhất");
});

test("universe: KHÔNG còn simplizePath / vietnambiz bài ngày / binanceSymbol / yahooSymbol (nguồn DUY NHẤT WiFeed)", () => {
  for (const c of COMMODITY_CATALOG) {
    assert.equal("simplizePath" in c, false, `${c.key}: remove simplizePath`);
    assert.equal("vietnambiz" in c, false, `${c.key}: remove article fallback`);
    assert.equal("binanceSymbol" in c, false, `${c.key}: remove PAXG quote`);
    assert.equal("yahooSymbol" in c, false, `${c.key}: remove Yahoo — kể cả chart`);
    assert.equal("centsQuoted" in c, false, `${c.key}: no USd futures unit`);
  }
});

test("universe: các nhóm /goods đều có mặt (6 nhóm, đúng số lượng)", () => {
  const byGroup = new Map<string, number>();
  for (const c of COMMODITY_CATALOG) byGroup.set(c.group, (byGroup.get(c.group) ?? 0) + 1);
  assert.equal(byGroup.get("consumer"), 15);
  assert.equal(byGroup.get("metals"), 10);
  assert.equal(byGroup.get("chemicals"), 7);
  assert.equal(byGroup.get("construction"), 20);
  assert.equal(byGroup.get("energy"), 10);
  assert.equal(byGroup.get("plastics"), 4);
});

test("universe: những mục cửa hàng trước đây thiếu nguồn giờ CÓ (nhôm/kẽm) + unit/currency đúng", () => {
  const al = defByKeyOrSymbol("AL");
  assert.ok(al);
  assert.equal(al.key, "aluminum");
  assert.equal(al.unit, "CNY/tấn");
  assert.equal(al.currency, "CNY");
  assert.equal(al.market, "INTL");
  const zn = defByKeyOrSymbol("zinc");
  assert.equal(zn?.unit, "CNY/tấn");
  const sjc = defByKeyOrSymbol("SJC");
  assert.equal(sjc?.nameVi, "Giá vàng trong nước");
  assert.equal(sjc?.market, "VN");
  assert.equal(sjc?.valueScale, 1000, "SJC: nghìn đồng/lượng → VNĐ");
});

test("universe: mọi mục có market/unit/currency + đơn vị VNĐ ↔ market VN", () => {
  for (const c of COMMODITY_CATALOG) {
    assert.ok(c.market === "VN" || c.market === "INTL", c.key);
    assert.ok(c.unit.length > 0, c.key);
    assert.ok(c.currency.length > 0, c.key);
    if (c.market === "VN") assert.equal(c.currency, "VND", `${c.key}: VN market phải là VND`);
    // charset: nếu unit có của tiền nước ngoài → INTL
    if (/CNY|USD|MYR|YÊN|JPY/.test(c.unit.toUpperCase())) assert.equal(c.market, "INTL", `${c.key}: ${c.unit}`);
  }
});

test("defByKeyOrSymbol: key + symbol đều tra được (không phân biệt hoa thường)", () => {
  assert.equal(defByKeyOrSymbol("wti")?.key, "wti");
  assert.equal(defByKeyOrSymbol("WTI")?.key, "wti");
  assert.equal(defByKeyOrSymbol("GOLD")?.key, "gold");
  assert.equal(defByKeyOrSymbol("DO")?.key, "diesel");
  assert.equal(defByKeyOrSymbol("nope"), null);
});

test("universe: không còn bất kỳ ticker nguồn ngoài nào (GC=F/CL=F/NG=F/HG=F/SI=F…) trong catalog", () => {
  for (const c of COMMODITY_CATALOG) {
    assert.ok(!/=F$/.test(c.symbol), `${c.key}: ${c.symbol} là ticker futures ngoài — phải là mã nội bộ kiểu /goods`);
  }
});

test("currencyForUnit: WiFeed units (kể cả Nghìn/lít, Yên/tấn, MYR)", () => {
  assert.equal(currencyForUnit("Đồng/kg"), "VND");
  assert.equal(currencyForUnit("Đồng/lượng"), "VND");
  assert.equal(currencyForUnit("Nghìn/lít"), "VND");
  assert.equal(currencyForUnit("CNY/tấn"), "CNY");
  assert.equal(currencyForUnit("MYR/tấn"), "MYR");
  assert.equal(currencyForUnit("Yên/tấn"), "JPY");
  assert.equal(currencyForUnit("USD/oz"), "USD");
  assert.equal(currencyForUnit("USD/tấn"), "USD");
});

test("parseDecimal: thousands comma + whitespace handled, garbage → NaN", () => {
  assert.equal(parseDecimal("1,226"), 1226);
  assert.equal(parseDecimal("15.87"), 15.87);
  assert.equal(parseDecimal("9.450"), 9.45);
  assert.equal(parseDecimal("+ 0.18"), 0.18);
  assert.equal(parseDecimal("- 0.00"), -0.0);
  assert.ok(Number.isNaN(parseDecimal("abc")));
});

test("vnImpact: chỉ các mục đã map vnImpact giữ nguyên; mục mới vnImpact undefined (không bịa)", () => {
  assert.ok(COMMODITY_CATALOG.find((c) => c.key === "pig-vn")?.vnImpact);
  assert.ok(COMMODITY_CATALOG.find((c) => c.key === "wti")?.vnImpact);
  assert.equal(COMMODITY_CATALOG.find((c) => c.key === "pepper")?.vnImpact, undefined);
  assert.equal(COMMODITY_CATALOG.find((c) => c.key === "pvc")?.vnImpact, undefined);
});

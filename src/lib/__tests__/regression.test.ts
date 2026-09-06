/**
 * REGRESSION TESTS — guards for data-quality fixes (2026-09):
 *  - valuation: EV = market cap + net debt (cash subtracted) — no more `* 0`
 *  - fundamental: TTM never sums a duplicate period; annual rows are not summed
 *  - Vietnam Security Master: unique symbols, corrected entries stay correct
 *  - news tagging: long tickers (ETFs) are tagged, tokens are word-bound
 * Run: node --import tsx --import ./test/test-setup/register-stub.mjs --test src/lib/__tests__/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { computeValuation, type ValuationResult } from "../engines/valuation";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { VN_SECURITIES } from "../vn/master";
import { VN_TICKERS, tag } from "../providers/news";

/* ------------------------------ valuation --------------------------------- */

function healthWith(anchors: Partial<FinancialHealthResult["anchors"]>): FinancialHealthResult {
  return {
    groups: { profitability: {}, liquidity: {}, leverage: {}, cashflow: {}, efficiency: {} },
    scores: { profitability: null, liquidity: null, leverage: null, cashflow: null, efficiency: null, overall: null },
    coverage: 0,
    warnings: [],
    anchors: {
      revenue: null,
      netProfit: null,
      equity: null,
      totalDebt: null,
      cash: null,
      ocfTtm: null,
      fcfTtm: null,
      shares: null,
      epsTtm: null,
      ebitdaTtm: null,
      ...anchors,
    },
  };
}

test("valuation: EV = market cap + total debt − cash (net debt)", () => {
  const v: ValuationResult = computeValuation({
    price: 10,
    health: healthWith({ shares: 100, totalDebt: 50, cash: 20, ebitdaTtm: 10, revenue: 100, epsTtm: 1 }),
  });
  assert.equal(v.marketCap, 1000);
  assert.equal(v.enterpriseValue, 1030); // 1000 + 50 - 20
  assert.equal(v.multiples.evEbitda, 103);
  assert.equal(v.multiples.evSales, 10.3);
});

test("valuation: cash missing → EV keeps full debt (explicit note, no crash)", () => {
  const v: ValuationResult = computeValuation({
    price: 10,
    health: healthWith({ shares: 100, totalDebt: 50, ebitdaTtm: 10 }),
  });
  assert.equal(v.enterpriseValue, 1050);
  assert.ok(v.notes.some((n) => n.includes("tiền mặt")));
});

/* ------------------------------ fundamental ------------------------------- */

function incomeRows(): Record<string, unknown>[] {
  // Q1 2025 duplicated + Q2/Q3/Q4: TTM must sum 4 DISTINCT quarters
  return [
    { year: 2025, quarter: 1, revenue: 1000 }, // dup
    { year: 2025, quarter: 1, revenue: 1000 }, // dup
    { year: 2025, quarter: 2, revenue: 1100 },
    { year: 2025, quarter: 3, revenue: 1200 },
    { year: 2025, quarter: 4, revenue: 1300 },
  ];
}

test("fundamental: TTM dedupes identical period rows", () => {
  const h = computeFinancialHealth({ income: incomeRows(), balance: [], cashflow: [] });
  assert.equal(h.anchors.revenue, 1000 + 1100 + 1200 + 1300); // 4600, not 5600
});

test("fundamental: annual statements are not summed into TTM", () => {
  const h = computeFinancialHealth({
    income: [
      { year: 2024, quarter: 0, revenue: 1000 },
      { year: 2025, quarter: 0, revenue: 1500 },
    ],
    balance: [],
    cashflow: [],
  });
  assert.equal(h.anchors.revenue, 1500); // latest annual, not 2500
});

test("fundamental: estimated EBITDA is transparently flagged", () => {
  const h = computeFinancialHealth({
    income: [{ year: 2025, quarter: 4, revenue: 1000, ebit: 100 }],
    balance: [],
    cashflow: [],
  });
  assert.ok(Math.abs((h.anchors.ebitdaTtm ?? 0) - 115) < 1e-9);
  assert.ok(h.warnings.some((w) => w.includes("EBITDA")));
});

/* ---------------------------- security master ----------------------------- */

test("master: VN_SECURITIES symbols are unique", () => {
  const symbols = VN_SECURITIES.map((s) => s.symbol);
  assert.equal(new Set(symbols).size, symbols.length);
});

test("master: corrected entries stay corrected", () => {
  const bySym = new Map(VN_SECURITIES.map((s) => [s.symbol, s]));
  assert.ok(bySym.get("CTS")?.name.includes("VietinBank"));
  assert.ok(bySym.get("TCX")?.name.includes("Kỹ Thương"));
  const ht1 = bySym.get("HT1");
  assert.ok(ht1 && ht1.name.includes("Xi măng Vicem Hà Tiên 1") && ht1.exchange === "HOSE");
  assert.ok(bySym.get("SCR")?.name.includes("TTC Land"));
  assert.equal(bySym.get("MAS")?.exchange, "HNX");
  assert.equal(bySym.get("CSV")?.name, "CTCP Hóa chất Cơ bản Miền Nam");
  assert.equal(bySym.get("BTS")?.sector, "Cao su");
  assert.equal(bySym.get("CCM")?.name, "CTCP Khoáng sản và Xi măng Cần Thơ");
  assert.equal(bySym.get("PXS")?.name, "CTCP Kết cấu Kim loại và Lắp máy Dầu khí (PVC-MS)");
  assert.ok(bySym.get("VBB")?.name.includes("Vietbank"));
  assert.equal(bySym.get("LDG")?.name, "CTCP Đầu tư LDG (LDG Investment)");
  assert.ok(bySym.get("PVB")?.name.includes("Bọc ống Dầu khí"));
  assert.equal(bySym.get("PVC")?.exchange, "HNX");
  assert.equal(bySym.get("TCO")?.name, "CTCP Janus Group (Duyên Hải)");
  assert.equal(bySym.get("TAL")?.name, "CTCP Đầu tư Bất động sản Taseco (Taseco Land)");
  assert.ok(bySym.get("AST")?.name.includes("Taseco Airs"));
  assert.equal(bySym.get("PET")?.name, "Tổng CTCP Dịch vụ Tổng hợp Dầu khí (Petrosetco)");
  assert.ok(bySym.get("MCH")?.name.includes("Hàng tiêu dùng Masan"));
  assert.ok(bySym.get("FCN")?.name.includes("FECON"));
});

/* ------------------------------ news tagging ------------------------------ */

test("news: long ETF tickers are tagged, duplicates removed", () => {
  assert.equal(new Set(VN_TICKERS).size, VN_TICKERS.length); // no repeated codes
  const r = tag("FUEVFVND tăng mạnh sau thông tin cơ cấu danh mục");
  assert.ok(r.symbols.includes("FUEVFVND"));
});

test("news: ticker match is word-bound (no substring matches)", () => {
  const r = tag("VCB tăng; tỷ giá USD/VND điều chỉnh; BBBB xếp hạng");
  assert.ok(r.symbols.includes("VCB"));
  assert.ok(r.symbols.includes("VND")); // standalone VN-Direct ticker
  assert.ok(!r.symbols.includes("BBB")); // inside BBBB → must NOT match
});

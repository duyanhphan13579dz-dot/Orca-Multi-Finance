import test from "node:test";
import assert from "node:assert/strict";
import { computeRatioRows } from "../engines/vn-ratio-engine";

/* pivot rows giống hệt output normalizeStatementHits + pivotStatement */
const income = [
  {
    period: "2026-06-30", year: 2026, quarter: 2, reportType: "QUARTER",
    "Doanh thu thuần về bán hàng và cung cấp dịch vụ": 1000, revenue: 1000,
    "Lợi nhuận gộp về bán hàng và cung cấp dịch vụ": 400, grossProfit: 400,
    "Lợi nhuận thuần từ hoạt động kinh doanh": 200, ebit: 200,
    "Lợi nhuận sau thuế thu nhập doanh nghiệp": 150, netProfit: 150,
    "Lợi nhuận cơ bản trên cổ phiếu": 3, eps: 3,
    EBITDA: 250, ebitda: 250,
    "Chi phí lãi vay": 25, interestExpense: 25,
  },
];
const balance = [
  {
    period: "2026-06-30", year: 2026, quarter: 2, reportType: "QUARTER",
    "Tổng cộng tài sản": 2000, totalAssets: 2000,
    "Tài sản ngắn hạn": 800, currentAssets: 800,
    "Nợ phải trả": 1000, totalLiabilities: 1000,
    "Nợ ngắn hạn": 500, currentLiabilities: 500,
    "Vốn chủ sở hữu": 1000, equity: 1000,
    "Tiền và các khoản tương đương tiền": 300, cash: 300,
    "Hàng tồn kho": 200, inventory: 200,
    "Số lượng cổ phiếu lưu hành": 50, shares: 50,
    "Vay và nợ ngắn hạn": 100, shortDebt: 100,
    "Vay và nợ dài hạn": 200, longDebt: 200,
    "Giá trị sổ sách trên mỗi cổ phiếu": 20, bvps: 20,
  },
];
const cashflow = [
  {
    period: "2026-06-30", year: 2026, quarter: 2, reportType: "QUARTER",
    "Lưu chuyển tiền thuần từ hoạt động kinh doanh": 120, ocf: 120,
    "Mua sắm, xây dựng tài sản cố định": 20, capex: 20,
  },
];

test("ratio engine: tính đủ standard set từ statements VNDirect", () => {
  const rows = computeRatioRows(income, balance, cashflow, { price: 60 });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.period, "2026-06-30");
  assert.equal(r["P/E"], 20); // 60 / 3
  assert.equal(r["P/B"], 3); // 60 / 20
  assert.equal(r["ROE (%)"], 15); // 150/1000
  assert.equal(r["ROA (%)"], 7.5); // 150/2000
  assert.equal(r["Gross Margin (%)"], 40);
  assert.equal(r["Operating Margin (%)"], 20);
  assert.equal(r["Net Margin (%)"], 15);
  assert.equal(r["Debt/Equity (x)"], 0.3); // (100+200)/1000
  assert.equal(r["Current Ratio (x)"], 1.6);
  assert.equal(r["Quick Ratio (x)"], 1.2); // (800-200)/500
  assert.equal(r.EPS, 3);
  assert.equal(r.BVPS, 20);
  assert.equal(r["EBITDA/Assets (x)"], 0.125);
  assert.equal(r["EBITDA/Interest (x)"], 10);
  assert.equal(r["FCF/EBIT (x)"], 0.5); // (120-20)/200
  assert.equal(r.sourceHint, "CALCULATED");
});

test("ratio engine: thiếu dữ liệu → null (không suy diễn)", () => {
  const rows = computeRatioRows([{ period: "2026-03-31", year: 2026, quarter: 1, revenue: 100 }], [], [], { price: 10 });
  const r = rows[0];
  assert.equal(r["P/E"], null);
  assert.equal(r["ROE (%)"], null);
  assert.equal(r["Debt/Equity (x)"], null);
});

test("ratio engine: P/E âm/không dương → null (tránh hiểu sai)", () => {
  const neg = [{ period: "2026-06-30", year: 2026, quarter: 2, netProfit: -10, equity: 100, shares: 10, eps: -1 }];
  const rows = computeRatioRows(neg, [], [], { price: 50 });
  assert.equal(rows[0]["P/E"], null);
});

test("ratio engine: provider VNDirect ratios merge theo kỳ + sourceHint", () => {
  const rows = computeRatioRows(income, balance, cashflow, {
    price: 60,
    providerRatioRows: [{ period: "2026-06-30", "P/E": 22.1, "ROE": 16, "ExtraRatio": 7 }],
  });
  const r = rows[0];
  assert.equal(r.sourceHint, "VNDIRECT_RATIOS");
  assert.equal(r["P/E"], 20); // deterministic thắng (chuẩn)
  assert.equal(r.ExtraRatio, 7); // passthrough provider item
});

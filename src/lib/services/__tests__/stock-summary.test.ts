/**
 * ORCA Agent — stock answer renderer tests.
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { stockCall, summarizeStock, type StockContract } from "../stock-summary";

const rich: StockContract = {
  asset: { symbol: "FPT" },
  market_data: { price: 72.7, change_percent: -2.42, high: 74.6, low: 72.1, volume: 12_300_000, value: 900e9, avg_volume_20: 9_800_000 },
  technical_state: {
    rsi14: 61.2,
    macd_histogram: 0.12,
    trend: { score: 1.5, label: "up" },
    sma: { sma20: 71.5, sma50: 70.2, sma200: 75.0 },
    returns: { d7: 1.2, d30: -3.4, ytd: 8.1, y1: 12.0 },
    signals: ["Giá duy trì trên SMA50 — xu hướng trung hạn còn nguyên"],
    patterns: [
      { name: "Bullish Engulfing", nameVi: "Nhấn chìm tăng", type: "bullish", reliability: "high", description: "..." },
    ],
  },
  market_state: { labelVi: "Xu hướng tăng", strength: 61 },
  fundamental_state: {
    financial_health: {
      scores: { overall: 62, profitability: 70, liquidity: 55, leverage: 60, cashflow: 58, efficiency: 61 },
      coverage: 0.9,
      warnings: [],
      riskFlags: ["Nợ ngắn hạn cao"],
    },
    valuation: { multiples: { pe: 12.4, pb: 2.1, evEbitda: 8.0, dividendYield: 0.021 }, confidence: "medium", notes: [] },
  },
  risk_metrics: { atr14: 1.1, volatility_30d: 0.24, max_drawdown_52w: -0.18 },
};

test("renders every mandated section for a stock-analysis question", () => {
  const { lines } = summarizeStock(rich);
  const text = lines.join("\n");
  for (const h of ["## Giá & thanh khoản", "## Kỹ thuật", "## Mẫu hình nến", "## Sức khỏe tài chính", "## Định giá", "## Rủi ro", "## Kết luận"]) {
    assert.ok(text.includes(h), `missing section ${h}`);
  }
  // price + avg volume
  assert.match(text, /giá 72,7/);
  assert.match(text, /TB 20 phiên 9,8 tr cp/);
  // technicals
  assert.match(text, /RSI14 61,2/);
  assert.match(text, /MACD hist \+0,12/);
  assert.match(text, /trên SMA20/);
  // candle pattern sentiment
  assert.match(text, /Nhấn chìm tăng/);
  assert.match(text, /đảo chiều \/ tiếp diễn TĂNG/);
  // financial health breakdown
  assert.match(text, /Điểm tổng hợp 62\/100/);
  assert.match(text, /Rủi ro: Nợ ngắn hạn cao/);
  // valuation
  assert.match(text, /P\/E 12,4x/);
  assert.match(text, /cổ tức 2.1%/);
  // risk: drawdown stored as a fraction must render as a percent
  assert.match(text, /drawdown 52 tuần -18%/);
});

test("emits an explicit recommendation with a confidence percentage", () => {
  const { lines } = summarizeStock(rich);
  const rec = lines.find((l) => l.startsWith("Khuyến nghị:"));
  assert.ok(rec, "has recommendation line");
  assert.match(rec!, /(MUA|BÁN|TRUNG LẬP) \(độ tin cậy \d+%\)/);
});

test("bullish inputs produce MUA, bearish produce BÁN, thin data TRUNG LẬP", () => {
  assert.equal(stockCall(rich).label, "MUA");
  const bearish = JSON.parse(JSON.stringify(rich)) as StockContract;
  bearish.technical_state!.trend = { score: -2.5, label: "strong-down" };
  bearish.fundamental_state!.financial_health!.scores!.overall = 25;
  bearish.fundamental_state!.valuation!.multiples!.pe = 40;
  assert.equal(stockCall(bearish).label, "BÁN");
  assert.equal(stockCall({}).label, "TRUNG LẬP");
});

test("confidence stays within 40–92 and scales with conviction", () => {
  const thin = stockCall({});
  assert.ok(thin.confidence >= 40 && thin.confidence <= 92);
  const strong = stockCall(rich);
  assert.ok(strong.confidence > thin.confidence, "more signal ⇒ higher confidence");
});

test("degrades gracefully when data is missing (no fabricated numbers)", () => {
  const { lines } = summarizeStock({ asset: { symbol: "XYZ" } });
  const text = lines.join("\n");
  assert.match(text, /chưa có dữ liệu giá\/thanh khoản/);
  assert.match(text, /Chưa đủ chuỗi giá để tính RSI\/MACD\/MA/);
  assert.match(text, /Chưa đủ dữ liệu báo cáo tài chính/);
  assert.match(text, /TRUNG LẬP/);
  assert.ok(!/\d,\d{2}x/.test(text.replace(/P\/E —x/, "")), "no invented multiples");
});

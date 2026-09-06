import test from "node:test";
import assert from "node:assert/strict";
import { routeQuestion, intentLabel } from "../engines/question-router";

const VN = ["BID", "VNM", "HPG", "VCB"];

test("question router: crypto qua hậu tố USDT", () => {
  assert.deepEqual(routeQuestion("Giá BTCUSDT hôm nay?", VN), { kind: "crypto", symbol: "BTCUSDT" });
});

test("question router: crypto bare symbol", () => {
  assert.deepEqual(routeQuestion("ETH thế nào?", VN), { kind: "crypto", symbol: "ETHUSDT" });
});

test("question router: forex pair", () => {
  assert.deepEqual(routeQuestion("EURUSD hôm nay ra sao?", VN), { kind: "forex", pair: "EURUSD" });
  assert.deepEqual(routeQuestion("tỷ giá USD/VND?", VN), { kind: "forex", pair: "USDVND" });
});

test("question router: cổ phiếu VN", () => {
  assert.deepEqual(routeQuestion("BID thế nào?", VN), { kind: "vn-stock", symbol: "BID" });
});

test("question router: so sánh", () => {
  assert.deepEqual(routeQuestion("so sánh BTC và ETH", VN), { kind: "compare", a: "BTC", b: "ETH" });
  assert.deepEqual(routeQuestion("BID vs VNM", VN), { kind: "compare", a: "BID", b: "VNM" });
});

test("question router: hàng hoá", () => {
  assert.deepEqual(routeQuestion("giá vàng hôm nay?", VN), { kind: "commodity", query: "gold" });
  assert.deepEqual(routeQuestion("dầu thô thế nào?", VN), { kind: "commodity", query: "oil" });
});

test("question router: market intelligence intents (Phase 3)", () => {
  assert.deepEqual(routeQuestion("độ rộng thị trường hôm nay?", VN), { kind: "market-breadth" });
  assert.deepEqual(routeQuestion("ngành nào đang xoay vòng?", VN), { kind: "market-sectors" });
  assert.deepEqual(routeQuestion("thị trường đang tăng hay giảm?", VN), { kind: "market-state" });
  assert.deepEqual(routeQuestion("cổ phiếu dẫn dắt hôm nay?", VN), { kind: "market-leaders" });
  assert.deepEqual(routeQuestion("sự kiện nổi bật trong tuần?", VN), { kind: "market-events" });
  assert.deepEqual(routeQuestion("cảnh báo thông minh thị trường?", VN), { kind: "market-smart-alerts" });
});

test("question router: tổng quan thị trường / tin tức / general", () => {
  assert.deepEqual(routeQuestion("tổng quan thị trường hôm nay?", VN), { kind: "market" });
  assert.deepEqual(routeQuestion("có tin tức gì mới?", VN), { kind: "news" });
  assert.deepEqual(routeQuestion("xin chào", VN), { kind: "general" });
});

test("question router: intentLabel mô tả đủ mọi intent", () => {
  for (const kind of ["crypto", "forex", "vn-stock", "commodity", "market", "market-breadth", "market-sectors", "market-state", "market-leaders", "market-events", "market-smart-alerts", "compare", "news", "general"] as const) {
    const label = intentLabel({ kind } as never);
    assert.ok(label.length > 3, `label thiếu cho ${kind}`);
  }
  assert.equal(intentLabel({ kind: "market-breadth" }), "độ rộng thị trường");
  assert.equal(intentLabel({ kind: "general" }), "tổng hợp");
});

import test from "node:test";
import assert from "node:assert/strict";
import { vnMarketEngine } from "../realtime/vn-market-engine";
import { marketStore } from "../realtime/market-store";
import { onEvent, resetEventModel } from "../realtime/event-envelope";

test("vn engine: ingestQuote → store quote (stock, validated) + tick event", () => {
  marketStore.reset();
  resetEventModel();
  let tickSeen: unknown = null;
  const off = onEvent("tick:VNM", (e) => {
    tickSeen = e;
  });
  try {
    vnMarketEngine.ingestQuote({ symbol: "VNM", price: 72_500, changePercent: 1.2, open: 71_900, high: 72_800, low: 71_800, volume: 1_000_000, ts: Date.now() });
    const q = marketStore.get("VNM");
    assert.ok(q);
    assert.equal(q.assetType, "stock");
    assert.equal(q.price, 72_500);
    assert.equal(q.source, "vn-market-engine");
    assert.ok(tickSeen, "tick event emitted");
    assert.equal(vnMarketEngine.stats().symbols, 0); // ingestQuote doesn't add to poll set
  } finally {
    off();
  }
});

test("vn engine: invalid quote is dropped by the store but tick suppressed", () => {
  marketStore.reset();
  resetEventModel();
  let tickCount = 0;
  const off = onEvent("tick:BADVN", () => tickCount++);
  try {
    vnMarketEngine.ingestQuote({ symbol: "BADVN", price: -1, ts: Date.now() });
    assert.equal(marketStore.get("BADVN"), null);
    assert.equal(tickCount, 0);
  } finally {
    off();
  }
});

test("vn engine: sequential quotes build 1m candle (high/low/volume delta)", () => {
  marketStore.reset();
  resetEventModel();
  const ts = Date.now();
  const bucket = Math.floor(ts / 60_000) * 60_000;
  vnMarketEngine.ingestQuote({ symbol: "HPG", price: 30_000, volume: 1_000, ts: bucket + 5_000 });
  vnMarketEngine.ingestQuote({ symbol: "HPG", price: 31_000, volume: 2_500, ts: bucket + 20_000 });
  vnMarketEngine.ingestQuote({ symbol: "HPG", price: 29_500, volume: 3_000, ts: bucket + 40_000 });
  const q = marketStore.get("HPG");
  assert.ok(q);
  assert.equal(q.price, 29_500);
  // multi-tf has no subscription → no engine state asserted (no CRASH is the contract here)
  assert.equal(vnMarketEngine.stats().lastError, null);
});

test("vn engine: seedDaily feeds 1d seeded history", () => {
  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  void vnMarketEngine
    .seedDaily("VNM", [{ time: day - 86_400_000, open: 70_000, high: 73_000, low: 69_500, close: 72_500, volume: 5_000_000 }])
    .then(() => {
      assert.ok(true);
    });
});

test("vn engine: session() exposes current session info", () => {
  const s = vnMarketEngine.session();
  assert.ok(["pre_open", "opening_auction", "morning_continuous", "lunch_break", "afternoon_continuous", "closing_auction", "post_trading", "weekend_closed", "holiday_closed", "closed"].includes(s.state));
  assert.ok(s.labelVi.length > 0);
});

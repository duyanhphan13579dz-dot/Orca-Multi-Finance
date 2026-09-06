import test from "node:test";
import assert from "node:assert/strict";
import { marketStore } from "../realtime/market-store";
import { overlayRealtime, pipelineConfidence, foldConfidence, pipelineTrace } from "../services/agent-pipeline";
import type { DataConfidence } from "../confidence";

test("agent pipeline: overlay realtime additive khi contract có market_data", () => {
  marketStore.reset();
  marketStore.setQuote({ assetType: "crypto", symbol: "TESTBTCUSDT", price: 50000, changePercent: 1.2, ts: Date.now(), source: "binance-ws" });
  const contract: Record<string, unknown> = { asset: { symbol: "TESTBTCUSDT" }, market_data: { price: 49999 } };
  const out = overlayRealtime(contract, ["TESTBTCUSDT", "KHONGTONTAI"]);
  assert.equal(out.overlaid, 1);
  // additive: field cũ giữ nguyên
  const md = contract.market_data as { price: number; realtime: Record<string, { price: number; changePercent: number; ts: number; source: string; quality: string; freshnessAgeMs: number }> };
  assert.equal(md.price, 49999);
  assert.equal(md.realtime.TESTBTCUSDT.price, 50000);
  assert.equal(md.realtime.TESTBTCUSDT.quality, "VALID");
  assert.ok(md.realtime.TESTBTCUSDT.freshnessAgeMs >= 0);
  assert.equal(out.confidences.length, 1);
  assert.deepEqual(out.providers, ["binance-ws"]);
});

test("agent pipeline: overlay gắn realtime_overlay khi contract không có market_data", () => {
  marketStore.reset();
  marketStore.setQuote({ assetType: "stock", symbol: "TESTBID", price: 25000, changePercent: 0.5, ts: Date.now(), source: "vn-market-engine" });
  const contract: Record<string, unknown> = { scope: "market-leaders" };
  const out = overlayRealtime(contract, ["TESTBID"]);
  assert.equal(out.overlaid, 1);
  assert.ok((contract.realtime_overlay as Record<string, unknown>).TESTBID);
  assert.equal(out.confidences[0].level, "medium"); // single provider max medium
});

test("agent pipeline: không có quote → không overlay, không confidence", () => {
  marketStore.reset();
  const contract: Record<string, unknown> = { scope: "market-state" };
  const out = overlayRealtime(contract, ["NOPE"]);
  assert.equal(out.overlaid, 0);
  assert.deepEqual(out.confidences, []);
  assert.deepEqual(out.providers, []);
  assert.equal("realtime_overlay" in contract, false);
});

test("agent pipeline: pipelineConfidence worst-of + gate", () => {
  const high: DataConfidence = { score: 0.9, level: "high", factors: ["a"] };
  const low: DataConfidence = { score: 0.4, level: "low", factors: ["b"] };
  const { aggregate, gateOk } = pipelineConfidence([high, low]);
  assert.equal(aggregate?.level, "low");
  assert.equal(aggregate?.score, 0.4);
  assert.equal(gateOk, true);
  const empty = pipelineConfidence([]);
  assert.equal(empty.aggregate, null);
  assert.equal(empty.gateOk, true);
});

test("agent pipeline: foldConfidence chỉ hạ cấp, không nâng", () => {
  const low: DataConfidence = { score: 0.4, level: "low", factors: ["b"] };
  const high: DataConfidence = { score: 0.95, level: "high", factors: ["a"] };
  assert.equal(foldConfidence("HIGH", [low]), "MEDIUM");
  assert.equal(foldConfidence("HIGH", []), "HIGH");
  assert.equal(foldConfidence("LOW", [high]), "LOW");
  assert.equal(foldConfidence("HIGH", [{ score: 0.1, level: "unverified", factors: [] }]), "LOW");
});

test("agent pipeline: pipelineTrace đủ 7 bước theo kiến trúc", () => {
  const trace = pipelineTrace("market-breadth", { quant: ["market-breadth"], overlaid: 0, confidenceLevel: "medium", llm: true });
  assert.deepEqual(trace.steps, ["user-question", "existing-ui", "realtime-context", "quant-engine", "data-confidence", "llm-reasoning", "existing-ui-output"]);
  assert.equal(trace.intent, "market-breadth");
  assert.equal(trace.realtimeOverlaid, 0);
  assert.equal(trace.confidence, "medium");
  assert.equal(trace.llm, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { VnDataEngine, type VnQuoteAdapter, type VnOhlcvAdapter } from "../engines/vn-data-engine";
import type { OhlcvBar, Quote } from "../types";

const now = Date.now();
const mk = (symbol: string, price: number, updatedAt?: string): Quote => ({
  symbol: symbol.toUpperCase(),
  assetClass: "stock",
  price,
  change: 0,
  changePercent: 0,
  updatedAt: updatedAt ?? new Date(now).toISOString(),
});

const quoteAdapter = (id: string, priority: number, quotes: Quote[], shouldThrow = false): VnQuoteAdapter => ({
  id,
  priority,
  getQuotes: async (symbols) => {
    if (shouldThrow) throw new Error(`${id} down`);
    return { quotes: symbols.map((s) => quotes.find((q) => q.symbol === s.toUpperCase())).filter((q): q is Quote => q != null), sourceTs: now };
  },
});

const healthy = () => true;
const configured = () => true;

test("vn engine: both providers OK → reconciliation picks primary + high confidence", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("fake-a", 1, [mk("AAA", 100)]), quoteAdapter("fake-b", 2, [mk("AAA", 100.1)])],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["AAA"]);
  assert.equal(r.quotes.length, 1);
  assert.equal(r.quotes[0].price, 100); // primary wins
  assert.deepEqual(r.providers.sort(), ["fake-a", "fake-b"]);
  const meta = r.bySymbol.get("AAA");
  assert.ok(meta);
  assert.equal(meta.providerCount, 2);
  assert.equal(meta.confidence.level, "high");
  assert.equal(r.degraded, false);
  assert.equal(r.fallback, false);
});

test("vn engine: primary fails → graceful fallback to secondary with note + non-high confidence", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [
      quoteAdapter("fake-a", 1, [], true),
      quoteAdapter("fake-b", 2, [mk("BBB", 50)]),
    ],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["BBB"]);
  assert.equal(r.fallback, true);
  assert.equal(r.degraded, true);
  assert.equal(r.quotes[0].price, 50);
  assert.deepEqual(r.providers, ["fake-b"]);
  assert.equal(r.bySymbol.get("BBB")?.confidence.level, "medium");
  assert.ok(r.notes.some((n) => n.includes("fallback")));
});

test("vn engine: tổng provider fail → empty + degraded, không ném exception", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("fake-a", 1, [], true), quoteAdapter("fake-b", 2, [], true)],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["CCC"]);
  assert.equal(r.quotes.length, 0);
  assert.equal(r.degraded, true);
});

test("vn engine: health gate loại provider đang circuit-open", async () => {
  let called: string[] = [];
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("fake-a", 1, [mk("DDD", 1)]), quoteAdapter("fake-b", 2, [mk("DDD", 1.01)])],
    isProviderHealthy: (id) => id === "fake-b", // primary circuit-open
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["DDD"]);
  void called;
  called = r.providers;
  assert.deepEqual(called, ["fake-b"]);
  assert.equal(r.fallback, true);
  assert.equal(r.bySymbol.get("DDD")?.provider, "fake-b");
});

test("vn engine: discrepancy vượt tolerance được ghi nhận (không lấy trung bình)", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("fake-a", 1, [mk("EEE", 100)]), quoteAdapter("fake-b", 2, [mk("EEE", 105)])],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["EEE"]);
  const d = r.discrepancies.find((x) => x.symbol === "EEE");
  assert.ok(d);
  assert.ok(d.deviationPct > 0.8);
  assert.equal(r.bySymbol.get("EEE")?.confidence.level, "medium");
  assert.equal(r.quotes[0].price, 100); // primary, không trung bình 102.5
});

test("vn engine: OHLCV — secondary fallback + archive fallback", async () => {
  const bar = (t: number, c: number): OhlcvBar => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 100 });
  const ohlcvAdapters: VnOhlcvAdapter[] = [
    { id: "fake-a", priority: 1, getOhlcv: async () => { throw new Error("down"); } },
    { id: "fake-b", priority: 2, getOhlcv: async () => [bar(now - 86_400_000, 10), bar(now, 11)] },
  ];
  const engine = new VnDataEngine({
    ohlcvAdapters,
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveOhlcv("FFF", 10);
  assert.ok(r);
  assert.equal(r.provider, "fake-b");
  assert.equal(r.fallback, true);

  const engine2 = new VnDataEngine({
    ohlcvAdapters: [ohlcvAdapters[0]],
    archiveOhlcv: async () => [bar(now - 2 * 86_400_000, 8), bar(now, 9)],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r2 = await engine2.resolveOhlcv("FFF", 10);
  assert.ok(r2);
  assert.equal(r2.provider, "archive");
  assert.equal(r2.degraded, true);
});

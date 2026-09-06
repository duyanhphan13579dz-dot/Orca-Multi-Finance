import test from "node:test";
import assert from "node:assert/strict";
import { VnDataEngine, vnDataState, type VnQuoteAdapter, type VnOhlcvAdapter } from "../engines/vn-data-engine";
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

test("vn engine: single provider (VNDirect) OK → quotes + medium confidence (single-source)", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("vndirect", 1, [mk("AAA", 100)])],
    isProviderHealthy: healthy,
    isConfigured: configured,
    slaMs: () => 3 * 60_000,
  });
  const r = await engine.resolveQuotes(["AAA"]);
  assert.equal(r.quotes.length, 1);
  assert.equal(r.quotes[0].price, 100);
  assert.deepEqual(r.providers, ["vndirect"]);
  const meta = r.bySymbol.get("AAA");
  assert.ok(meta);
  assert.equal(meta.providerCount, 1);
  assert.equal(meta.confidence.level, "medium"); // single-source không bao giờ high
  assert.equal(r.degraded, false);
  assert.equal(r.fallback, false);
  assert.equal(r.discrepancies.length, 0);
});

test("vn engine: provider fail → empty + degraded + fallback, không ném exception", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("vndirect", 1, [], true)],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["CCC"]);
  assert.equal(r.quotes.length, 0);
  assert.equal(r.degraded, true);
  assert.equal(r.fallback, true);
  assert.ok(r.notes.some((n) => n.includes("UNAVAILABLE")));
});

test("vn engine: health gate loại provider đang circuit-open", async () => {
  const engine = new VnDataEngine({
    quoteAdapters: [quoteAdapter("vndirect", 1, [mk("DDD", 1)])],
    isProviderHealthy: () => false,
    isConfigured: configured,
  });
  const r = await engine.resolveQuotes(["DDD"]);
  assert.equal(r.quotes.length, 0);
  assert.deepEqual(r.providers, []);
});

test("vn engine: indices — single provider success / fail → null", async () => {
  const engine = new VnDataEngine({
    indicesAdapters: [{ id: "vndirect", priority: 1, getIndices: async () => ({ items: [{ code: "VNINDEX", name: "VN-Index", value: 1250, change: 10, changePercent: 0.8, volume: 100, updatedAt: new Date(now).toISOString() }], sourceTs: now }) }],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const ok = await engine.resolveIndices();
  assert.equal(ok?.items[0].code, "VNINDEX");
  assert.equal(ok?.providers[0], "vndirect");

  const engine2 = new VnDataEngine({
    indicesAdapters: [{ id: "vndirect", priority: 1, getIndices: async () => { throw new Error("down"); } }],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  assert.equal(await engine2.resolveIndices(), null);
});

test("vn engine: OHLCV — provider OK; fail → archive fallback; cả hai fail → null", async () => {
  const bar = (t: number): OhlcvBar => ({ time: t, open: 10, high: 11, low: 9, close: 10.5, volume: 100 });
  const day = 86_400_000;
  const ohlcv = (id: string, fail: boolean): VnOhlcvAdapter => ({
    id,
    priority: 1,
    getOhlcv: async () => {
      if (fail) throw new Error(`${id} down`);
      return [bar(now - day), bar(now)];
    },
  });
  const ok = new VnDataEngine({ ohlcvAdapters: [ohlcv("vndirect", false)], isProviderHealthy: healthy, isConfigured: configured });
  const r1 = await ok.resolveOhlcv("VNM", 50);
  assert.equal(r1?.provider, "vndirect");
  assert.equal(r1?.fallback, false);

  const archive = new VnDataEngine({
    ohlcvAdapters: [ohlcv("vndirect", true)],
    archiveOhlcv: async () => [bar(now - day), bar(now)],
    isProviderHealthy: healthy,
    isConfigured: configured,
  });
  const r2 = await archive.resolveOhlcv("VNM", 50);
  assert.equal(r2?.provider, "archive");
  assert.equal(r2?.fallback, true);
  assert.equal(r2?.degraded, true);

  const none = new VnDataEngine({ ohlcvAdapters: [ohlcv("vndirect", true)], isProviderHealthy: healthy, isConfigured: configured });
  assert.equal(await none.resolveOhlcv("VNM", 50), null);
});

test("vn engine: vnDataState phân loại LIVE/FRESH/DELAYED/STALE/UNAVAILABLE theo SLA", async () => {
  const session = { trading: true, state: "morning_continuous" } as never;
  const sla = 180_000; // 3 phút phiên khớp lệnh
  assert.equal(vnDataState(null, session), "UNAVAILABLE");
  assert.equal(vnDataState(30_000, session), "LIVE"); // ≤ sla/3
  assert.equal(vnDataState(120_000, session), "FRESH"); // ≤ sla
  assert.equal(vnDataState(400_000, session), "DELAYED"); // ≤ 3*sla
  assert.equal(vnDataState(600_000, session), "STALE");
  void sla;
});

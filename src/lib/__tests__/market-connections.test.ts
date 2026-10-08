/**
 * ORCA MARKET / STOCK DATA CONNECTIONS — test suite.
 *
 * Covers the transport-selection layer that keeps VN market + stock data flowing:
 *  - whole-board snapshot index/lookup + batching (no silent truncation)
 *  - public OHLCV candidate selection (entrade / VPS-hist / Yahoo VN)
 *  - Yahoo VN symbol mapping (`.VN` tickers, `^` indices)
 *  - market source monitor id mapping
 *  - universe filter + source catalog integrity / probe coverage
 *
 * Run: pnpm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { Quote } from "../types";
import {
  chunkSymbols,
  pickQuotesFromSnapshot,
  snapshotSatisfies,
  VND_SNAPSHOT_MIN_SYMBOLS,
  type VndMarketQuotesPack,
} from "../providers/vndirect-market-quotes";
import { selectBestOhlcv, type PublicOhlcvPack } from "../providers/public-vn-feed";
import { yahooSymbolForVnEquity, isVnIndexYahooSymbol } from "../providers/yahoo";
import { marketSourceIdFor } from "../realtime/market-source-monitor";
import { filterVnUniverse, liquidBoardUniverse, type VnUniverseRow } from "../services/vn-universe";
import { tfsFor, vnStockChartPlan } from "../chart-const";
import { normalizeQuoteScale, samePriceUnit } from "../quote-normalize";
import { filterVnMarketBoard, type VnMarketBoard } from "../services/vn-market-board-cache";
import { SOURCE_CATALOG, catalogSummary } from "../data-engine/catalog";
import { probedSourceIds } from "../data-engine/source-sync";
import { PUBLIC_SOURCE_CATALOG } from "../providers/public-source-catalog";

const quote = (symbol: string, price: number, extra: Partial<Quote> = {}): Quote => ({
  symbol,
  assetClass: "stock",
  price,
  change: null,
  changePercent: null,
  ...extra,
});

test("chunkSymbols: dedupes, uppercases and batches without truncation", () => {
  const symbols = Array.from({ length: 95 }, (_, i) => `S${i}`);
  const batches = chunkSymbols(["vcb", "VCB", ...symbols, "  "], 40);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0]!.slice(0, 2), ["VCB", "S0"]);
  assert.equal(batches.flat().length, 96); // 95 + VCB, blank dropped, no dup
  assert.equal(new Set(batches.flat()).size, 96);
  assert.deepEqual(chunkSymbols([], 40), []);
});

test("pickQuotesFromSnapshot: keeps only requested, valid board rows", () => {
  const snapshot: Quote[] = [
    quote("VCB", 62.5),
    quote("HPG", 27.1),
    quote("FPT", 0), // invalid price → dropped
    quote("SSI", -1), // invalid price → dropped
    quote("MWG", 41.2),
  ];
  const picked = pickQuotesFromSnapshot(snapshot, ["vcb", "FPT", "SSI", "VNM"]);
  assert.deepEqual(
    picked.map((q) => q.symbol),
    ["VCB"],
  );
  assert.equal(picked[0]!.price, 62.5);
  assert.deepEqual(pickQuotesFromSnapshot(snapshot, []), []);
});

test("snapshot threshold: large boards use the snapshot path", () => {
  assert.ok(VND_SNAPSHOT_MIN_SYMBOLS > 1 && VND_SNAPSHOT_MIN_SYMBOLS <= 50);
});

test("snapshotSatisfies: scoped hits must cover the request, full reads need a complete board", () => {
  const partial: VndMarketQuotesPack = {
    quotes: [quote("VCB", 62.5), quote("HPG", 27.1)],
    sourceTs: null,
    sessionDate: "2026-10-08",
    complete: false,
    pagesFetched: 1,
  };
  const complete: VndMarketQuotesPack = { ...partial, complete: true, pagesFetched: 8 };
  assert.ok(snapshotSatisfies(partial, ["VCB"]));
  assert.ok(snapshotSatisfies(partial, ["VCB", "HPG"]));
  assert.ok(!snapshotSatisfies(partial, ["VCB", "FPT"]));
  assert.ok(!snapshotSatisfies(partial, [])); // full-board reader must not accept a slice
  assert.ok(snapshotSatisfies(complete, []));
});

test("selectBestOhlcv: prefers usable history, then longest series", () => {
  const mk = (source: string, bars: number): PublicOhlcvPack => ({
    source,
    bars: Array.from({ length: bars }, (_, i) => ({
      time: 1_700_000_000_000 + i * 86_400_000,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1_000,
    })),
  });
  const best = selectBestOhlcv([mk("entrade", 6), mk("vps-hist", 240), mk("yahoo", 30)], 200);
  assert.equal(best?.source, "vps-hist");
  assert.equal(best?.bars.length, 200);
  // 8 bars (< 20) must lose against a 25-bar series even if nothing else exists
  const best2 = selectBestOhlcv([mk("entrade", 8), mk("yahoo", 25)], 250);
  assert.equal(best2?.source, "yahoo");
  assert.equal(selectBestOhlcv([mk("entrade", 0)], 10), null);
  assert.equal(selectBestOhlcv([], 10), null);
});

test("yahooSymbolForVnEquity: .VN tickers and ^ indices", () => {
  assert.equal(yahooSymbolForVnEquity("VCB"), "VCB.VN");
  assert.equal(yahooSymbolForVnEquity("vcb"), "VCB.VN");
  assert.equal(yahooSymbolForVnEquity("VNINDEX"), "^VNINDEX");
  assert.equal(yahooSymbolForVnEquity("VN-INDEX"), "^VNINDEX");
  assert.equal(yahooSymbolForVnEquity("HNX"), "^HNX");
  assert.equal(yahooSymbolForVnEquity("HNX30"), "^HNX30");
  assert.equal(yahooSymbolForVnEquity("UPCOM"), "^UPCOM");
  assert.equal(yahooSymbolForVnEquity("VN30"), "^VN30");
  assert.ok(isVnIndexYahooSymbol("VNINDEX"));
  assert.ok(!isVnIndexYahooSymbol("VCB"));
});

test("marketSourceIdFor: OHLCV source labels map to monitor ids", () => {
  assert.equal(marketSourceIdFor("vndirect"), "vndirect");
  assert.equal(marketSourceIdFor("public:entrade"), "entrade");
  assert.equal(marketSourceIdFor("public:vps-hist"), "vps-hist");
  assert.equal(marketSourceIdFor("public:yahoo"), "yahoo-public");
  assert.equal(marketSourceIdFor("vndirect-dchart"), "vndirect-dchart");
  assert.equal(marketSourceIdFor("ssi-fcdata"), "ssi-fcdata");
  assert.equal(marketSourceIdFor("something-else"), null);
});

test("filterVnUniverse: exchange, search and limit", () => {
  const rows: VnUniverseRow[] = [
    { symbol: "VCB", name: "Vietcombank", exchange: "HOSE", industry: "Ngân hàng", listedDate: null, status: "listed" },
    { symbol: "ACB", name: "Asia Commercial Bank", exchange: "HOSE", industry: "Ngân hàng", listedDate: null, status: "listed" },
    { symbol: "PVS", name: "PetroVietnam Services", exchange: "HNX", industry: "Dầu khí", listedDate: null, status: "listed" },
    { symbol: "AAA", name: "An Phat Bioplastics", exchange: "UPCOM", industry: "Nhựa", listedDate: null, status: "listed" },
  ];
  assert.deepEqual(
    filterVnUniverse(rows, { exchange: "hose" }).map((r) => r.symbol),
    ["VCB", "ACB"],
  );
  assert.deepEqual(
    filterVnUniverse(rows, { search: "bank" }).map((r) => r.symbol),
    ["VCB", "ACB"],
  );
  assert.deepEqual(
    filterVnUniverse(rows, { search: "pvs" }).map((r) => r.symbol),
    ["PVS"],
  );
  assert.equal(filterVnUniverse(rows, { limit: 2 }).length, 2);
  assert.equal(filterVnUniverse(rows, { exchange: "ALL", limit: 0 }).length, 4);
  assert.equal(liquidBoardUniverse().length >= 40, true);
});

test("filterVnMarketBoard: symbol filter and row limit keep meta intact", () => {
  const board: VnMarketBoard = {
    quotes: [quote("VCB", 62), quote("HPG", 27), quote("FPT", 130)],
    indices: [],
    universeSize: 3,
    sessionDate: "2026-10-08",
    meta: { source: "vndirect" } as VnMarketBoard["meta"],
  };
  const filtered = filterVnMarketBoard(board, { symbols: ["hpg"], limit: 1 });
  assert.deepEqual(filtered.quotes.map((q) => q.symbol), ["HPG"]);
  assert.equal(filtered.universeSize, 1);
  assert.equal(filtered.sessionDate, "2026-10-08");
  assert.equal(filterVnMarketBoard(board, { limit: 2 }).quotes.length, 2);
});

test("vnStockChartPlan: intraday → dchart, 4h → 1h aggregate, 1w → daily aggregate", () => {
  assert.deepEqual(vnStockChartPlan("5m", 300), { mode: "dchart", resolution: "5", want: 300 });
  assert.deepEqual(vnStockChartPlan("1m", 2_000), { mode: "dchart", resolution: "1", want: 1_000 });
  assert.deepEqual(vnStockChartPlan("1d", 900), { mode: "daily", want: 500 });

  const h4 = vnStockChartPlan("4h", 200);
  assert.equal(h4.mode, "aggregate");
  if (h4.mode === "aggregate") {
    assert.equal(h4.from, "1h");
    assert.equal(h4.resolution, "60");
    assert.equal(h4.tfMs, 4 * 3_600_000);
    assert.ok(h4.want >= 800 && h4.want <= 1_200);
  }

  const w1 = vnStockChartPlan("1w", 100);
  assert.equal(w1.mode, "aggregate");
  if (w1.mode === "aggregate") {
    assert.equal(w1.from, "1d");
    assert.equal(w1.resolution, "D");
    assert.equal(w1.want, 500); // capped by the daily transport batch
  }

  // every timeframe accepted by the stock chart API maps to a plan
  for (const tf of tfsFor("stock")) {
    const plan = vnStockChartPlan(tf, 250);
    assert.ok(plan.mode === "dchart" || plan.mode === "daily" || plan.mode === "aggregate");
  }
});

test("normalizeQuoteScale: nghìn VND ↔ VND đầy đủ — chỉ chỉnh khi lệch đơn vị", () => {
  const ref = quote("VCB", 62.5); // thousands VND convention
  const fullVnd = quote("VCB", 62_500, { open: 62_000, high: 63_000, low: 61_800, referencePrice: 62_100 });
  const aligned = normalizeQuoteScale(fullVnd, ref);
  assert.equal(aligned.price, 62.5);
  assert.equal(aligned.open, 62);
  assert.equal(aligned.high, 63);
  assert.equal(aligned.referencePrice, 62.1);

  const thousands = quote("VCB", 0.0625);
  assert.equal(normalizeQuoteScale(thousands, ref).price, 62.5);

  // real price differences must never be "flattened"
  const slightlyOff = quote("VCB", 63.2);
  assert.equal(normalizeQuoteScale(slightlyOff, ref).price, 63.2);
  assert.equal(normalizeQuoteScale(quote("VCB", 30), ref).price, 30);

  // no reference → untouched
  assert.equal(normalizeQuoteScale(fullVnd, null).price, 62_500);
  assert.ok(samePriceUnit(ref, quote("VCB", 62.6)));
  assert.ok(!samePriceUnit(ref, fullVnd));
});

test("source catalog: unique ids, wired candidates and probe coverage", () => {
  const ids = SOURCE_CATALOG.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of SOURCE_CATALOG) {
    assert.ok(entry.module.length > 0, `${entry.id} missing module`);
    assert.ok(entry.description.length > 0, `${entry.id} missing description`);
  }
  const summary = catalogSummary();
  assert.equal(summary.total, SOURCE_CATALOG.length);
  assert.ok((summary.byDomain.market ?? 0) >= 8, "market domain should list the VN quote/OHLCV chain");
  assert.ok((summary.byDomain.financial ?? 0) >= 3);

  const probed = probedSourceIds();
  for (const required of ["vndirect", "ssi-iboard", "vps", "entrade", "vps-hist", "yahoo-vn", "binance-spot", "coingecko"]) {
    assert.ok(probed.includes(required), `connectivity self-test should probe ${required}`);
  }

  // documented public sources must point at a wired provider id when they claim one
  const wired = new Set(ids);
  const dangling = PUBLIC_SOURCE_CATALOG.filter((c) => c.providerId && !wired.has(c.providerId));
  assert.deepEqual(dangling.map((c) => c.id), []);
});

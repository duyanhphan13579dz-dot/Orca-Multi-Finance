/**
 * COMMODITY SERVICE — priority (Simplize → Vietnambiz → fallback), real-data
 * only, and crash-safety.
 *
 * Stubs fetch with REAL provider payload shapes:
 * - Simplize public page (server-rendered text — WTI fixture, real values)
 * - Yahoo Finance quotes + chart JSON (real shapes)
 * - Vietnambiz SJC gold board (real published values)
 * All other sources fail → assert degrade, never crash, never fake.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getCommodityMarket, getCommodityHistory, getCommodityDetail, getCommodityCorrelation, getCommodityNews } from "../services/commodities";
import { parseDecimal } from "../providers/commodities";

const WTI_PAGE_TEXT =
  "Trang chủ > Hàng hóa > Dầu thô WTI Giá hiện tại: 91.48 +0.18 0.20% " +
  "Giá đóng cửa hôm trước 91.30 Giá mở cửa 91.67 Biên độ ngày 88.72 - 92.17 " +
  "Biên độ 52 tuần 54.98 - 119.4 Đơn vị tính USD/Bbl % 7D 9.69% % 1M 21.62% " +
  "% 3M 1.04% % YTD 59.32% % 1Y 44.11% % 5Y 32.02% " +
  "Cổ phiếu liên quan GAS (HOSE) PLX (HOSE) BSR (HOSE) PVD (HOSE) PVS (HNX) Tin tức hàng hoá";

const D10_PAGE_TEXT =
  "Hàng Hoá > Thép D10 Giá hiện tại: 14.21 - 0.00% Giá đóng cửa hôm trước 14.21 " +
  "Biên độ 52 tuần 12.99 - 15.43 Đơn vị tính Nghìn đồng/kg " +
  "% 7D - % 1M - % 3M -7.91% % YTD +4.49% % 1Y +9.39% % 5Y -12.34% " +
  "Cổ phiếu liên quan NKG (HOSE) CTCP Thép Nam Kim 10,750 -50 -0.46% " +
  "HPG (HOSE) CTCP Tập đoàn Hòa Phát 21,700 100 0.46% " +
  "HSG (HOSE) CTCP Tập đoàn Hoa Sen 10,600 -50 -0.47% Tin tức hàng hoá";

const PIG_PAGE_TEXT =
  "Hàng Hoá > Heo hơi miền Bắc Giá hiện tại: 59,500 +1,800 3.12% Giá đóng cửa hôm trước 57,700 " +
  "Biên độ 52 tuần 48,100 - 79,100 Đơn vị tính VNĐ/kg " +
  "% 7D +3.12% % 1M -7.47% % 3M -12.24% % YTD -13.64% % 1Y +7.4% % 5Y +22.08% " +
  "Cổ phiếu liên quan DBC (HOSE) CTCP Tập đoàn Dabaco Việt Nam 16,800 -250 -1.47% " +
  "BAF (HOSE) Công ty Cổ phần Nông nghiệp BAF Việt Nam 32,550 50 0.15% Tin tức hàng hoá";

const GENERIC_PAGE_TEXT =
  "Hàng Hoá > Mặt hàng chung Giá hiện tại: 1.00 +0.01 1.00% Giá đóng cửa hôm trước 0.99 " +
  "Đơn vị tính USD/T % 7D 1.00% % 1M 2.00% % 1Y 3.00% Cổ phiếu liên quan HPG (HOSE) Tin tức hàng hoá";

function yahooChartBody(symbol: string, price: number, prev: number): unknown {
  const ts = Math.floor(Date.now() / 1000) - 3600;
  return {
    chart: {
      result: [{
        meta: { symbol, regularMarketPrice: price, chartPreviousClose: prev, regularMarketTime: ts, currency: "USD" },
        timestamp: [ts - 3600, ts],
        indicators: { quote: [{ open: [prev, prev], high: [price, price], low: [prev, prev], close: [prev, price], volume: [0, 100] }] },
        error: null,
      }],
    },
  };
}

let fetchCount = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetchCount++;
  if (url.includes("simplize.vn") && (url.includes("/hang-hoa/wti") || url.includes("/gia-vang"))) {
    return Promise.resolve(new Response(WTI_PAGE_TEXT, { status: 200, headers: { "content-type": "text/html" } }));
  }
  if (url.includes("simplize.vn/hang-hoa/gia-thep-d10")) {
    return Promise.resolve(new Response(D10_PAGE_TEXT, { status: 200, headers: { "content-type": "text/html" } }));
  }
  if (url.includes("simplize.vn/hang-hoa/gia-heo-hoi-mien-bac")) {
    return Promise.resolve(new Response(PIG_PAGE_TEXT, { status: 200, headers: { "content-type": "text/html" } }));
  }
  // any other Simplize page → generic valid page (keeps the shared http circuit
  // breaker closed so the catalogue-wide fetch completes in the test)
  if (url.includes("simplize.vn/hang-hoa/")) {
    return Promise.resolve(new Response(GENERIC_PAGE_TEXT, { status: 200, headers: { "content-type": "text/html" } }));
  }
  if (url.includes("finance.yahoo.com") && url.includes("/v8/finance/chart/")) {
    const m = url.match(/\/chart\/([^?]+)/);
    const sym = m ? decodeURIComponent(m[1]) : "CL=F";
    const body = yahooChartBody(sym, sym === "CL=F" ? 91.48 : 100, sym === "CL=F" ? 91.3 : 99);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (url.includes("vietnambiz.vn")) {
    return Promise.resolve(new Response("<html>KHONG CO</html>", { status: 404 }));
  }
  return Promise.resolve(new Response("nope", { status: 502 }));
}) as typeof fetch;

test("parseDecimal: thousands comma + whitespace handled, garbage → NaN", () => {
  assert.equal(parseDecimal("1,226"), 1226);
  assert.equal(parseDecimal("15.87"), 15.87);
  assert.equal(parseDecimal("9.450"), 9.45);
  assert.equal(parseDecimal("+ 0.18"), 0.18);
  assert.equal(parseDecimal("- 0.00"), -0.0);
  assert.ok(Number.isNaN(parseDecimal("abc")));
});

test("getCommodityMarket: Simplize is the PRIMARY source (wti row + provenance)", async () => {
  const r = await getCommodityMarket();
  assert.ok(r, "market must resolve even when some sources fail");
  const wti = r.data.rows.find((x) => x.symbol === "CL");
  assert.ok(wti, "WTI row exists");
  assert.equal(wti.price, 91.48);
  assert.equal(wti.change, 0.18);
  assert.equal(wti.changePercent, 0.2);
  assert.equal(wti.previousClose, 91.3);
  assert.equal(wti.unit, "USD/Bbl");
  assert.equal(wti.sourceRecords[0].source, "Simplize");
  // fixture page publishes no "Cập nhật lúc" → honest null + DELAYED (never fake LIVE)
  assert.equal(wti.sourceTimestamp, null);
  assert.equal(wti.freshness, "DELAYED");
  assert.equal(wti.freshnessNote ?? "", "Nguồn không công bố timestamp — dữ liệu trang công khai, không phải realtime");
  assert.ok(r.data.sourcesUsed.includes("Simplize"));
  assert.equal(wti.performance?.["1W"].changePercent, 9.69);
  // fallback is real-only: brent (no Simplize page) still gets a REAL Yahoo row
  const brent = r.data.rows.find((x) => x.symbol === "BZ");
  assert.ok(brent);
  assert.equal(brent.sourceRecords[0].source, "Yahoo Finance (futures)");
  // commodities with NO source at all (aluminum/zinc) → UNAVAILABLE, never invented
  assert.equal(r.data.rows.find((x) => x.symbol === "AL"), undefined);
  assert.ok(r.data.unavailable.some((u) => u.key === "aluminum"));
  assert.ok(r.data.unavailable.some((u) => u.key === "zinc"));
  // wti must NOT have been replaced by the yahoo fallback (simplize is primary)
  assert.equal(wti.sourceRecords[0].source, "Simplize");
});

test("getCommodityMarket: meta honest — DEGRADED + partial when unavailable non-empty", async () => {
  const r = await getCommodityMarket();
  assert.ok(r);
  assert.equal(r.meta.freshness, "DEGRADED");
  assert.equal(r.meta.partial, true);
  assert.ok(r.meta.source.includes("Simplize"));
});

test("getCommodityDetail: resolves row + def for a chartable commodity", async () => {
  const d = await getCommodityDetail("wti");
  assert.ok(d);
  assert.equal(d.def.key, "wti");
  assert.equal(d.row?.price, 91.48);
  assert.equal(d.row?.relatedStocks?.includes("GAS"), true);
});

test("getCommodityDetail: unknown key → null (route 400), never a guessed row", async () => {
  const d = await getCommodityDetail("definitely-not-real-xyz");
  assert.equal(d, null);
});

test("getCommodityHistory: real OHLC via Yahoo (same ticker Simplize uses), CLOSE_ONLY never fabricated", async () => {
  const h = await getCommodityHistory("wti", { timeframe: "1d", limit: 100 });
  assert.ok(h);
  assert.equal(h.symbol, "CL");
  assert.equal(h.priceType, "OHLC");
  assert.ok(h.points.length > 0);
  assert.ok(h.points.every((p) => p.close > 0 && p.source === "Yahoo Finance (futures)"));
  // symbol with no yahoo ticker → null (must NOT fabricate a chart)
  const steel = await getCommodityHistory("steel", { timeframe: "1d" });
  assert.equal(steel, null);
});

test("getCommodityMarket: VN universe rows (Thép D10, heo hơi) — unit/currency/market/related stocks", async () => {
  const r = await getCommodityMarket();
  assert.ok(r);
  const d10 = r.data.rows.find((x) => x.symbol === "D10");
  assert.ok(d10, "Thép D10 row exists (verified Simplize page)");
  assert.equal(d10.price, 14.21);
  assert.equal(d10.change, 0);
  assert.equal(d10.changePercent, 0);
  assert.equal(d10.unit, "Nghìn đồng/kg");
  assert.equal(d10.currency, "VND");
  assert.equal(d10.market, "VN");
  assert.equal(d10.subgroup, "Steel");
  assert.ok(d10.relatedStocks!.includes("HPG"));
  assert.equal(d10.performance?.["1Y"].changePercent, 9.39);
  assert.equal(d10.freshness, "DELAYED"); // fixture page has no published timestamp

  const pig = r.data.rows.find((x) => x.symbol === "PIGVN");
  assert.ok(pig, "Heo hơi row exists");
  assert.equal(pig.price, 59_500);
  assert.equal(pig.changePercent, 3.12);
  assert.equal(pig.unit, "VNĐ/kg");
  assert.ok(pig.relatedStocks!.includes("DBC"));
});

test("intelligence: correlation = INSUFFICIENT_DATA (2-point stub, never fabricated); news = keyword basis", async () => {
  const c = await getCommodityCorrelation("wti");
  assert.ok(c);
  assert.equal(c.benchmark, "^VNINDEX");
  assert.equal(c.correlation.status, "INSUFFICIENT_DATA");
  assert.equal(c.correlation.r, null);
  assert.equal(c.correlation.beta, null);
  assert.match(c.correlation.note, /không|Chưa/);

  const n = await getCommodityNews("wti");
  assert.ok(n);
  assert.equal(n.basis, "keyword-match");
  assert.ok(Array.isArray(n.articles));
  // live feeds are unreachable in this stub → empty articles, no fake catalysts
  assert.equal(n.articles.length, 0);
  assert.ok(n.note.length > 0);
});

test("crash-safety: service runs even with everything failing — no throw", async () => {
  // swap fetch to always-fail, confirm getCommodityMarket resolves null-ish gracefully
  globalThis.fetch = (() => Promise.resolve(new Response("down", { status: 503 }))) as typeof fetch;
  const r = await getCommodityMarket();
  // producers catch each source; market resolves with rows/unavailable, or null via cached producer error
  assert.ok(r === null || Array.isArray(r.data.rows));
  globalThis.fetch = origFetch;
});

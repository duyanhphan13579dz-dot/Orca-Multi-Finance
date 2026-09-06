import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQuoteRows, normalizeIndexRows, normalizeCandleRows, normalizeStatementHits, pivotStatement,
  normalizeRatioRows, ratioKey, pivotRatioRows, normalizeOrderBook, normalizeProfileRows,
  getVndQuotes, getVndOhlcv, getVndIndices, getVndFinancials, getVndRatios, getVndOrderBook, getVndRecommendation,
  type VndQuoteRow,
} from "../providers/vndirect";
import { resetProviderHealth } from "../health";

beforeEach(() => resetProviderHealth());

const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response): void {
  globalThis.fetch = ((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch;
}

test("vndirect: normalizeQuoteRow — full fields (price/bands/bid-ask/change%)", () => {
  const rows = normalizeQuoteRows([
    { code: "VNM", date: "2026-09-04", time: "14:30:00", close: 65000, open: 64800, high: 65200, low: 64700, nmVolume: 1200000, nmValue: 78e9, change: 500, changeRatio: 0.0077, referencePrice: 64500, ceilingPrice: 71000, floorPrice: 58000, bidPrice: 64950, bidVolume: 1000, askPrice: 65050, askVolume: 800 },
  ]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.symbol, "VNM");
  assert.equal(r.price, 65000);
  assert.equal(r.changePercent, 0.77); // ratio → %
  assert.equal(r.referencePrice, 64500);
  assert.equal(r.ceilingPrice, 71000);
  assert.equal(r.floorPrice, 58000);
  assert.equal(r.bidPrice, 64950);
  assert.equal(r.askPrice, 65050);
  assert.ok(r.sourceTs != null);
});

test("vndirect: normalizeQuoteRow — changePercent dạng % giữ nguyên; payload lỗi → []", () => {
  assert.equal(normalizeQuoteRows([{ code: "VCB", close: 90000, changePercent: 1.5 }])[0].changePercent, 1.5);
  assert.deepEqual(normalizeQuoteRows(null), []);
  assert.deepEqual(normalizeQuoteRows([{ code: "BAD", close: null }]), []);
  assert.deepEqual(normalizeQuoteRows("garbage"), []);
});

test("vndirect: normalizeIndexRow — tolerant code/value naming", () => {
  const items = normalizeIndexRows([
    { indexCode: "VNINDEX", indexValue: 1290.5, change: 5.2, changePercent: 0.4, nmVolume: 600e6, name: "Vn-Index" },
    { code: "HNXINDEX", close: 240, pctChange: -0.3 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].code, "VNINDEX");
  assert.equal(items[0].value, 1290.5);
  assert.equal(items[1].value, 240);
});

test("vndirect: normalizeCandleRows — date+time → epoch, sort tăng dần, invalid bỏ", () => {
  const bars = normalizeCandleRows([
    { code: "VNM", date: "2026-09-03", time: "14:59:00", open: 10, high: 11, low: 9, close: 10.5, nmVolume: 5 },
    { code: "VNM", date: "2026-09-04", time: "14:59:00", open: 10.5, high: 12, low: 10, close: 11.5, nmVolume: 7 },
    { code: "VNM", date: "2026-09-05", open: null, high: 1, low: 1, close: 1 },
  ]);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].close, 10.5);
  assert.equal(bars[1].close, 11.5);
  assert.equal(bars[0].time < bars[1].time, true);
});

test("vndirect: financialStatement hits → items + pivot rows (itemName + canonical)", () => {
  const hits = [
    { _source: { fiscalDate: "2026-06-30", itemName: "Doanh thu thuần về bán hàng và cung cấp dịch vụ", itemCode: "1", numericValue: 1000 } },
    { _source: { fiscalDate: "2026-06-30", itemName: "Lợi nhuận gộp về bán hàng và cung cấp dịch vụ", itemCode: "2", numericValue: 400 } },
    { _source: { fiscalDate: "2026-06-30", itemName: "Lợi nhuận sau thuế thu nhập doanh nghiệp", itemCode: "3", numericValue: 150 } },
    { _source: { fiscalDate: "2026-03-31", itemName: "Doanh thu thuần về bán hàng và cung cấp dịch vụ", itemCode: "1", numericValue: 900 } },
  ];
  const items = normalizeStatementHits(hits);
  assert.equal(items.length, 4);
  assert.equal(items[0].year, 2026);
  assert.equal(items[0].quarter, 2);
  const pivots = pivotStatement(items);
  assert.equal(pivots.length, 2); // 2 kỳ
  const q2 = pivots.find((p) => p.period === "2026-06-30");
  assert.ok(q2);
  assert.equal(q2.revenue, 1000);
  assert.equal(q2.grossProfit, 400);
  assert.equal(q2.netProfit, 150);
  assert.equal(q2.quarter, 2);
});

test("vndirect: ratios — itemName → key chuẩn + pivot theo kỳ", () => {
  const rows = normalizeRatioRows([
    { reportDate: "2026-06-30", itemName: "Chỉ số P/E", itemCode: "53030", value: 12.5 },
    { reportDate: "2026-06-30", itemName: "ROE(%)", itemCode: "53021", value: 18 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(ratioKey("Chỉ số P/E"), "P/E");
  assert.equal(ratioKey("ROE(%)"), "ROE");
  const pivots = pivotRatioRows(rows);
  assert.equal(pivots[0]["P/E"], 12.5);
  assert.equal(pivots[0].ROE, 18);
});

test("vndirect: order book — top-of-book từ quote; không có dữ liệu → UNAVAILABLE (không bịa)", () => {
  const quote: VndQuoteRow = {
    symbol: "VNM", price: 65000, change: 500, changePercent: 0.77, open: 64800, high: 65200, low: 64700,
    close: 65000, referencePrice: 64500, ceilingPrice: 71000, floorPrice: 58000, volume: 1000, quoteVolume: 100,
    bidPrice: 64950, bidVolume: 2000, askPrice: 65050, askVolume: 1500, updatedAt: "2026-09-04", sourceTs: Date.now(),
  };
  const book = normalizeOrderBook("VNM", quote);
  assert.equal(book.depthStatus, "TOP_OF_BOOK");
  assert.equal(book.bids.length, 1);
  assert.equal(book.asks.length, 1);
  assert.equal(book.bestBid, 64950);
  assert.equal(book.bestAsk, 65050);
  assert.equal(book.spread, 100);
  assert.equal(book.totalBidVolume, 2000);

  const none = normalizeOrderBook("XYZ", null);
  assert.equal(none.depthStatus, "UNAVAILABLE");
  assert.deepEqual(none.bids, []);
  assert.deepEqual(none.asks, []);
});

test("vndirect: profile rows tolerant; recommendation KHÔNG fake", async () => {
  const profiles = normalizeProfileRows([{ code: "VNM", companyName: "Vinamilk", exchange: "HOSE", industry: "Consumer Staples", listingDate: "2006-01-19" }]);
  assert.equal(profiles[0].exchange, "HOSE");
  assert.equal(profiles[0].name, "Vinamilk");
  const rec = await getVndRecommendation("VNM");
  assert.equal(rec.status, "UNAVAILABLE");
  assert.equal(rec.recommendation, null);
  assert.match(rec.reason, /không tạo dữ liệu giả/);
});

test("vndirect: client — timeout → ProviderError (không crash)", async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (() => { throw new Error("timeout") as never; }) as typeof fetch;
    await assert.rejects(() => getVndQuotes(["VNM"]), /vndirect/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("vndirect: client — rate limit 429 → ProviderError sau retry", async () => {
  const orig = globalThis.fetch;
  try {
    stubFetch(() => okJson({ error: "rate limit" }, 429));
    await assert.rejects(() => getVndOhlcv("VNM", 50), /vndirect/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("vndirect: client — payload rỗng/không hợp lệ → ProviderError (không trả [] giả)", async () => {
  const orig = globalThis.fetch;
  try {
    stubFetch(() => okJson({ data: [] }));
    await assert.rejects(() => getVndIndices(), /empty indices/);
    stubFetch(() => okJson({ data: [{ code: "VNM", foo: "bar" }] }));
    await assert.rejects(() => getVndQuotes(["VNM"]), /empty quotes/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("vndirect: client — missing symbol → trả về rỗng sạch, không gọi mạng", async () => {
  const r = await getVndQuotes([]);
  assert.deepEqual(r, { quotes: [], sourceTs: null });
});

test("vndirect: financials/ratios client — dữ liệu thiếu → ProviderError", async () => {
  const orig = globalThis.fetch;
  try {
    stubFetch(() => okJson({ data: { hits: [] } }));
    await assert.rejects(() => getVndFinancials("VNM", "income", "quarter", 4), /empty income financials/);
    stubFetch(() => okJson({ data: [] }));
    await assert.rejects(() => getVndRatios("VNM"), /empty ratios/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("vndirect: order book client — quote không có bid/ask → UNAVAILABLE state", async () => {
  const orig = globalThis.fetch;
  try {
    stubFetch(() => okJson({ data: [{ code: "VNM", date: "2026-09-04", close: 65000 }] }));
    const book = await getVndOrderBook("VNM");
    assert.equal(book.depthStatus, "UNAVAILABLE");
    assert.equal(book.bestBid, null);
  } finally {
    globalThis.fetch = orig;
  }
});

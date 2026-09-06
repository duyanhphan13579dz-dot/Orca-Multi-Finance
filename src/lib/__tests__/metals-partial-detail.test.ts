/**
 * METALS DETAIL — quote fail + daily OHLC ok → PARTIAL: current null,
 * daily từ Yahoo (spot fail → futures GC=F failover), performance + technical
 * tính trên nến thật, meta.sections.quote = UNAVAILABLE — page không crash.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getMetalDetail } from "../services/metals";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const DAY = 86_400_000;
const start = Date.parse("2025-09-04T00:00:00Z");

function dailyCandles(count: number): unknown {
  const timestamps: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  for (let i = 0; i < count; i++) {
    timestamps.push(start + i * DAY);
    const c = 4000 + i * 2;
    open.push(c - 1);
    high.push(c + 3);
    low.push(c - 4);
    close.push(c);
  }
  return {
    chart: {
      result: [{ meta: { regularMarketPrice: close[close.length - 1], currency: "USD" }, timestamp: timestamps, indicators: { quote: [{ open, high, low, close, volume: timestamps.map(() => 1000) }] } }],
    },
  };
}

test("metals detail: quote UNAVAILABLE nhưng daily GC=F OK → PARTIAL (current null, daily + performance)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("forex-data-feed.swissquote.com")) return Promise.resolve(jsonResponse({}, 404));
    if (/query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/([A-Z0-9.%]+)\?interval=1d&range=2y/.test(url)) {
      const sym = decodeURIComponent(/chart\/([A-Z0-9.%]+)\?interval=1d&range=2y/.exec(url)![1]);
      // spot XAUUSD=X fail → futures GC=F OK (failover)
      if (sym === "GC=F") return Promise.resolve(jsonResponse(dailyCandles(400)));
      return Promise.resolve(jsonResponse({ chart: { error: { code: "Not Found" } } }, 200));
    }
    // quote request (range=5d) + prev-rates + vcb/vnb → semantic fail (200 + error shape)
    return Promise.resolve(jsonResponse({ chart: { error: { code: "Not Found" } } }, 200));
  }) as typeof fetch;
  try {
    // NOTE: responses cho "không có" phải là 200 + `{chart:{error…}}` để không
    // trip circuit breaker của provider (health registry) trước call daily.
    const r = await getMetalDetail("XAUUSD");
    assert.ok(r, "partial không null");
    assert.equal(r.detail.current, null, "quote unavailable");
    assert.ok(r.detail.daily.length >= 300, "daily thật từ GC=F");
    assert.ok(r.detail.performance, "performance tính được trên nến thật");
    assert.ok(r.detail.performance!.d1 != null && r.detail.performance!.y1 != null);
    assert.ok(r.detail.technical, "technical trên nến thật");
    assert.equal(r.meta.partial, true);
    assert.equal(r.meta.sections?.quote, "UNAVAILABLE");
    assert.equal(r.meta.sections?.chart, "FRESH");
  } finally {
    globalThis.fetch = orig;
  }
});

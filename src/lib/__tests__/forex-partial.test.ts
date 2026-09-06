/**
 * REGRESSION — Forex detail partial response (Phase 6).
 *
 * Kịch bản người dùng gặp lỗi: provider history (Frankfurter/ECB) fail nhưng
 * quote còn OK. Trước fix: `getForexDetail` trả `null` → route 502 → toàn trang
 * "Failed to load page"/Unavailable. Sau fix: trả PARTIAL success
 * `{ series: [], technical: null, current, meta.partial=true, meta.errors }`
 * — page vẫn render, KHÔNG fake candles.
 *
 * Chạy riêng process (node --test spawn mỗi file 1 process) để cache/health
 * breaker không ảnh hưởng test file khác.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexDetail } from "../services/forex";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function yahooQuoteBody(symbol: string, price: number): unknown {
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          regularMarketPrice: price,
          previousClose: price * 0.999,
          chartPreviousClose: price * 0.999,
          regularMarketTime: Math.floor(Date.now() / 1000),
          currency: "USD",
        },
      }],
    },
  };
}

const FRANKFURTER_RE = /api\.frankfurter\.dev/;
const YAHOO_CHART_RE = /query[12]\.finance\.yahoo\.com\/v8\/finance\/chart/;

function stubFetch(route: (url: string) => Response): void {
  const orig = globalThis.fetch;
  (globalThis as { __origFetch?: typeof fetch }).__origFetch = orig;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(route(url));
  }) as typeof fetch;
}

function restoreFetch(): void {
  const orig = (globalThis as { __origFetch?: typeof fetch }).__origFetch;
  if (orig) globalThis.fetch = orig;
}

test("forex detail: series fail + quote OK → PARTIAL success (không crash, không 502)", async () => {
  stubFetch((url) => {
    if (FRANKFURTER_RE.test(url)) return jsonResponse({ error: "unreachable" }, 502);
    if (YAHOO_CHART_RE.test(url)) {
      const m = /chart\/([A-Z0-9.]+)=X/.exec(url);
      const symbol = m?.[1] ?? "EURUSD";
      return jsonResponse(yahooQuoteBody(`${symbol}=X`, 1.0842));
    }
    return jsonResponse({ error: "unknown" }, 404);
  });
  try {
    const r = await getForexDetail("EURUSD");
    assert.ok(r, "detail phải trả về partial (không null) khi quote còn OK");
    assert.ok(r.detail.current, "quote vẫn có");
    assert.equal(r.detail.series.length, 0, "series rỗng — KHÔNG fake candles");
    assert.equal(r.detail.technical, null);
    assert.equal(r.meta.partial, true);
    assert.ok(Array.isArray(r.meta.errors) && r.meta.errors.some((e) => e.component === "chart"));
    assert.equal(r.meta.sections?.quote, "FRESH");
    assert.equal(r.meta.sections?.chart, "UNAVAILABLE");
  } finally {
    restoreFetch();
  }
});

/**
 * Phase 6 — markets API partial honesty: provider trả subset (e.g. thiếu
 * USDVND) thì response VẪN success cùng meta.errors chứa cặp thiếu —
 * không 502, không fake rate cho cặp không có.
 *
 * Chạy riêng process (node --test spawn mỗi file 1 process) để cache/health
 * breaker module-level không ảnh hưởng file khác.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexMarkets } from "../services/forex";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const YAHOO_CHART_RE = /query[12]\.finance\.yahoo\.com\/v8\/finance\/chart/;
const ER_API_RE = /open\.er-api\.com\/v6\/latest\/USD/;
const FRANKFURTER_RE = /api\.frankfurter\.dev/;

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

test("markets: er-api thiếu USDVND → success + meta.errors PARTIAL, không fake VND", async () => {
  stubFetch((url) => {
    if (ER_API_RE.test(url)) {
      // Có đủ 7 major + 4 cross (derive từ USD), NHƯNG thiếu VND
      return jsonResponse({
        result: "success",
        time_last_update_unix: Math.floor(Date.now() / 1000),
        base_code: "USD",
        rates: {
          EUR: 0.9208, GBP: 0.7896, JPY: 154.62, CHF: 0.8841,
          AUD: 1.5182, CAD: 1.3615, NZD: 1.6429,
        },
      });
    }
    // Biquote chưa cấu hình thì không fetch; Yahoo degrade để sang er-api
    if (YAHOO_CHART_RE.test(url)) return jsonResponse({ chart: { error: { code: "Not Found" } } }, 404);
    if (FRANKFURTER_RE.test(url)) return jsonResponse({ error: "unreachable" }, 502);
    return jsonResponse({ error: "unknown" }, 404);
  });
  try {
    const r = await getForexMarkets();
    assert.ok(r, "markets phải trả về khi er-api có subset");
    const got = r.data.rows.map((x) => x.pair);
    assert.ok(!got.includes("USDVND"), "không được fake rate cho USDVND");
    assert.ok(got.includes("EURUSD") && got.includes("USDJPY"), "major vẫn có");
    assert.equal(r.meta.partial, true, "subset → partial = true");
    assert.ok(
      Array.isArray(r.meta.errors) && r.meta.errors.some((e) => e.component === "quote" && e.message?.includes("USDVND")),
      "meta.errors phải liệt kê cặp thiếu USDVND",
    );
  } finally {
    restoreFetch();
  }
});

/**
 * REGRESSION — Forex: quote fail nhưng series OK → PARTIAL (Phase 6).
 * Trước: getForexDetail trả detail (current:null) → page vẫn render với giá
 * tham chiếu ECB. Test này khoá hành vi: không null, current null, series còn,
 * meta.partial + sections.quote=UNAVAILABLE.
 *
 * Chạy riêng process (cache/health breaker tách biệt với test file khác).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexDetail } from "../services/forex";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function frankfurterSeries(quote: string): unknown {
  const start = Date.now() - 40 * 86_400_000;
  const rates: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 40; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    rates[d] = { [quote]: 1.08 + i * 0.0001 };
  }
  return { amount: 1, base: "EUR", start_date: "x", end_date: "y", rates };
}

test("forex detail: quote fail + series OK → PARTIAL (current:null, series còn, không null)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("frankfurter")) return Promise.resolve(jsonResponse(frankfurterSeries("USD")));
    return Promise.reject(new Error("network down"));
  }) as typeof fetch;
  try {
    const r = await getForexDetail("EURUSD");
    assert.ok(r, "series OK → detail không null");
    assert.equal(r.detail.current, null, "quote unavailable");
    assert.ok(r.detail.series.length >= 30, "series tham chiếu ECB còn");
    assert.equal(r.meta.partial, true);
    assert.equal(r.meta.sections?.quote, "UNAVAILABLE");
    assert.equal(r.meta.sections?.chart, "FRESH");
  } finally {
    globalThis.fetch = orig;
  }
});

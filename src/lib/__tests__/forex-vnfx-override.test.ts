/**
 * REGRESSION — USD/VND phải thuộc domain Vietnam FX, không phụ thuộc provider FX:
 * khi Yahoo trả USDVND=26,054 nhưng Vietcombank công bố sell=26,255 → row
 * USDVND = 26,255 (provider `vietnam-fx`), meta.source vẫn Yahoo (trung thực).
 * Khoá hành vi user-visible của nâng cấp VN FX.
 * Chạy riêng process (cache module-level).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexMarkets } from "../services/forex";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const SQ_RE = /forex-data-feed\.swissquote\.com/;
const YAHOO_RE = /query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/([A-Z0-9.%]+)\?interval=1d&range=5d/;
const VCB_RE = /vietcombank\.com\.vn\/api\/exchangerates/;

const YAHOO_PRICES: Record<string, number> = {
  "EURUSD=X": 1.1621, "GBPUSD=X": 1.3517, "USDJPY=X": 156.22, "USDCHF=X": 0.809,
  "AUDUSD=X": 0.7205, "USDCAD=X": 1.3837, "NZDUSD=X": 0.5882,
  "EURJPY=X": 181.46, "EURGBP=X": 0.8587, "GBPJPY=X": 211.3, "AUDJPY=X": 112.54,
  "EURCHF=X": 0.9401, "EURAUD=X": 1.6125, "GBPCHF=X": 1.0938, "AUDCAD=X": 0.9965,
  "USDVND=X": 26054,
};

test("forex markets: Yahoo đủ 16 cặp nhưng USDVND bị ghi đè bởi Vietnam FX (VCB sell 26,255)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (SQ_RE.test(url)) return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    if (YAHOO_RE.test(url)) {
      const sym = decodeURIComponent(YAHOO_RE.exec(url)![1]);
      const price = YAHOO_PRICES[sym];
      if (price != null) {
        return Promise.resolve(
          jsonResponse({
            chart: {
              result: [{
                meta: {
                  symbol: sym,
                  regularMarketPrice: price,
                  previousClose: price * 0.999,
                  chartPreviousClose: price * 0.999,
                  regularMarketTime: Math.floor(Date.now() / 1000),
                  currency: sym.includes("JPY") ? "JPY" : "USD",
                },
              }],
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ chart: { error: { code: "Not Found" } } }, 200));
    }
    if (VCB_RE.test(url)) {
      return Promise.resolve(
        jsonResponse({
          Date: "2026-09-06T00:00:00",
          UpdatedDate: "2026-09-05T23:00:00+07:00",
          Data: [{ currencyCode: "USD", currencyName: "US DOLLAR", cash: "25845.00", transfer: "25875.00", sell: "26255.00" }],
        }),
      );
    }
    if (url.includes("data.vietnambiz.vn")) {
      return Promise.resolve(
        jsonResponse(
          `<table><tr><td>Chỉ tiêu</td><td>Kỳ công bố</td><td>Kỳ hiện tại</td><td>Kỳ trước</td></tr>` +
            `<tr><td>Tỷ giá trung tâm</td><td>Ngày 04/09/2026</td><td>25,605</td><td>25,615</td></tr></table>`,
        ),
      );
    }
    return Promise.resolve(jsonResponse({ error: "unreachable" }, 502));
  }) as typeof fetch;
  try {
    const r = await getForexMarkets();
    assert.ok(r);
    assert.equal(r.data.rows.length, 16, "7 major + 8 cross + USDVND");
    assert.match(r.meta.source ?? "", /yahoo/i, "Yahoo là nguồn thật (Swissquote fail)");
    const vnd = r.data.rows.find((x) => x.pair === "USDVND")!;
    assert.equal(vnd.price, 26255, "USDVND = VCB sell (ghi đè Yahoo 26,054)");
    assert.match(vnd.provider ?? "", /vietnam-fx/);
    assert.ok(r.data.vnFx, "model VN FX có trong payload");
    // các cặp mới vẫn hiện khi Yahoo có
    for (const pair of ["EURCHF", "EURAUD", "GBPCHF", "AUDCAD"]) {
      assert.ok(r.data.rows.some((x) => x.pair === pair), `${pair} phải có`);
    }
  } finally {
    globalThis.fetch = orig;
  }
});

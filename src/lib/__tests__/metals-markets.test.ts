/**
 * METALS MARKET — multi-source partial: Swissquote BBO trả XAU+XAG, Yahoo
 * reference chỉ có XAU → XPT/XPD UNAVAILABLE + meta.errors PARTIAL (không 502,
 * không số giả). Chạy riêng process (cache module-level).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getMetalsMarkets } from "../services/metals";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const SQ_RE = /forex-data-feed\.swissquote\.com\/public-quotes\/bboquotes\/instrument\/([A-Z]+)\/USD/;
const YAHOO_RE = /query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/([A-Z0-9.%]+)\?interval=1d&range=5d/;

function sqFixture(base: string, bid: number, ask: number, ts = 1788555600090): unknown {
  return [
    {
      topo: { platform: "SwissquoteLtd", server: "Live5" },
      spreadProfilePrices: [
        { spreadProfile: "premium", bid, ask },
        { spreadProfile: "elite", bid: bid, ask },
      ],
      ts,
    },
  ];
}

test("metals markets: Swissquote BBO partial + Yahoo reference → rows XAU/XAG, errors XPT/XPD", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (SQ_RE.test(url)) {
      const base = SQ_RE.exec(url)![1];
      if (base === "XAU") return Promise.resolve(jsonResponse(sqFixture("XAU", 4430.579, 4431.241)));
      if (base === "XAG") return Promise.resolve(jsonResponse(sqFixture("XAG", 31.842, 31.868)));
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }
    if (YAHOO_RE.test(url)) {
      const sym = decodeURIComponent(YAHOO_RE.exec(url)![1]);
      if (sym === "XAUUSD=X") {
        return Promise.resolve(
          jsonResponse({
            chart: {
              result: [{
                meta: {
                  symbol: sym,
                  regularMarketPrice: 4430.9,
                  previousClose: 4420.1,
                  regularMarketTime: Math.floor(Date.now() / 1000),
                  currency: "USD",
                },
              }],
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ chart: { error: { code: "Not Found" } } }, 404));
    }
    return Promise.resolve(jsonResponse({ error: "unknown" }, 404));
  }) as typeof fetch;
  try {
    const r = await getMetalsMarkets();
    assert.ok(r, "partial phải trả về, không null");
    const got = r.data.rows.map((x) => x.symbol).sort();
    assert.deepEqual(got, ["XAGUSD", "XAUUSD"]);
    const xau = r.data.rows.find((x) => x.symbol === "XAUUSD")!;
    assert.ok(Math.abs(xau.price - (4430.579 + 4431.241) / 2) < 1e-9, "price = mid BBO Swissquote");
    assert.equal(xau.bid, 4430.579);
    assert.equal(xau.ask, 4431.241);
    assert.equal(xau.changePercent, ((4430.9 - 4420.1) / 4420.1) * 100, "change từ Yahoo reference");
    assert.equal(xau.assetClass, "metal");
    assert.equal(r.meta.partial, true);
    assert.ok(
      Array.isArray(r.meta.errors) && r.meta.errors.some((e) => e.message?.includes("XPTUSD") && e.message?.includes("XPDUSD")),
      "errors liệt kê metals thiếu",
    );
    assert.match(r.meta.source ?? "", /swissquote-public/);
  } finally {
    globalThis.fetch = orig;
  }
});

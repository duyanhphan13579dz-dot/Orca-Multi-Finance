/**
 * FOREX CHAIN — Biquote chưa cấu hình; Swissquote BBO (public, DIRECT) trả
 * đầy đủ major+cross; VCB + VietnamBiz trả USD/VND → markets đủ 16 rows,
 * nguồn = swissquote-public, USDVND từ mô hình Vietnam FX (sell 26,255).
 * Chạy riêng process (cache module-level không ảnh hưởng file khác).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexMarkets, getForexDetail } from "../services/forex";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const SQ_RE = /forex-data-feed\.swissquote\.com\/public-quotes\/bboquotes\/instrument\/([A-Z]+)\/([A-Z]+)/;
const VCB_RE = /vietcombank\.com\.vn\/api\/exchangerates/;

const SQ_PRICES: Record<string, [number, number]> = {
  "EUR/USD": [1.16123, 1.16138],
  "GBP/USD": [1.31452, 1.31461],
  "USD/JPY": [154.623, 154.631],
  "USD/CHF": [0.88407, 0.88412],
  "AUD/USD": [0.65841, 0.65844],
  "USD/CAD": [1.36151, 1.36158],
  "NZD/USD": [0.60881, 0.60884],
  "EUR/JPY": [179.542, 179.549],
  "EUR/GBP": [0.88331, 0.88336],
  "GBP/JPY": [203.201, 203.208],
  "AUD/JPY": [101.771, 101.776],
  "EUR/CHF": [1.02663, 1.02669],
  "EUR/AUD": [1.76371, 1.76378],
  "GBP/CHF": [1.16211, 1.16217],
  "AUD/CAD": [0.89618, 0.89622],
};

test("forex markets: Swissquote BBO trực tiếp đủ 15 cặp FX + USDVND từ Vietnam FX", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (SQ_RE.test(url)) {
      const m = SQ_RE.exec(url)!;
      const key = `${m[1]}/${m[2]}`;
      const p = SQ_PRICES[key];
      if (p) {
        return Promise.resolve(
          jsonResponse([
            {
              topo: { platform: "SwissquoteLtd", server: "Live5" },
              spreadProfilePrices: [{ spreadProfile: "elite", bid: p[0], ask: p[1] }],
              ts: 1788555600090,
            },
          ]),
        );
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }
    if (VCB_RE.test(url)) {
      return Promise.resolve(
        jsonResponse({
          Date: "2026-09-04T00:00:00",
          UpdatedDate: "2026-09-04T23:00:00+07:00",
          Data: [{ currencyCode: "USD", currencyName: "US DOLLAR", cash: "25845.00", transfer: "25875.00", sell: "26255.00" }],
        }),
      );
    }
    if (url.includes("data.vietnambiz.vn")) {
      return Promise.resolve(
        jsonResponse(
          `<table><tr><td>Chỉ tiêu</td><td>Kỳ công bố</td><td>Kỳ hiện tại</td><td>Kỳ trước</td></tr>` +
            `<tr><td>Tỷ giá trung tâm</td><td>Ngày 04/09/2026</td><td>25,605</td><td>25,615</td></tr>` +
            `<tr><td>Tỷ giá USD NHTM bán ra</td><td>Ngày 04/09/2026</td><td>26,255</td><td>26,260</td></tr>` +
            `</table>`,
        ),
      );
    }
    return Promise.resolve(jsonResponse({ error: "unreachable" }, 502));
  }) as typeof fetch;
  try {
    const r = await getForexMarkets();
    assert.ok(r);
    assert.equal(r.data.rows.length, 16, "7 major + 8 cross + USDVND");
    assert.match(r.meta.source ?? "", /swissquote-public/);
    const eurusd = r.data.rows.find((x) => x.pair === "EURUSD")!;
    assert.ok(Math.abs(eurusd.price - (1.16123 + 1.16138) / 2) < 1e-9);
    assert.equal(eurusd.bid, 1.16123);
    assert.equal(eurusd.ask, 1.16138);
    const vnd = r.data.rows.find((x) => x.pair === "USDVND")!;
    assert.equal(vnd.price, 26255, "USDVND = VCB sell");
    assert.ok(r.data.vnFx, "vnFx model đi kèm");
    assert.equal(r.data.vnFx!.buyCash?.rate, 25845);
    assert.equal(r.data.vnFx!.reference?.rate, 25605);
    assert.equal(r.meta.partial, undefined, "đủ 16/16 → không partial");
  } finally {
    globalThis.fetch = orig;
  }
});

test("forex detail EURUSD: mọi thứ fail trừ Yahoo 1d OHLC → quote từ markets (Swissquote) + series thật", async () => {
  const orig = globalThis.fetch;
  const baseFetch = globalThis.fetch;
  // stub chi tiết riêng: reuse cùng logic chain + thêm chart 1d candles
  const start = Date.parse("2025-09-04T00:00:00Z");
  const DAY = 86_400_000;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (SQ_RE.test(url)) {
      const m = SQ_RE.exec(url)!;
      const key = `${m[1]}/${m[2]}`;
      const p = SQ_PRICES[key];
      if (p) return Promise.resolve(jsonResponse([{ topo: {}, spreadProfilePrices: [{ bid: p[0], ask: p[1] }], ts: 1788555600090 }]));
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }
    if (VCB_RE.test(url)) return Promise.resolve(jsonResponse({ Date: "2026-09-04", Data: [{ currencyCode: "USD", cash: "25845.00", transfer: "25875.00", sell: "26255.00" }] }));
    if (url.includes("data.vietnambiz.vn")) return Promise.resolve(jsonResponse("<table></table>"));
    if (/query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/([A-Z0-9.%]+)\?interval=1d&range=730d/.test(url)) {
      const count = 370;
      const ts: number[] = [];
      const o: number[] = []; const h: number[] = []; const l: number[] = []; const c: number[] = [];
      for (let i = 0; i < count; i++) {
        ts.push(start + i * DAY);
        const v = 1.08 + i * 0.0001;
        o.push(v); h.push(v + 0.001); l.push(v - 0.001); c.push(v);
      }
      return Promise.resolve(jsonResponse({ chart: { result: [{ meta: {}, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: ts.map(() => 1e6) }] } }] } }));
    }
    return Promise.resolve(jsonResponse({ error: "unreachable" }, 502));
  }) as typeof fetch;
  try {
    const r = await getForexDetail("EURUSD");
    assert.ok(r, "detail phải trả về");
    assert.ok(r.detail.current, "quote từ Swissquote chain");
    assert.ok(r.detail.series.length >= 300, "series = Yahoo 1d thật");
    assert.ok(r.detail.performance, "performance có");
    assert.ok(r.detail.performance!.d1 != null && r.detail.performance!.y1 != null);
    assert.ok(r.detail.technical, "technical trên nến thật");
    assert.match(r.meta.source ?? "", /yahoo-fx/);
  } finally {
    globalThis.fetch = baseFetch;
  }
});

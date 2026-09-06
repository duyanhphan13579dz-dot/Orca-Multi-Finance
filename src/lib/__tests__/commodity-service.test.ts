/**
 * COMMODITY SERVICE — nguồn DUY NHẤT data.vietnambiz.vn/goods (WiFeed).
 * Stub fetch trả đúng HTML bảng /goods (giá thật công bố 2026-09-06: vàng
 * 4,442.4 · SJC 147,600 nghìn đồng/lượng · nhôm 24,373 · kẽm 26,633 ·
 * WTI 91.22 · heo 57,833 · gạo TPXK 10,200 · hồ tiêu 137,000 · xăng 22.48/diesel 27.74
 * · đá 1x2 169,200 · PVC 4,835). Yahoo CHỈ dùng cho chart OHLC lịch sử.
 * Không mock — mọi số là giá WiFeed công bố.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getCommodityMarket, getCommodityHistory, getCommodityDetail, getCommodityCorrelation, getCommodityNews } from "../services/commodities";
import { clearCacheForTests } from "../cache";
import { getVnbGoodsQuotes } from "../providers/vietnambiz-data";
import { COMMODITY_CATALOG } from "../providers/commodities";

const date = (iso: string) => new Date(iso).toISOString();

function goodsHtml(): string {
  const row = (name: string, unit: string, price: string, d: string) =>
    `<tr><td>${name}<br>${unit}</td><td>${price}</td><td>--</td><td>--</td><td>--</td><td>${d}</td></tr>`;
  return `<table><tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
${row("Giá heo hơi trong nước", "Đồng/kg", "57,833", "04/09/2026")}
${row("Giá vàng", "USD/ounce", "4,442.4", "05/09/2026")}
${row("Giá vàng trong nước", "Đồng/lượng", "147,600", "05/09/2026")}
${row("Nhôm Trung Quốc", "CNY/tấn", "24,373", "05/09/2026")}
${row("Kẽm Trung Quốc", "CNY/tấn", "26,633", "05/09/2026")}
${row("Dầu WTI", "USD/thùng", "91.22", "05/09/2026")}
${row("Gạo TPXK", "Đồng/kg", "10,200", "27/08/2026")}
${row("Hồ tiêu", "Đồng/kg", "137,000", "05/09/2026")}
${row("Xăng sinh học E5 RON 92-II", "Nghìn/lít", "22.48", "04/09/2026")}
${row("Xăng Diezen", "Nghìn/lít", "27.74", "04/09/2026")}
${row("Đá 1x2", "Đồng/m3", "169,200", "01/07/2026")}
${row("Hạt nhựa PVC Trung Quốc", "CNY/tấn", "4,835", "06/09/2026")}
${row("Phụ phẩm lúa gạo", "Đồng/kg", "8,475", "27/08/2026")}
</table>`;
}

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

const origFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  // duy nhất data.vietnambiz.vn (goods) — mọi host khác fail → không fallback
  if (url.includes("data.vietnambiz.vn") && url.includes("/goods")) {
    return Promise.resolve(new Response(goodsHtml(), { status: 200, headers: { "content-type": "text/html" } }));
  }
  if (url.includes("finance.yahoo.com") && url.includes("/v8/finance/chart/")) {
    const m = url.match(/\/chart\/([^?]+)/);
    const sym = m ? decodeURIComponent(m[1]) : "GC=F";
    const body = yahooChartBody(sym, sym === "GC=F" ? 4442.4 : 100, sym === "GC=F" ? 4300 : 99);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }
  return Promise.resolve(new Response("nope", { status: 502 }));
}) as typeof fetch;

test("getCommodityMarket: 12/12 mục trong stub có row từ WiFeed, UNAVAILABLE rỗng", async () => {
  const r = await getCommodityMarket();
  assert.ok(r, "market resolve");
  const keys = r.data.rows.map((x) => x.id);
  for (const k of ["pig-vn", "gold", "sjc-gold", "aluminum", "zinc", "wti", "rice", "pepper", "gasoline-92", "diesel", "aggregate-1x2", "pvc", "rice-byproduct"]) {
    assert.ok(keys.includes(k), `row ${k}`);
  }
  // stub cung cấp 13/66 dòng → 53 mục UNAVAILABLE là HÀNH VI ĐÚNG (không fallback/bịa)
  assert.equal(r.data.rows.length, 13, "đúng 13 dòng stub khớp catalog");
  assert.equal(r.data.unavailable.length, COMMODITY_CATALOG.length - 13, "các mục chưa có trên /goods → UNAVAILABLE");
  assert.ok(r.data.unavailable.every((u) => /VietnamBiz|vietnambiz|Không có dòng/.test(u.reason)), "reason ghi rõ nguồn duy nhất");
  assert.ok(r.data.sourcesUsed.includes("VietnamBiz Data (WiFeed)"));
  assert.ok(!r.data.sourcesUsed.some((s) => /Simplize|Yahoo|Binance|MSN/i.test(s)), "chỉ WiFeed cho quote");
});

test("getCommodityMarket: giá trị + đơn vị + ngày cập nhật đúng như trang (không quy đổi, trừ SJC)", async () => {
  const r = await getCommodityMarket();
  assert.ok(r);
  const row = (k: string) => r.data.rows.find((x) => x.id === k)!;
  assert.equal(row("gold").price, 4_442.4);
  assert.equal(row("gold").unit, "USD/ounce");
  assert.equal(row("sjc-gold").price, 147_600_000, "SJC ×1000 — nghìn đồng/lượng → VNĐ");
  assert.equal(row("sjc-gold").unit, "Đồng/lượng");
  assert.equal(row("aluminum").price, 24_373);
  assert.equal(row("aluminum").unit, "CNY/tấn");
  assert.equal(row("aluminum").currency, "CNY");
  assert.equal(row("zinc").price, 26_633);
  assert.equal(row("wti").price, 91.22);
  assert.equal(row("wti").unit, "USD/thùng");
  assert.equal(row("rice").price, 10_200);
  assert.equal(row("pepper").price, 137_000);
  assert.equal(row("gasoline-92").price, 22.48);
  assert.equal(row("diesel").price, 27.74);
  assert.equal(row("aggregate-1x2").price, 169_200);
  assert.equal(row("pvc").price, 4_835);
  assert.equal(row("rice-byproduct").price, 8_475);
  // freshness: ngày công bố 05/09/2026 → không bao giờ UNAVAILABLE/LIVE (dữ liệu ngày)
  const fr = row("gold").freshness;
  assert.ok(fr != null && ["FRESH", "DELAYED", "STALE"].includes(fr), fr ?? "none");
  assert.equal(row("gold").sourceTimestamp, date("2026-09-05T00:00:00+07:00"));
  assert.ok(row("gold").sourceRecords[0].source.includes("VietnamBiz Data"));
  assert.match(row("gold").sourceUrl ?? "", /data\.vietnambiz\.vn\/goods/);
});

test("getCommodityDetail: resolve def + row + market/unit/subgroup cho hàng mới (hồ tiêu)", async () => {
  const d = await getCommodityDetail("pepper");
  assert.ok(d);
  assert.equal(d.def.key, "pepper");
  assert.equal(d.row?.price, 137_000);
  assert.equal(d.row?.group, "consumer");
});

test("getCommodityDetail: unknown key → null (route 400), không đoán row", async () => {
  assert.equal(await getCommodityDetail("definitely-not-real-xyz"), null);
});

test("getCommodityHistory: CHỈ Yahoo futures OHLC cho mục có chart (gold GC=F); mục khác null", async () => {
  const h = await getCommodityHistory("gold", { timeframe: "1d", limit: 100 });
  assert.ok(h);
  assert.equal(h.symbol, "GOLD");
  assert.equal(h.priceType, "OHLC");
  assert.ok(h.points.length > 0);
  assert.ok(h.points.every((p) => p.close > 0 && p.source === "Yahoo Finance (futures)"));
  // mục không có futures (hồ tiêu) → không bịa chart
  assert.equal(await getCommodityHistory("pepper", { timeframe: "1d" }), null);
});

test("intelligence: correlation INSUFFICIENT_DATA (stub 2 điểm, không bịa); news keyword basis", async () => {
  const c = await getCommodityCorrelation("wti");
  assert.ok(c);
  assert.equal(c.benchmark, "^VNINDEX");
  assert.equal(c.correlation.status, "INSUFFICIENT_DATA");
  assert.equal(c.correlation.r, null);
  const n = await getCommodityNews("wti");
  assert.ok(n);
  assert.equal(n.basis, "keyword-match");
  assert.equal(n.articles.length, 0); // RSS không chạy trong stub → không bịa tin
});

test("crash-safety: WiFeed down → provider throw; market resolve với 66 UNAVAILABLE (không throw, không giả)", async () => {
  clearCacheForTests();
  globalThis.fetch = (() => Promise.resolve(new Response("down", { status: 503 }))) as typeof fetch;
  await assert.rejects(() => getVnbGoodsQuotes(), /vietnambiz-data/);
  const r = await getCommodityMarket();
  assert.ok(r, "market resolve — không throw");
  assert.equal(r.data.rows.length, 0);
  assert.equal(r.data.unavailable.length, COMMODITY_CATALOG.length);
  assert.ok(r.data.unavailable.every((u) => /VietnamBiz|vietnambiz/.test(u.reason)), "không bịa fallback");
  assert.ok(r.data.errors.some((e) => e.includes("vietnambiz-data")));
  globalThis.fetch = origFetch;
  clearCacheForTests();
});

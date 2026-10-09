import test from "node:test";
import assert from "node:assert/strict";

type FetchFn = typeof fetch;
const realFetch: FetchFn = globalThis.fetch;

const GROUPS = {
  nang_luong: [{ title: "Dầu WTI", value: 90.36, unit: "USD/thùng", value_d: 1.2, time_update: "09/10/2026" }],
  kim_loai_phi_kim: [{ title: "Giá vàng", value: 4183.37, unit: "USD/ounce", value_d: null, time_update: "09/10/2026" }],
};
const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  buildId: "BUILD1",
  props: { pageProps: { data: GROUPS } },
})}</script></html>`;

test("goods: lần đầu chỉ 1 request HTML (lấy cả dữ liệu lẫn buildId), lần sau đi đường JSON nhỏ", async () => {
  const { fetchVietnambizGoods, __resetVnbBuildId } = await import("../providers/commodities");
  __resetVnbBuildId();
  const urls: string[] = [];
  globalThis.fetch = (async (u: unknown) => {
    const url = String(u);
    urls.push(url);
    if (url.includes("/_next/data/")) return new Response(JSON.stringify({ pageProps: { data: GROUPS } }), { status: 200 });
    return new Response(html, { status: 200 });
  }) as FetchFn;
  try {
    const first = await fetchVietnambizGoods();
    assert.equal(first.path, "html");
    assert.equal(first.items.length, 2);
    assert.equal(first.buildId, "BUILD1");
    assert.equal(urls.length, 1, "chỉ một request cho lần đầu");

    const second = await fetchVietnambizGoods();
    assert.equal(second.path, "next-data");
    assert.equal(urls.length, 2);
    assert.match(urls[1], /_next\/data\/BUILD1\/goods\.json/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("goods: buildId cũ (404) tự rơi về HTML và lấy buildId mới", async () => {
  const { fetchVietnambizGoods, __resetVnbBuildId } = await import("../providers/commodities");
  __resetVnbBuildId();
  globalThis.fetch = (async (u: unknown) => {
    const url = String(u);
    if (url.includes("/_next/data/")) return new Response("nf", { status: 404 });
    return new Response(html, { status: 200 });
  }) as FetchFn;
  try {
    const snap = await fetchVietnambizGoods("OLDBUILD");
    assert.equal(snap.path, "html");
    assert.equal(snap.buildId, "BUILD1");
  } finally {
    globalThis.fetch = realFetch;
  }
});

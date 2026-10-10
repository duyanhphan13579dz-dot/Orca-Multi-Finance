import test from "node:test";
import assert from "node:assert/strict";

type FetchFn = typeof fetch;
const realFetch: FetchFn = globalThis.fetch;

test("mapVndNewsRow: chuẩn hoá trường, giờ VN → ISO, link rơi về trang dstock khi thiếu", async () => {
  const { mapVndNewsRow, vndNewsTime } = await import("../providers/vndirect-news");
  assert.equal(vndNewsTime("2026-10-09", "14:05:00"), "2026-10-09T07:05:00.000Z");
  assert.equal(vndNewsTime("bad", null), null);
  const a = mapVndNewsRow("GAS", { newsId: 7, newsTitle: "GAS công bố KQKD", newsDate: "2026-10-09", newsTime: "08:00:00", newsSource: "VNDirect" });
  assert.ok(a);
  assert.equal(a.id, "vnd-7");
  assert.equal(a.url, "https://dstock.vndirect.com.vn/tin-tuc-ma/GAS");
  assert.deepEqual(a.symbols, ["GAS"]);
  assert.equal(mapVndNewsRow("GAS", { newsDate: "2026-10-09" }), null);
});

test("getVndCompanyNews: gọi /v4/news đúng truy vấn mã và lọc dòng lỗi", async () => {
  const { getVndCompanyNews } = await import("../providers/vndirect-news");
  const urls: string[] = [];
  globalThis.fetch = (async (u: unknown) => {
    urls.push(String(u));
    return new Response(
      JSON.stringify({ data: [{ newsId: 1, newsTitle: "Tin A", newsDate: "2026-10-09", newsTime: "09:00:00" }, { foo: 1 }] }),
      { status: 200 },
    );
  }) as FetchFn;
  try {
    const items = await getVndCompanyNews("gas", 10);
    assert.equal(items.length, 1);
    assert.match(urls[0], /\/v4\/news\?q=newsType:company_news~locale:VN~code:GAS/);
    assert.match(urls[0], /size=10/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("getVndCompanyNews: host chính trả 500 → rơi sang host dự phòng", async () => {
  const { getVndCompanyNews } = await import("../providers/vndirect-news");
  const hosts: string[] = [];
  globalThis.fetch = (async (u: unknown) => {
    const url = new URL(String(u));
    hosts.push(url.host);
    if (url.host === "api-finfo.vndirect.com.vn") return new Response("x", { status: 500 });
    return new Response(JSON.stringify({ data: [{ newsId: 2, newsTitle: "Tin B", newsDate: "2026-10-08" }] }), { status: 200 });
  }) as FetchFn;
  try {
    const items = await getVndCompanyNews("VNM", 5);
    assert.equal(items.length, 1);
    assert.ok(hosts.includes("finfo-api.vndirect.com.vn"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

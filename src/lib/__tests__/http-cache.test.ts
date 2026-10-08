import test from "node:test";
import assert from "node:assert/strict";

process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

type FetchFn = typeof fetch;
const realFetch: FetchFn = globalThis.fetch;
const restore = () => {
  globalThis.fetch = realFetch;
};

test("httpJson: các GET giống hệt chạy song song chỉ gọi upstream một lần", async () => {
  const { httpJson } = await import("../http");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return new Response(JSON.stringify({ a: 1 }), { status: 200 });
  }) as FetchFn;
  try {
    const [x, y, z] = await Promise.all([
      httpJson("https://x.test/q", { provider: "t-coalesce" }),
      httpJson("https://x.test/q", { provider: "t-coalesce" }),
      httpJson("https://x.test/q", { provider: "t-coalesce" }),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual([x.ok, y.ok, z.ok], [true, true, true]);
  } finally {
    restore();
  }
});

test("httpJson: 503 được thử lại và thành công ở lần 2", async () => {
  const { httpJson } = await import("../http");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1 ? new Response("busy", { status: 503 }) : new Response("{\"ok\":true}", { status: 200 });
  }) as FetchFn;
  try {
    const r = await httpJson("https://x.test/retry", { provider: "t-retry", backoffBaseMs: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);
  } finally {
    restore();
  }
});

test("httpJson: 404 lặp lại không mở circuit breaker của provider", async () => {
  const { httpJson } = await import("../http");
  const { isCircuitOpen } = await import("../health");
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as FetchFn;
  try {
    for (let i = 0; i < 12; i++) {
      const r = await httpJson(`https://x.test/missing/${i}`, { provider: "t-404" });
      assert.equal(r.status, 404);
    }
    assert.equal(isCircuitOpen("t-404"), false);
  } finally {
    restore();
  }
});

test("cached: isolate lạnh đọc được bản mirror Upstash, không gọi lại producer", async () => {
  const store = new Map<string, string>();
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const cmd = JSON.parse(String(init?.body)) as unknown[];
    const [op, key, value] = cmd as [string, string, string];
    if (op === "SET") {
      store.set(key, value);
      return new Response(JSON.stringify({ result: "OK" }));
    }
    if (op === "GET") return new Response(JSON.stringify({ result: store.get(key) ?? null }));
    return new Response(JSON.stringify({ result: 1 }));
  }) as FetchFn;
  try {
    const { cached, clearMemoryCache } = await import("../cache");
    let produced = 0;
    const opts = { ttlMs: 60_000, staleMs: 120_000, producer: async () => ({ n: ++produced }) };
    const first = await cached("t:cold", opts);
    assert.equal(first.cached, false);
    await new Promise((r) => setTimeout(r, 20)); // cho mirrorSet nền chạy xong
    assert.ok([...store.keys()].some((k) => k.endsWith("t:cold")), "mirror phải được ghi");

    clearMemoryCache(); // mô phỏng isolate mới
    const second = await cached("t:cold", opts);
    assert.equal(second.cached, true);
    assert.equal(produced, 1);
    assert.deepEqual(second.value, { n: 1 });
  } finally {
    restore();
  }
});

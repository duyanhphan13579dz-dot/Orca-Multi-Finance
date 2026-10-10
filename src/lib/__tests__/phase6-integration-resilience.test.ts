import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Phase 6: Integration, Security & Resilient Provider Failover", () => {
  it("safeApi: returns 200 envelope on normal produce", async () => {
    const { safeApi } = await import("../safe-api");
    const res = await safeApi({
      label: "test-produce-ok",
      produce: async () => ({
        data: { price: 25000, symbol: "VCB" },
        meta: { source: "ssi" } as any,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { price: 25000, symbol: "VCB" });
    assert.equal(body.meta.source, "ssi");
  });

  it("safeApi: triggers fallback gracefully when primary producer throws an error", async () => {
    const { safeApi } = await import("../safe-api");
    const res = await safeApi({
      label: "test-producer-throw",
      produce: async () => {
        throw new Error("SSI connection 500 error");
      },
      fallback: async () => ({
        data: { price: 24800, symbol: "VCB" },
        meta: { source: "vndirect-cache" } as any,
      }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Orca-Mode"), "error-fallback");
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { price: 24800, symbol: "VCB" });
    assert.equal(body.meta.partial, true);
    assert.equal(body.meta.stale, true);
  });

  it("safeApi: returns honest unavailable envelope (502) when both primary and fallback fail", async () => {
    const { safeApi } = await import("../safe-api");
    const res = await safeApi({
      label: "test-all-failed",
      produce: async () => {
        throw new Error("upstream timeout");
      },
      fallback: async () => null,
      unavailableSource: "all-providers",
      unavailableNote: "Tất cả các nguồn dữ liệu đang gián đoạn",
    });

    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(body.error.message, "Tất cả các nguồn dữ liệu đang gián đoạn");
  });

  it("source-race: settleSource resolves value and measures latency on success", async () => {
    const { settleSource } = await import("../resilience/source-race");
    const settled = await settleSource({
      id: "primary-src",
      run: async () => ({ value: 123 }),
      timeoutMs: 1000,
    });

    assert.equal(settled.id, "primary-src");
    assert.equal(settled.ok, true);
    assert.deepEqual(settled.value, { value: 123 });
    assert.ok(settled.latencyMs >= 0);
  });

  it("source-race: settleSource catches errors without crashing and returns ok:false", async () => {
    const { settleSource } = await import("../resilience/source-race");
    const settled = await settleSource({
      id: "failing-src",
      run: async () => {
        throw new Error("HTTP 503 Bad Gateway");
      },
      timeoutMs: 1000,
    });

    assert.equal(settled.id, "failing-src");
    assert.equal(settled.ok, false);
    assert.equal(settled.value, null);
    assert.match(settled.error ?? "", /503/);
  });

  it("source-race: pickByPriority selects first available source matching priority order", async () => {
    const { pickByPriority } = await import("../resilience/source-race");
    const mockSettled = [
      { id: "public-feed", ok: true, value: { name: "public" }, latencyMs: 50 },
      { id: "ssi", ok: false, value: null, latencyMs: 300, error: "timeout" },
      { id: "vndirect", ok: true, value: { name: "vndirect" }, latencyMs: 120 },
    ];

    const chosen = pickByPriority(mockSettled, ["ssi", "vndirect", "public-feed"]);
    assert.equal(chosen?.id, "vndirect");
    assert.deepEqual(chosen?.value, { name: "vndirect" });
  });

  it("source-race: mergeIndexQuotes combines partial quotes with source precedence", async () => {
    const { mergeIndexQuotes } = await import("../resilience/source-race");
    const batches = [
      {
        source: "vndirect",
        items: [
          { code: "VNINDEX", name: "VN-Index", change: 5.2, changePercent: 0.4, value: 1250.5 } as any,
          { code: "VN30", name: "VN30", change: 3.1, changePercent: 0.25, value: 1310.2 } as any,
        ],
      },
      {
        source: "ssi",
        items: [
          { code: "VNINDEX", name: "VN-Index Primary", change: 5.5, changePercent: 0.42, volume: 15000000 } as any,
        ],
      },
    ];

    const merged = mergeIndexQuotes(batches, ["ssi", "vndirect"]);
    const vnIndex = merged.find((m) => m.code === "VNINDEX");
    assert.ok(vnIndex);
    assert.equal(vnIndex?.name, "VN-Index Primary"); // ssi priority
    assert.equal(vnIndex?.change, 5.5);
    assert.equal(vnIndex?.value, 1250.5); // merged from vndirect
    assert.equal(vnIndex?.volume, 15000000); // from ssi
  });

  it("envelope: standard response helpers ok, badRequest, notFound, unavailable", async () => {
    const { ok, badRequest, notFound, unavailable } = await import("../envelope");

    const okRes = ok({ status: "alive" });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.success, true);
    assert.equal(okBody.data.status, "alive");

    const brRes = badRequest("Tham số symbol không hợp lệ");
    assert.equal(brRes.status, 400);
    const brBody = await brRes.json();
    assert.equal(brBody.success, false);
    assert.equal(brBody.error.code, "BAD_REQUEST");

    const nfRes = notFound("Không tìm thấy mã");
    assert.equal(nfRes.status, 404);
    const nfBody = await nfRes.json();
    assert.equal(nfBody.success, false);
    assert.equal(nfBody.error.code, "NOT_FOUND");

    const unRes = unavailable("vietcap", "Nguồn Vietcap bảo trì");
    assert.equal(unRes.status, 502);
    const unBody = await unRes.json();
    assert.equal(unBody.success, false);
    assert.equal(unBody.error.code, "UPSTREAM_UNAVAILABLE");
  });

  it("security: cron auth enforces secret in production and rejects unauthorized requests", async () => {
    const { cronUnauthorized } = await import("../cron-auth");
    const oldEnv = process.env.NODE_ENV;
    const oldSecret = process.env.CRON_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      (process.env as Record<string, string | undefined>).CRON_SECRET = "super-secret-key-123";

      // 1. Missing header/query
      const unauth1 = cronUnauthorized(new Request("https://app.test/api/v1/cron/sync"));
      assert.equal(unauth1?.status, 401);

      // 2. Wrong secret
      const unauth2 = cronUnauthorized(new Request("https://app.test/api/v1/cron/sync?secret=wrong"));
      assert.equal(unauth2?.status, 401);

      // 3. Valid bearer token
      const authBearer = cronUnauthorized(
        new Request("https://app.test/api/v1/cron/sync", {
          headers: { authorization: "Bearer super-secret-key-123" },
        }),
      );
      assert.equal(authBearer, null);

      // 4. Valid query param
      const authQuery = cronUnauthorized(
        new Request("https://app.test/api/v1/cron/sync?secret=super-secret-key-123"),
      );
      assert.equal(authQuery, null);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = oldEnv;
      (process.env as Record<string, string | undefined>).CRON_SECRET = oldSecret;
    }
  });

  it("workers-guard: subrequest cap and wall budget are protected", async () => {
    const { budgetLeftMs, tryAcquireSubrequest } = await import("../data-engine/workers-guard");

    // Outside guarded scope, budgetLeftMs defaults to safe default
    const ms = budgetLeftMs();
    assert.ok(ms > 0 && ms <= 8000);

    // tryAcquireSubrequest without active guard returns true
    const ok = tryAcquireSubrequest(1);
    assert.equal(ok, true);
  });
});

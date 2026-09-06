/**
 * REGRESSION — Route API /api/v1/forex/[symbol] luôn trả JSON an toàn (Phase 6).
 *
 * Bất kể provider trạng thái nào, route không bao giờ trả HTML/throw:
 *  - partial/OK → `{success:true, data:{...}, meta}` (freshness có thể PARTIAL)
 *  - total fail  → `{success:false, error:{code:"UPSTREAM_UNAVAILABLE"}}` 502
 */
import test from "node:test";
import assert from "node:assert/strict";

// Route handler không thể import trực tiếp (NextRequest/AI SDK heavy) — kiểm tra
// hợp đồng envelope + service ở file separate; ở đây verify `unavailable()`
// thực sự là JSON 502 không phải HTML — đây là rào an toàn cuối cho UI.
import { unavailable, ok, badRequest } from "../envelope";

test("envelope: unavailable() → 502 JSON (content-type json, không HTML)", () => {
  const res = unavailable("forex-providers", "Không lấy được dữ liệu EURUSD (Biquote/ECB).");
  assert.equal(res.status, 502);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.ok(!((res.headers.get("content-type") ?? "").includes("text/html")));
});

test("envelope: ok() giữ nguyên data + meta (partial flag được pass qua)", async () => {
  const data = { pair: "EURUSD", current: null, series: [], technical: null, referenceNote: "x" };
  const meta = { freshness: "STALE" as const, source: "frankfurter-ecb", sourceTimestamp: null, ingestedAt: new Date().toISOString(), cached: false, stale: false, partial: true };
  const res = ok(data, meta);
  const body = (await res.json()) as { success: boolean; data: unknown; meta: { partial?: boolean } };
  assert.equal(body.success, true);
  assert.deepEqual(body.data, data);
  assert.equal(body.meta.partial, true);
});

test("envelope: badRequest → 400 JSON (không HTML)", () => {
  const res = badRequest("Cặp tỷ giá phải dạng 6 ký tự, ví dụ EURUSD");
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /json/);
});

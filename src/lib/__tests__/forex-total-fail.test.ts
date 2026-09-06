/**
 * REGRESSION — Forex tất cả provider fail (Phase 6).
 *
 * Mọi provider (Yahoo FX snapshot → ER-API → Frankfurter series) đều down:
 *  - getForexMarkets → null; getForexDetail → null
 *  - route /api/v1/forex/[symbol] trả `unavailable()` = HTTP 502 JSON
 *    `{ success:false, error:{code:"UPSTREAM_UNAVAILABLE"} , meta:{...} }`
 *    (KHÔNG phải HTML, KHÔNG throw) → client `useApi` được `data=null` →
 *    ForexDetailPage render `Unavailable` — page KHÔNG crash.
 *
 * Chạy riêng process (node --test spawn mỗi file 1 process) để cache/health
 * breaker không ảnh hưởng test file khác.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getForexDetail } from "../services/forex";

test("forex detail: tất cả provider fail → null (route 502 JSON an toàn, không HTML)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const r = await getForexDetail("EURUSD");
    assert.equal(r, null, "total failure → null → route `unavailable()` → 502 JSON");
  } finally {
    globalThis.fetch = orig;
  }
});

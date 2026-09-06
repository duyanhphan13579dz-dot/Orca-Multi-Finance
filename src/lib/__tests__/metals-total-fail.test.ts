/**
 * METALS — TẤT CẢ provider fail → getMetalsMarkets/getMetalDetail trả null
 * (route trả unavailable 502 JSON an toàn), không throw, không số giả.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getMetalsMarkets, getMetalDetail } from "../services/metals";

test("metals: mọi provider down → markets null, detail null (route 502 an toàn)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    assert.equal(await getMetalsMarkets(), null);
    assert.equal(await getMetalDetail("XAUUSD"), null);
  } finally {
    globalThis.fetch = orig;
  }
});

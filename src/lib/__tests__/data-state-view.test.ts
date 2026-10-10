import assert from "node:assert/strict";
import test from "node:test";
import { resolveDataState } from "../../components/data-state-view";

test("resolveDataState: accurately determines all 7 standardized states", () => {
  // 1. Loading
  assert.equal(
    resolveDataState({ isLoading: true, hasData: false }),
    "loading",
  );

  // 2. Error
  assert.equal(
    resolveDataState({ error: new Error("Network offline"), hasData: false }),
    "error",
  );

  // 3. Unavailable
  assert.equal(
    resolveDataState({ hasData: false }),
    "unavailable",
  );

  // 4. Empty
  assert.equal(
    resolveDataState({ hasData: true, isEmpty: true }),
    "empty",
  );

  // 5. Delayed
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", freshness: "DELAYED" } }),
    "delayed",
  );

  // 6. Stale
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", freshness: "STALE" } }),
    "stale",
  );
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", stale: true } }),
    "stale",
  );

  // 7. Degraded
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", degraded: true } }),
    "degraded",
  );
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", partial: true } }),
    "degraded",
  );

  // 8. Fresh / Loaded
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", freshness: "LIVE" } }),
    "fresh",
  );
  assert.equal(
    resolveDataState({ hasData: true, meta: { source: "vndirect", freshness: "FRESH" } }),
    "fresh",
  );
});

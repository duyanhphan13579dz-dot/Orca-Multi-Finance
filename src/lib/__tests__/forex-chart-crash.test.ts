/**
 * REGRESSION — "Failed to load page" trên Forex (Phase 6).
 *
 * ROOT CAUSE (đã chứng minh):
 *   `useApi<T>` unwrap envelope `{success, data, meta}` → trả về `data` =
 *   `ChartMarketData`. Chart component khai báo `HistResp {data, meta}` và đọc
 *   `data.data.candles` → `ChartMarketData.data` = `undefined` →
 *   TypeError: Cannot read properties of undefined (reading 'candles') trong
 *   useEffect → React ErrorBoundary → "Failed to load page".
 *
 * Test 1 tái hiện lỗi cũ (assert throws). Các test còn lại kiểm tra fix
 * `normalizeChartPayload` — không bao giờ throw; payload lỗi → null → UI
 * "no data" render bình thường.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ChartMarketData } from "../services/chart";
import { normalizeChartPayload } from "../../chart/payload";

const CHART_PAYLOAD: ChartMarketData = {
  candles: [{ time: 1_700_000_000_000, open: 1.08, high: 1.09, low: 1.07, close: 1.085, volume: 0 }],
  indicators: null,
  markers: [],
  intervalMs: 3_600_000,
  gaps: 0,
  suspect: 0,
};

test("root cause: useApi-unwrapped payload + old `data.data` access → TypeError", () => {
  // Server: ok(r.data, r.meta) → body.data = ChartMarketData (KHÔNG lồng)
  const body = { success: true, data: CHART_PAYLOAD, meta: { freshness: "FRESH", source: "x", sourceTimestamp: "2026-01-01T00:00:00Z" } };
  // useApi unwrap (src/lib/hooks.ts): `data: data?.success ? data.data : null`
  const data = body.success ? body.data : null;
  // OLD component code path (HistResp): `const d = data.data` → undefined
  const d: unknown = (data as { data?: unknown }).data;
  assert.equal(d, undefined);
  assert.throws(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(d as any).candles.length) return;
  }, TypeError);
});

test("fix: unwrapped ChartMarketData → normalized, no throw, candles intact", () => {
  const out = normalizeChartPayload(CHART_PAYLOAD);
  assert.ok(out);
  assert.equal(out.candles.length, 1);
  assert.equal(out.candles[0].close, 1.085);
  assert.equal(out.intervalMs, 3_600_000);
});

test("fix: legacy nested {data, meta} shape → still normalized (defensive)", () => {
  const out = normalizeChartPayload({ data: CHART_PAYLOAD, meta: { freshness: "FRESH" } });
  assert.ok(out);
  assert.equal(out.candles.length, 1);
});

test("fix: null/undefined/malformed/NaN → null (never throws, chart shows no-data UI)", () => {
  assert.equal(normalizeChartPayload(null), null);
  assert.equal(normalizeChartPayload(undefined), null);
  assert.equal(normalizeChartPayload("garbage"), null);
  assert.equal(normalizeChartPayload({ candles: "nope" }), null);
  assert.equal(normalizeChartPayload({ candles: [{ time: 1, open: NaN, high: 2, low: 1, close: 1.5 }] }), null);
  assert.equal(normalizeChartPayload({ candles: [{ time: 1, open: 1, high: 2, low: 0, close: 1.5 }] }), null);
  assert.equal(normalizeChartPayload({ candles: [], indicators: null, markers: [] }), null);
});

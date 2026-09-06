import type { ChartMarketData } from "@/lib/services/chart";

/**
 * Chart payload normalization (Phase 6 — "Failed to load page" fix).
 *
 * ROOT CAUSE: `useApi<T>` already unwraps the API envelope
 * (`{ success, data, meta }` → returns `data`), so consumers receive
 * `ChartMarketData` directly. `OrcaFinancialChart` incorrectly typed the
 * hook result as `HistResp = { data: ChartMarketData; meta: Meta }` and read
 * `data.data.candles` → `ChartMarketData.data` is `undefined` →
 * `TypeError: Cannot read properties of undefined (reading 'candles')`
 * thrown inside a `useEffect` → React error boundary → "Failed to load page".
 *
 * This normalizer is the single place that resolves the wire payload into a
 * validated `ChartMarketData`, tolerating BOTH the current unwrapped shape
 * and any legacy nested shape. It never throws and never returns a partial
 * malformed object — the chart simply shows its existing "no data" state.
 */

export function normalizeChartPayload(payload: unknown): ChartMarketData | null {
  if (!payload || typeof payload !== "object") return null;

  // Shape A (current contract): already-unwrapped ChartMarketData
  if (Array.isArray((payload as { candles?: unknown }).candles)) {
    const p = payload as ChartMarketData;
    const ok = p.candles.length > 0 &&
      p.candles.every((c) =>
        c &&
        Number.isFinite(c.time) && c.time > 0 &&
        Number.isFinite(c.open) && c.open > 0 &&
        Number.isFinite(c.high) && c.high > 0 &&
        Number.isFinite(c.low) && c.low > 0 &&
        Number.isFinite(c.close) && c.close > 0 &&
        c.high >= c.low,
      );
    return ok ? p : null;
  }

  // Shape B (legacy/defensive): nested { data: ChartMarketData, meta }
  const nested = (payload as { data?: unknown }).data;
  if (nested && typeof nested === "object" && Array.isArray((nested as { candles?: unknown }).candles)) {
    return normalizeChartPayload(nested);
  }

  return null;
}

/** True when the payload is shape-A safe for this component (no double-unwrap). */
export function isUnwrappedChartPayload(payload: unknown): boolean {
  return Boolean(payload) && Array.isArray((payload as { candles?: unknown }).candles);
}

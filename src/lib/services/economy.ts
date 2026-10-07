import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { fetchVietnambizEconomy } from "../providers/vietnambiz-economy";
import type { EconomicDataset, EconomicSnapshot } from "../economic-data";
import type { Meta } from "../types";

export const ECONOMIC_CACHE_KEYS: Record<EconomicDataset, string> = {
  "macro-economic": "economy:vietnambiz:macro-economic:v1",
  "currency-interest-rate": "economy:vietnambiz:currency-interest-rate:v1",
};
export const ECONOMIC_TTL_MS = 15 * 60_000;
export const ECONOMIC_STALE_MS = 24 * 60 * 60_000;

/**
 * Periodic publications (not live quotes). Source does not supply exact publication
 * timestamps — FRESH/STALE describe retrieval freshness only, explained in meta.note.
 */
export function economicMeta(
  snapshot: EconomicSnapshot,
  cache: { cached: boolean; stale: boolean },
  latencyMs: number,
): Meta {
  const fetchedMs = Date.parse(snapshot.fetchedAt);
  const meta = buildMeta({
    source: "VietnamBiz Data",
    // Use retrieval time only for cache SLA — never present as market timestamp in UI copy.
    sourceTimestampMs: Number.isFinite(fetchedMs) ? fetchedMs : null,
    hasData: snapshot.rows.length > 0,
    degraded: snapshot.warnings.length > 0,
    cached: cache.cached,
    stale: cache.stale,
    latencyMs,
    partial: snapshot.warnings.length > 0,
    note: "Trạng thái thể hiện độ mới lần đồng bộ, không phải kỳ số liệu. Nguồn không cung cấp thời điểm công bố chính xác; xem kỳ công bố tại từng chỉ tiêu.",
    slas: {
      liveSlaMs: -1,
      freshSlaMs: ECONOMIC_TTL_MS,
      delayedSlaMs: ECONOMIC_TTL_MS,
    },
  });
  return {
    ...meta,
    qualityStatus: cache.stale
      ? "STALE"
      : snapshot.warnings.length
        ? "SUSPECT"
        : "VALID",
  };
}

/** On-demand only: no calls from market snapshots, the ticker, reports, agents or cron. */
export async function getEconomicData(
  dataset: EconomicDataset,
): Promise<{ data: EconomicSnapshot; meta: Meta } | null> {
  try {
    const result = await cached(ECONOMIC_CACHE_KEYS[dataset], {
      ttlMs: ECONOMIC_TTL_MS,
      staleMs: ECONOMIC_STALE_MS,
      producer: () => fetchVietnambizEconomy(dataset),
    });
    return {
      data: result.value.data,
      meta: economicMeta(result.value.data, result, result.value.latencyMs),
    };
  } catch {
    return null;
  }
}

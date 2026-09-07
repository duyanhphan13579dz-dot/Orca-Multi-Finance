import "server-only";
import { cached } from "../cache";
import { computeFreshness } from "../freshness";
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
 * These are periodic publications, NOT live quotes. The source supplies periods
 * (including old annual data/policy-rate decisions), not exact publication timestamps.
 * Keep sourceTimestamp/ageMs null; FRESH describes retrieval freshness ONLY, explicitly
 * explained in the UI/meta. Never substitute fetch time for source time or label LIVE.
 */
export function economicMeta(snapshot: EconomicSnapshot, cache: { cached: boolean; stale: boolean }, latencyMs: number): Meta {
  const syncFreshness = computeFreshness(Date.parse(snapshot.fetchedAt), {
    hasData: snapshot.rows.length > 0,
    liveSlaMs: -1,
    freshSlaMs: ECONOMIC_TTL_MS,
    delayedSlaMs: ECONOMIC_TTL_MS,
    degraded: snapshot.warnings.length > 0,
  }).status;
  const stale = cache.stale || syncFreshness === "STALE";
  return {
    source: "VietnamBiz Data · CTCP WiGroup",
    sourceTimestamp: null,
    providerReceivedAt: snapshot.fetchedAt,
    ingestedAt: snapshot.fetchedAt,
    freshness: stale ? "STALE" : syncFreshness,
    ageMs: null,
    cached: cache.cached,
    stale,
    latencyMs,
    qualityStatus: stale ? "STALE" : snapshot.warnings.length ? "SUSPECT" : "VALID",
    partial: snapshot.warnings.length > 0,
    note: "Trạng thái thể hiện độ mới lần đồng bộ, không phải kỳ số liệu. Nguồn không cung cấp thời điểm công bố chính xác; xem kỳ công bố tại từng chỉ tiêu.",
  };
}

/** On-demand only: no calls from market snapshots, the ticker, reports, agents or cron. */
export async function getEconomicData(dataset: EconomicDataset): Promise<{ data: EconomicSnapshot; meta: Meta } | null> {
  try {
    const result = await cached(ECONOMIC_CACHE_KEYS[dataset], {
      ttlMs: ECONOMIC_TTL_MS,
      staleMs: ECONOMIC_STALE_MS,
      producer: () => fetchVietnambizEconomy(dataset),
    });
    return { data: result.value.data, meta: economicMeta(result.value.data, result, result.value.latencyMs) };
  } catch {
    // No static dataset or unrelated fallback source is substituted for VietnamBiz.
    return null;
  }
}

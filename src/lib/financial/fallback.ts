import "server-only";
import type { FinancialPackageMeta, FreshnessStatus, NormalizedPeriod } from "./types";

/**
 * Phase 1 — Fallback Engine
 *
 * Level 0: Primary source hit (fresh)
 * Level 1: Latest valid data / secondary structured source
 * Level 2: Official failed → structured source
 * Level 3: Stale cache / previous verified dataset
 * Level 4: Historical quarter only / all sources unavailable
 */

export type FallbackLevel = 0 | 1 | 2 | 3 | 4;

export interface FallbackDecision {
  level: FallbackLevel;
  freshness: FreshnessStatus;
  periods: NormalizedPeriod[];
  label: string;
  note: string;
}

export function decideFallback(input: {
  periods: NormalizedPeriod[];
  primaryHit: boolean;
  usedSecondary: boolean;
  fromCache: boolean;
  cacheStale: boolean;
  officialOk: boolean;
}): FallbackDecision {
  const { periods, primaryHit, usedSecondary, fromCache, cacheStale, officialOk } = input;

  if (!periods.length) {
    return {
      level: 4,
      freshness: "SOURCE_UNAVAILABLE",
      periods: [],
      label: "No data",
      note: "Mọi nguồn đều không trả được báo cáo — không bịa số.",
    };
  }

  if (primaryHit && !fromCache && !cacheStale) {
    return {
      level: 0,
      freshness: officialOk ? "VERIFIED" : "LATEST_AVAILABLE",
      periods,
      label: "Primary",
      note: "Nguồn ưu tiên trả dữ liệu tươi.",
    };
  }

  if (usedSecondary && !fromCache) {
    return {
      level: officialOk ? 1 : 2,
      freshness: "LATEST_AVAILABLE",
      periods,
      label: officialOk ? "Latest valid / secondary" : "Official failed → structured",
      note: officialOk
        ? "Dùng nguồn thứ cấp / kỳ gần nhất còn hiệu lực."
        : "Nguồn chính thức lỗi — fallback structured provider.",
    };
  }

  if (fromCache && cacheStale) {
    return {
      level: 3,
      freshness: "STALE",
      periods,
      label: "Stale cache",
      note: "Trả bản đã xác thực trước đó (stale) — UI không trắng.",
    };
  }

  if (fromCache) {
    return {
      level: 1,
      freshness: "LATEST_AVAILABLE",
      periods,
      label: "Cache hit",
      note: "Cache còn trong TTL — latest available.",
    };
  }

  // historical depth only
  return {
    level: periods.length < 2 ? 4 : 1,
    freshness: "LATEST_AVAILABLE",
    periods,
    label: "Historical available",
    note: "Trả kỳ lịch sử gần nhất có trong hệ thống.",
  };
}

export function applyFallbackToMeta(
  meta: FinancialPackageMeta,
  decision: FallbackDecision,
): FinancialPackageMeta {
  return {
    ...meta,
    fallbackLevel: decision.level,
    freshnessStatus: decision.freshness,
    note: [meta.note, decision.note].filter(Boolean).join(" · ") || decision.note,
  };
}

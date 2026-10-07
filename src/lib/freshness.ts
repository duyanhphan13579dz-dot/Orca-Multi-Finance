import type { FreshnessStatus, Meta } from "./types";

/**
 * Unified data freshness model (§8/§9 of the product spec).
 *
 * LIVE       — streaming / event-driven pipeline, age within live SLA
 * FRESH      — polled data within its freshness SLA
 * DELAYED    — valid but slower than target SLA
 * STALE      — last valid cache, no newer data available
 * DEGRADED   — part of the pipeline is failing
 * UNAVAILABLE— no valid data at all
 */

export interface FreshnessResult {
  status: FreshnessStatus;
  ageMs: number | null;
}

export function computeFreshness(
  sourceTimestampMs: number | null,
  opts: { liveSlaMs?: number; freshSlaMs?: number; delayedSlaMs?: number; hasData: boolean; degraded?: boolean },
): FreshnessResult {
  const { liveSlaMs = 20_000, freshSlaMs = 120_000, delayedSlaMs = 900_000, hasData, degraded } = opts;
  if (!hasData) return { status: "UNAVAILABLE", ageMs: null };
  if (sourceTimestampMs == null || Number.isNaN(sourceTimestampMs)) {
    return { status: degraded ? "DEGRADED" : "STALE", ageMs: null };
  }
  const ageMs = Math.max(0, Date.now() - sourceTimestampMs);
  if (degraded) return { status: "DEGRADED", ageMs };
  if (ageMs <= liveSlaMs) return { status: "LIVE", ageMs };
  if (ageMs <= freshSlaMs) return { status: "FRESH", ageMs };
  if (ageMs <= delayedSlaMs) return { status: "DELAYED", ageMs };
  return { status: "STALE", ageMs };
}

export function buildMeta(args: {
  source: string;
  sourceTimestampMs?: number | null;
  hasData?: boolean;
  degraded?: boolean;
  cached?: boolean;
  stale?: boolean;
  latencyMs?: number;
  note?: string;
  partial?: boolean;
  sections?: Record<string, FreshnessStatus>;
  slas?: { liveSlaMs?: number; freshSlaMs?: number; delayedSlaMs?: number };
}): Meta {
  const hasData = args.hasData ?? true;
  const ts = args.sourceTimestampMs ?? null;
  let f: FreshnessResult;
  if (args.stale && hasData) {
    f = {
      status: "STALE",
      ageMs: ts != null ? Math.max(0, Date.now() - ts) : null,
    };
  } else {
    f = computeFreshness(ts, { ...(args.slas ?? {}), hasData, degraded: args.degraded });
  }
  return {
    source: args.source,
    sourceTimestamp: ts != null ? new Date(ts).toISOString() : null,
    ingestedAt: new Date().toISOString(),
    freshness: f.status,
    ageMs: f.ageMs,
    cached: args.cached ?? false,
    stale: args.stale ?? f.status === "STALE",
    latencyMs: args.latencyMs,
    note: args.note,
    partial: args.partial,
    sections: args.sections,
  };
}

export function worstFreshness(statuses: FreshnessStatus[]): FreshnessStatus {
  const order: FreshnessStatus[] = ["LIVE", "FRESH", "DELAYED", "STALE", "DEGRADED", "UNAVAILABLE"];
  let worst: FreshnessStatus = "LIVE";
  for (const s of statuses) if (order.indexOf(s) > order.indexOf(worst)) worst = s;
  return worst;
}

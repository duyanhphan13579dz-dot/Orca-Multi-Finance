import "server-only";
import { getSourceSla, SOURCE_CATALOG, type SourceCatalogEntry } from "./catalog";
import { assessDataFreshness, type DataFreshnessResult } from "./quality";

/**
 * Phase 3 — Telemetry & Health Monitoring for ORCA Data Hub.
 *
 * Tracks performance, latency distribution, error rates, and SLA compliance
 * across all external data providers in SOURCE_CATALOG.
 */

export type SourceCallRecord = {
  sourceId: string;
  durationMs: number;
  success: boolean;
  statusCode?: number;
  dataAgeMs?: number;
  timestamp: number;
  error?: string;
};

export type SourceTelemetryStats = {
  sourceId: string;
  description?: string;
  domain?: string;
  role?: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number; // 0..100
  avgDurationMs: number;
  p95DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
  lastStatusCode?: number;
  freshness?: DataFreshnessResult;
  health: "HEALTHY" | "DEGRADED" | "DOWN" | "IDLE";
};

type GlobalTelemetryState = {
  records: SourceCallRecord[];
  bySource: Map<
    string,
    {
      calls: number;
      successes: number;
      durations: number[];
      lastSuccessAt?: number;
      lastFailureAt?: number;
      lastError?: string;
      lastStatusCode?: number;
      lastDataAgeMs?: number;
    }
  >;
};

const MAX_RECORDS = 500;
const MAX_DURATIONS_PER_SOURCE = 50;

declare global {
  // eslint-disable-next-line no-var
  var __ORCA_DATA_ENGINE_TELEMETRY__: GlobalTelemetryState | undefined;
}

function getTelemetryState(): GlobalTelemetryState {
  if (!globalThis.__ORCA_DATA_ENGINE_TELEMETRY__) {
    globalThis.__ORCA_DATA_ENGINE_TELEMETRY__ = {
      records: [],
      bySource: new Map(),
    };
  }
  return globalThis.__ORCA_DATA_ENGINE_TELEMETRY__;
}

/**
 * Records a provider call telemetry sample.
 */
export function recordSourceTelemetry(args: {
  sourceId: string;
  durationMs: number;
  success: boolean;
  statusCode?: number;
  dataAgeMs?: number;
  error?: string;
}): void {
  const state = getTelemetryState();
  const timestamp = Date.now();
  const record: SourceCallRecord = {
    sourceId: args.sourceId,
    durationMs: Math.max(0, Math.round(args.durationMs)),
    success: args.success,
    statusCode: args.statusCode,
    dataAgeMs: args.dataAgeMs,
    timestamp,
    error: args.error,
  };

  state.records.push(record);
  if (state.records.length > MAX_RECORDS) {
    state.records.shift();
  }

  let entry = state.bySource.get(args.sourceId);
  if (!entry) {
    entry = { calls: 0, successes: 0, durations: [] };
    state.bySource.set(args.sourceId, entry);
  }

  entry.calls++;
  if (args.success) {
    entry.successes++;
    entry.lastSuccessAt = timestamp;
  } else {
    entry.lastFailureAt = timestamp;
    entry.lastError = args.error;
  }
  if (args.statusCode !== undefined) entry.lastStatusCode = args.statusCode;
  if (args.dataAgeMs !== undefined) entry.lastDataAgeMs = args.dataAgeMs;

  entry.durations.push(record.durationMs);
  if (entry.durations.length > MAX_DURATIONS_PER_SOURCE) {
    entry.durations.shift();
  }
}

/**
 * Computes telemetry stats for a specific source.
 */
export function getSourceTelemetry(sourceId: string, nowMs = Date.now()): SourceTelemetryStats {
  const state = getTelemetryState();
  const entry = state.bySource.get(sourceId);
  const catalogEntry: SourceCatalogEntry | undefined = SOURCE_CATALOG.find((s) => s.id === sourceId);

  if (!entry || entry.calls === 0) {
    return {
      sourceId,
      description: catalogEntry?.description,
      domain: catalogEntry?.domain,
      role: catalogEntry?.role,
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      successRate: 100,
      avgDurationMs: 0,
      p95DurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      health: "IDLE",
    };
  }

  const calls = entry.calls;
  const successes = entry.successes;
  const failures = calls - successes;
  const successRate = Math.round((successes / calls) * 100);

  const sortedDurations = [...entry.durations].sort((a, b) => a - b);
  const avgDurationMs =
    sortedDurations.length > 0
      ? Math.round(sortedDurations.reduce((sum, d) => sum + d, 0) / sortedDurations.length)
      : 0;
  const p95Index = Math.min(
    sortedDurations.length - 1,
    Math.floor(sortedDurations.length * 0.95),
  );
  const p95DurationMs = sortedDurations[p95Index] ?? 0;
  const minDurationMs = sortedDurations[0] ?? 0;
  const maxDurationMs = sortedDurations[sortedDurations.length - 1] ?? 0;

  // Freshness check
  const lastUpdate = entry.lastSuccessAt ?? (entry.lastDataAgeMs != null ? nowMs - entry.lastDataAgeMs : null);
  const freshness = assessDataFreshness(sourceId, lastUpdate, nowMs);

  let health: "HEALTHY" | "DEGRADED" | "DOWN" | "IDLE" = "HEALTHY";
  if (calls > 3 && successRate < 50) {
    health = "DOWN";
  } else if (calls > 2 && (successRate < 85 || freshness.status === "stale" || freshness.status === "expired")) {
    health = "DEGRADED";
  }

  return {
    sourceId,
    description: catalogEntry?.description,
    domain: catalogEntry?.domain,
    role: catalogEntry?.role,
    totalCalls: calls,
    successCalls: successes,
    failedCalls: failures,
    successRate,
    avgDurationMs,
    p95DurationMs,
    minDurationMs,
    maxDurationMs,
    lastSuccessAt: entry.lastSuccessAt,
    lastFailureAt: entry.lastFailureAt,
    lastError: entry.lastError,
    lastStatusCode: entry.lastStatusCode,
    freshness,
    health,
  };
}

/**
 * Returns telemetry health reports for all sources in SOURCE_CATALOG.
 */
export function getAllSourcesTelemetry(nowMs = Date.now()): {
  totalSources: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  idleCount: number;
  sources: Record<string, SourceTelemetryStats>;
  checkedAt: number;
} {
  const sources: Record<string, SourceTelemetryStats> = {};
  let healthyCount = 0;
  let degradedCount = 0;
  let downCount = 0;
  let idleCount = 0;

  for (const entry of SOURCE_CATALOG) {
    const stats = getSourceTelemetry(entry.id, nowMs);
    sources[entry.id] = stats;

    if (stats.health === "HEALTHY") healthyCount++;
    else if (stats.health === "DEGRADED") degradedCount++;
    else if (stats.health === "DOWN") downCount++;
    else idleCount++;
  }

  return {
    totalSources: SOURCE_CATALOG.length,
    healthyCount,
    degradedCount,
    downCount,
    idleCount,
    sources,
    checkedAt: nowMs,
  };
}

/**
 * Clears in-memory telemetry buffer (useful for testing).
 */
export function resetTelemetryState(): void {
  const state = getTelemetryState();
  state.records = [];
  state.bySource.clear();
}

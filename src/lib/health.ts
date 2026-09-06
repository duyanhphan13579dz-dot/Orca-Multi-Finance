import "server-only";
import type { ProviderStatus } from "./types";

/**
 * Provider health registry + circuit breaker (in-process, persisted best-effort).
 * Every outbound provider call flows through recordSuccess/recordFailure so the
 * /system ops dashboard and the freshness gate always know pipeline state.
 */

interface ProviderState {
  provider: string;
  domain: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastLatencyMs: number | null;
  latencies: number[];
  lastError: string | null;
  circuitOpenUntil: number | null; // epoch ms; null = closed
  halfOpen: boolean;
  events: { at: string; event: string; message: string | null; latencyMs: number | null }[];
}

const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_MS = 60_000;
const MAX_EVENTS = 20;

const registry = new Map<string, ProviderState>();

function stateFor(provider: string, domain = "general"): ProviderState {
  let s = registry.get(provider);
  if (!s) {
    s = {
      provider,
      domain,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastLatencyMs: null,
      latencies: [],
      lastError: null,
      circuitOpenUntil: null,
      halfOpen: false,
      events: [],
    };
    registry.set(provider, s);
  }
  return s;
}

function pushEvent(s: ProviderState, event: string, message: string | null, latencyMs: number | null) {
  s.events.unshift({ at: new Date().toISOString(), event, message, latencyMs });
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
}

async function persist(s: ProviderState) {
  try {
    const { db } = await import("@/db");
    const { providerHealth } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const avg = s.latencies.length ? Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length) : null;
    await db
      .insert(providerHealth)
      .values({
        provider: s.provider,
        status: statusOf(s),
        lastSuccessAt: s.lastSuccessAt,
        lastFailureAt: s.lastFailureAt,
        lastLatencyMs: s.lastLatencyMs != null ? Math.round(s.lastLatencyMs) : null,
        avgLatencyMs: avg,
        successCount: s.successCount,
        failureCount: s.failureCount,
        consecutiveFailures: s.consecutiveFailures,
        lastError: s.lastError,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
      target: providerHealth.provider,
      set: {
        status: sql`excluded.status`,
        lastSuccessAt: sql`excluded.last_success_at`,
        lastFailureAt: sql`excluded.last_failure_at`,
        lastLatencyMs: sql`excluded.last_latency_ms`,
        avgLatencyMs: sql`excluded.avg_latency_ms`,
        successCount: sql`excluded.success_count`,
        failureCount: sql`excluded.failure_count`,
        consecutiveFailures: sql`excluded.consecutive_failures`,
        lastError: sql`excluded.last_error`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  } catch {
    /* persistence is best-effort — never break the request path */
  }
}

function statusOf(s: ProviderState): ProviderStatus["status"] {
  if (s.successCount === 0 && s.failureCount === 0) return "unknown";
  if (isCircuitOpen(s.provider)) return "down";
  if (s.consecutiveFailures >= 2) return "degraded";
  const total = s.successCount + s.failureCount;
  if (total >= 5 && s.failureCount / total > 0.4) return "degraded";
  return "healthy";
}

export function registerProvider(provider: string, domain: string) {
  stateFor(provider, domain);
}

export function isCircuitOpen(provider: string): boolean {
  const s = stateFor(provider);
  if (s.circuitOpenUntil == null) return false;
  if (Date.now() >= s.circuitOpenUntil) {
    s.circuitOpenUntil = null;
    s.halfOpen = true;
    return false;
  }
  return true;
}

export function recordSuccess(provider: string, latencyMs: number, domain = "general") {
  const s = stateFor(provider, domain);
  s.successCount += 1;
  s.consecutiveFailures = 0;
  s.lastSuccessAt = new Date();
  s.lastLatencyMs = latencyMs;
  s.latencies.push(latencyMs);
  if (s.latencies.length > 50) s.latencies.shift();
  s.lastError = null;
  s.halfOpen = false;
  pushEvent(s, "success", null, latencyMs);
  void persist(s);
}

export function recordFailure(provider: string, error: string, domain = "general") {
  const s = stateFor(provider, domain);
  s.failureCount += 1;
  s.consecutiveFailures += 1;
  s.lastFailureAt = new Date();
  s.lastError = error.slice(0, 500);
  pushEvent(s, "failure", s.lastError, null);
  if (s.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !s.circuitOpenUntil) {
    s.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    pushEvent(s, "circuit_open", `circuit open for ${CIRCUIT_OPEN_MS / 1000}s after ${s.consecutiveFailures} failures`, null);
  }
  void persist(s);
}

export function getProviderHealth(): ProviderStatus[] {
  return Array.from(registry.values()).map((s) => {
    const avg = s.latencies.length ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : null;
    return {
      provider: s.provider,
      domain: s.domain,
      status: statusOf(s),
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
      lastLatencyMs: s.lastLatencyMs,
      avgLatencyMs: avg != null ? Math.round(avg) : null,
      successCount: s.successCount,
      failureCount: s.failureCount,
      consecutiveFailures: s.consecutiveFailures,
      circuit: isCircuitOpen(s.provider) ? "open" : s.halfOpen ? "half-open" : "closed",
      lastError: s.lastError,
      recentEvents: s.events,
    };
  });
}

/** Test/ops helper: reset in-memory health state (circuit, counters). */
export function resetProviderHealth(): void {
  registry.clear();
}

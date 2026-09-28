import "server-only";

/**
 * Provider health registry + circuit breaker.
 * Softened: threshold 8 failures, open 12s — recovers faster, fewer "unavailable" states.
 */

type ProviderState = {
  provider: string;
  domain: string;
  ok: number;
  fail: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  circuitOpenUntil: number | null;
  halfOpen: boolean;
  events: { at: string; event: string; message: string | null; latencyMs: number | null }[];
};

const CIRCUIT_FAILURE_THRESHOLD = 8;
const CIRCUIT_OPEN_MS = 12_000;
const MAX_EVENTS = 20;

const registry = new Map<string, ProviderState>();

function stateFor(provider: string, domain = "general"): ProviderState {
  let s = registry.get(provider);
  if (!s) {
    s = {
      provider,
      domain,
      ok: 0,
      fail: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      circuitOpenUntil: null,
      halfOpen: false,
      events: [],
    };
    registry.set(provider, s);
  }
  return s;
}

function pushEvent(
  s: ProviderState,
  event: string,
  message: string | null,
  latencyMs: number | null,
) {
  s.events.push({ at: new Date().toISOString(), event, message, latencyMs });
  if (s.events.length > MAX_EVENTS) s.events.shift();
}

export function isCircuitOpen(provider: string): boolean {
  const s = registry.get(provider);
  if (!s || !s.circuitOpenUntil) return false;
  if (Date.now() >= s.circuitOpenUntil) {
    s.circuitOpenUntil = null;
    s.halfOpen = true;
    pushEvent(s, "half_open", "probe allowed", null);
    return false;
  }
  return true;
}

export function recordSuccess(provider: string, latencyMs?: number) {
  const s = stateFor(provider);
  s.ok += 1;
  s.consecutiveFailures = 0;
  s.lastSuccessAt = Date.now();
  s.circuitOpenUntil = null;
  s.halfOpen = false;
  pushEvent(s, "success", null, latencyMs ?? null);
}

export function recordFailure(provider: string, error: string) {
  const s = stateFor(provider);
  s.fail += 1;
  s.consecutiveFailures += 1;
  s.lastFailureAt = Date.now();
  s.lastError = error;
  pushEvent(s, "failure", error, null);
  if (s.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !s.circuitOpenUntil) {
    s.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    pushEvent(
      s,
      "circuit_open",
      `circuit open for ${CIRCUIT_OPEN_MS / 1000}s after ${s.consecutiveFailures} failures`,
      null,
    );
  }
}

export function getProviderHealth(provider: string) {
  return registry.get(provider) ?? null;
}

export function getAllProviderHealth() {
  return [...registry.values()].map((s) => ({
    provider: s.provider,
    domain: s.domain,
    ok: s.ok,
    fail: s.fail,
    consecutiveFailures: s.consecutiveFailures,
    lastSuccessAt: s.lastSuccessAt,
    lastFailureAt: s.lastFailureAt,
    lastError: s.lastError,
    circuitOpen: isCircuitOpen(s.provider),
    circuitOpenUntil: s.circuitOpenUntil,
    halfOpen: s.halfOpen,
    recentEvents: s.events.slice(-8),
  }));
}

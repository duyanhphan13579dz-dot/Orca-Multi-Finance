import "server-only";

/**
 * Phase 5 — Financial engine monitoring (process-local ring buffer).
 * Tracks source success, latency, validation failures, fallback usage.
 */

export type MonitorEventKind =
  | "source_attempt"
  | "source_success"
  | "source_failure"
  | "validation"
  | "fallback"
  | "error"
  | "package_served";

export interface MonitorEvent {
  ts: number;
  kind: MonitorEventKind;
  ticker?: string;
  source?: string;
  latencyMs?: number;
  success?: boolean;
  fallbackLevel?: number;
  validationStatus?: string;
  qualityScore?: number;
  message?: string;
}

const MAX = 500;
const events: MonitorEvent[] = [];
const counters = {
  sourceAttempts: 0,
  sourceSuccess: 0,
  sourceFailure: 0,
  validationFail: 0,
  validationOk: 0,
  fallbackUsed: 0,
  packagesServed: 0,
  errors: 0,
  latencySumMs: 0,
  latencyCount: 0,
};

function push(e: MonitorEvent): void {
  events.push(e);
  if (events.length > MAX) events.splice(0, events.length - MAX);

  switch (e.kind) {
    case "source_attempt":
      counters.sourceAttempts += 1;
      break;
    case "source_success":
      counters.sourceSuccess += 1;
      if (e.latencyMs != null) {
        counters.latencySumMs += e.latencyMs;
        counters.latencyCount += 1;
      }
      break;
    case "source_failure":
      counters.sourceFailure += 1;
      break;
    case "validation":
      if (e.success) counters.validationOk += 1;
      else counters.validationFail += 1;
      break;
    case "fallback":
      counters.fallbackUsed += 1;
      break;
    case "error":
      counters.errors += 1;
      break;
    case "package_served":
      counters.packagesServed += 1;
      break;
  }
}

export function logSourceAttempt(source: string, ticker?: string): void {
  push({ ts: Date.now(), kind: "source_attempt", source, ticker });
}

export function logSourceResult(
  source: string,
  success: boolean,
  opts?: { ticker?: string; latencyMs?: number; message?: string },
): void {
  push({
    ts: Date.now(),
    kind: success ? "source_success" : "source_failure",
    source,
    success,
    ticker: opts?.ticker,
    latencyMs: opts?.latencyMs,
    message: opts?.message,
  });
}

export function logValidation(opts: {
  ticker: string;
  status: string;
  qualityScore: number;
  ok: boolean;
  message?: string;
}): void {
  push({
    ts: Date.now(),
    kind: "validation",
    ticker: opts.ticker,
    validationStatus: opts.status,
    qualityScore: opts.qualityScore,
    success: opts.ok,
    message: opts.message,
  });
}

export function logFallback(ticker: string, level: number, message?: string): void {
  if (level <= 0) return;
  push({
    ts: Date.now(),
    kind: "fallback",
    ticker,
    fallbackLevel: level,
    message,
  });
}

export function logFinancialError(message: string, ticker?: string, source?: string): void {
  push({ ts: Date.now(), kind: "error", message: message.slice(0, 240), ticker, source });
}

export function logPackageServed(ticker: string, opts?: { qualityScore?: number; fallbackLevel?: number }): void {
  push({
    ts: Date.now(),
    kind: "package_served",
    ticker,
    qualityScore: opts?.qualityScore,
    fallbackLevel: opts?.fallbackLevel,
  });
}

export interface FinancialMonitorSnapshot {
  windowSize: number;
  sinceMs: number | null;
  metrics: {
    sourceSuccessRate: number | null;
    avgSourceLatencyMs: number | null;
    validationFailureRate: number | null;
    fallbackUsageRate: number | null;
    errorCount: number;
    packagesServed: number;
    sourceAttempts: number;
    sourceSuccess: number;
    sourceFailure: number;
  };
  bySource: Record<
    string,
    { attempts: number; success: number; failure: number; avgLatencyMs: number | null }
  >;
  recentErrors: MonitorEvent[];
  recentEvents: MonitorEvent[];
}

export function getFinancialMonitorSnapshot(limit = 40): FinancialMonitorSnapshot {
  const attempts = counters.sourceAttempts;
  const success = counters.sourceSuccess;
  const failure = counters.sourceFailure;
  const valTotal = counters.validationOk + counters.validationFail;
  const packages = counters.packagesServed;

  type Agg = {
    attempts: number;
    success: number;
    failure: number;
    latSum: number;
    latN: number;
  };
  const agg: Record<string, Agg> = {};

  for (const e of events) {
    if (!e.source) continue;
    const row = agg[e.source] ?? { attempts: 0, success: 0, failure: 0, latSum: 0, latN: 0 };
    if (e.kind === "source_attempt") row.attempts += 1;
    if (e.kind === "source_success") {
      row.success += 1;
      if (e.latencyMs != null) {
        row.latSum += e.latencyMs;
        row.latN += 1;
      }
    }
    if (e.kind === "source_failure") row.failure += 1;
    agg[e.source] = row;
  }

  const bySource: FinancialMonitorSnapshot["bySource"] = {};
  for (const [k, row] of Object.entries(agg)) {
    bySource[k] = {
      attempts: row.attempts,
      success: row.success,
      failure: row.failure,
      avgLatencyMs: row.latN ? Math.round(row.latSum / row.latN) : null,
    };
  }

  return {
    windowSize: events.length,
    sinceMs: events[0]?.ts ?? null,
    metrics: {
      sourceSuccessRate: attempts ? Number((success / attempts).toFixed(3)) : null,
      avgSourceLatencyMs: counters.latencyCount
        ? Math.round(counters.latencySumMs / counters.latencyCount)
        : null,
      validationFailureRate: valTotal
        ? Number((counters.validationFail / valTotal).toFixed(3))
        : null,
      fallbackUsageRate: packages
        ? Number((counters.fallbackUsed / packages).toFixed(3))
        : null,
      errorCount: counters.errors,
      packagesServed: packages,
      sourceAttempts: attempts,
      sourceSuccess: success,
      sourceFailure: failure,
    },
    bySource,
    recentErrors: events.filter((e) => e.kind === "error").slice(-20),
    recentEvents: events.slice(-limit),
  };
}

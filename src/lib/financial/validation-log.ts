import "server-only";
import { cached } from "../cache";
import type { FinancialQualityResult } from "./validation";
import type { FreshnessStatus } from "./types";

/**
 * Phase 5 — financial_validation_logs (cache-backed, EXTEND-only).
 * Ready to swap to DB table later without changing call sites.
 */

export interface ValidationLogEntry {
  id: string;
  ts: number;
  ticker: string;
  qualityScore: number;
  qualityStatus: string;
  crossConfidence: string;
  discrepancyCount: number;
  fallbackLevel: number;
  freshnessStatus: FreshnessStatus | string;
  primarySource: string;
  checksOk: number;
  checksTotal: number;
  message: string | null;
}

const GLOBAL_KEY = "fin:validation-logs:global:v1";
const tickerKey = (t: string) => `fin:validation-logs:${t.toUpperCase()}:v1`;
const MAX_GLOBAL = 200;
const MAX_TICKER = 50;

async function readList(key: string): Promise<ValidationLogEntry[]> {
  try {
    const res = await cached(key, {
      ttlMs: 7 * 24 * 3_600_000,
      staleMs: 90 * 24 * 3_600_000,
      producer: async () => [] as ValidationLogEntry[],
    });
    return res.value ?? [];
  } catch {
    return [];
  }
}

async function writeList(key: string, list: ValidationLogEntry[]): Promise<void> {
  await cached(key, {
    ttlMs: 7 * 24 * 3_600_000,
    staleMs: 90 * 24 * 3_600_000,
    producer: async () => list,
  });
}

export async function appendValidationLog(input: {
  ticker: string;
  quality: FinancialQualityResult;
  fallbackLevel: number;
  freshnessStatus: string;
  primarySource: string;
}): Promise<ValidationLogEntry> {
  const entry: ValidationLogEntry = {
    id: `${input.ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    ticker: input.ticker.toUpperCase(),
    qualityScore: input.quality.score,
    qualityStatus: input.quality.status,
    crossConfidence: input.quality.cross.confidence,
    discrepancyCount: input.quality.cross.discrepancies.length,
    fallbackLevel: input.fallbackLevel,
    freshnessStatus: input.freshnessStatus,
    primarySource: input.primarySource,
    checksOk: input.quality.checks.filter((c) => c.ok).length,
    checksTotal: input.quality.checks.length,
    message: input.quality.cross.note,
  };

  const sym = entry.ticker;
  const [global, perTicker] = await Promise.all([readList(GLOBAL_KEY), readList(tickerKey(sym))]);

  const nextGlobal = [entry, ...global].slice(0, MAX_GLOBAL);
  const nextTicker = [entry, ...perTicker].slice(0, MAX_TICKER);

  await Promise.all([writeList(GLOBAL_KEY, nextGlobal), writeList(tickerKey(sym), nextTicker)]);
  return entry;
}

export async function getValidationLogs(opts?: {
  ticker?: string;
  limit?: number;
}): Promise<ValidationLogEntry[]> {
  const limit = opts?.limit ?? 50;
  if (opts?.ticker) {
    const list = await readList(tickerKey(opts.ticker));
    return list.slice(0, limit);
  }
  const list = await readList(GLOBAL_KEY);
  return list.slice(0, limit);
}

export async function getValidationAnalytics(): Promise<{
  totalLogs: number;
  avgQualityScore: number | null;
  statusBreakdown: Record<string, number>;
  avgDiscrepancies: number | null;
  fallbackUsageShare: number | null;
  recent: ValidationLogEntry[];
}> {
  const list = await readList(GLOBAL_KEY);
  if (!list.length) {
    return {
      totalLogs: 0,
      avgQualityScore: null,
      statusBreakdown: {},
      avgDiscrepancies: null,
      fallbackUsageShare: null,
      recent: [],
    };
  }
  const statusBreakdown: Record<string, number> = {};
  let scoreSum = 0;
  let discSum = 0;
  let fb = 0;
  for (const e of list) {
    statusBreakdown[e.qualityStatus] = (statusBreakdown[e.qualityStatus] ?? 0) + 1;
    scoreSum += e.qualityScore;
    discSum += e.discrepancyCount;
    if (e.fallbackLevel > 0) fb += 1;
  }
  return {
    totalLogs: list.length,
    avgQualityScore: Number((scoreSum / list.length).toFixed(1)),
    statusBreakdown,
    avgDiscrepancies: Number((discSum / list.length).toFixed(2)),
    fallbackUsageShare: Number((fb / list.length).toFixed(3)),
    recent: list.slice(0, 20),
  };
}

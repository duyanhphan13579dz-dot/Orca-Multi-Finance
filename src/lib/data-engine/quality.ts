import "server-only";
import { getSourceSla, SOURCE_CATALOG } from "./catalog";

/**
 * Phase 3 — Quality Engine for ORCA Data Hub.
 *
 * Provides quantitative validation of ingested data:
 * 1. Schema contract validation against SOURCE_CATALOG expectedSchema.
 * 2. Monotonicity & clock-skew checks on time-series records.
 * 3. Anomaly & outlier detection (negative prices, boundary breaches, high < low).
 * 4. Freshness SLA grading (live / fresh / stale / expired).
 * 5. Composite data quality scoring (0 - 100) with actionable diagnostics.
 */

export type QualitySeverity = "info" | "warning" | "error";

export type QualityIssue = {
  code: string;
  field?: string;
  message: string;
  severity: QualitySeverity;
  observed?: unknown;
  expected?: unknown;
};

export type QualityGrade = "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL";

export type SchemaContractResult = {
  valid: boolean;
  expectedFields: string[];
  missingFields: string[];
  nullFields: string[];
  presentFields: string[];
};

export type TimestampMonotonicityResult = {
  valid: boolean;
  isMonotonic: boolean;
  hasFutureTimestamp: boolean;
  outOfOrderCount: number;
  duplicateCount: number;
  totalBars: number;
  earliestTime?: number;
  latestTime?: number;
  issues: QualityIssue[];
};

export type FreshnessStatus = "live" | "fresh" | "delayed" | "stale" | "expired";

export type DataFreshnessResult = {
  status: FreshnessStatus;
  ageMs: number;
  updatedAtMs?: number;
  sla: {
    liveSlaMs: number;
    freshSlaMs: number;
    staleSlaMs: number;
  };
};

export type QuoteAnomaly = {
  symbol: string;
  issue: string;
  severity: QualitySeverity;
  price?: number;
  changePercent?: number | null;
  high?: number | null;
  low?: number | null;
};

export type AnomalyDetectionResult = {
  valid: boolean;
  anomalyCount: number;
  anomalies: QuoteAnomaly[];
};

export type DataQualityReport = {
  sourceId: string;
  score: number; // 0..100
  grade: QualityGrade;
  isUsable: boolean;
  freshness: DataFreshnessResult;
  schema?: SchemaContractResult;
  issues: QualityIssue[];
  checkedAt: number;
};

/**
 * Validates payload object against expectedSchema defined in SOURCE_CATALOG.
 */
export function validateSchemaContract(sourceId: string, payload: unknown): SchemaContractResult {
  const catalogEntry = SOURCE_CATALOG.find((s) => s.id === sourceId);
  const expectedFields = catalogEntry?.expectedSchema ?? [];

  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      expectedFields,
      missingFields: expectedFields,
      nullFields: [],
      presentFields: [],
    };
  }

  const obj = payload as Record<string, unknown>;
  const presentKeys = Object.keys(obj);
  const missingFields: string[] = [];
  const nullFields: string[] = [];
  const presentFields: string[] = [];

  for (const field of expectedFields) {
    if (!(field in obj)) {
      missingFields.push(field);
    } else if (obj[field] === null || obj[field] === undefined) {
      nullFields.push(field);
      presentFields.push(field);
    } else {
      presentFields.push(field);
    }
  }

  return {
    valid: missingFields.length === 0,
    expectedFields,
    missingFields,
    nullFields,
    presentFields,
  };
}

/**
 * Checks time-series bars for monotonic timestamps, duplicates, and clock-skew into the future.
 */
export function checkMonotonicTimestamps(
  bars: Array<{ time: number }>,
  options?: { maxClockSkewMs?: number; nowMs?: number },
): TimestampMonotonicityResult {
  const issues: QualityIssue[] = [];
  const now = options?.nowMs ?? Date.now();
  const maxClockSkewMs = options?.maxClockSkewMs ?? 5 * 60_000; // 5m max skew allowed

  if (!bars || bars.length === 0) {
    return {
      valid: true,
      isMonotonic: true,
      hasFutureTimestamp: false,
      outOfOrderCount: 0,
      duplicateCount: 0,
      totalBars: 0,
      issues: [],
    };
  }

  let outOfOrderCount = 0;
  let duplicateCount = 0;
  let hasFutureTimestamp = false;
  let earliestTime = bars[0]?.time ?? 0;
  let latestTime = bars[0]?.time ?? 0;

  for (let i = 0; i < bars.length; i++) {
    const t = bars[i]!.time;
    if (t < earliestTime) earliestTime = t;
    if (t > latestTime) latestTime = t;

    // Future timestamp check
    if (t > now + maxClockSkewMs) {
      hasFutureTimestamp = true;
      issues.push({
        code: "FUTURE_TIMESTAMP",
        severity: "error",
        message: `Bar at index ${i} has timestamp in the future (${new Date(t).toISOString()})`,
        observed: t,
        expected: `<= ${now + maxClockSkewMs}`,
      });
    }

    // Monotonicity check against previous bar
    if (i > 0) {
      const prev = bars[i - 1]!.time;
      if (t < prev) {
        outOfOrderCount++;
        issues.push({
          code: "OUT_OF_ORDER_TIMESTAMP",
          severity: "error",
          message: `Bar ${i} timestamp (${t}) is earlier than bar ${i - 1} (${prev})`,
          observed: t,
          expected: `>= ${prev}`,
        });
      } else if (t === prev) {
        duplicateCount++;
        issues.push({
          code: "DUPLICATE_TIMESTAMP",
          severity: "warning",
          message: `Duplicate timestamp at index ${i} (${t})`,
          observed: t,
        });
      }
    }
  }

  return {
    valid: outOfOrderCount === 0 && !hasFutureTimestamp,
    isMonotonic: outOfOrderCount === 0,
    hasFutureTimestamp,
    outOfOrderCount,
    duplicateCount,
    totalBars: bars.length,
    earliestTime,
    latestTime,
    issues,
  };
}

/**
 * Assesses data freshness against SLA contract.
 */
export function assessDataFreshness(
  sourceId: string,
  updatedAtMs?: number | null,
  nowMs?: number,
): DataFreshnessResult {
  const sla = getSourceSla(sourceId);
  const now = nowMs ?? Date.now();

  if (updatedAtMs == null || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return {
      status: "expired",
      ageMs: Number.POSITIVE_INFINITY,
      sla,
    };
  }

  const ageMs = Math.max(0, now - updatedAtMs);

  let status: FreshnessStatus = "live";
  if (ageMs > sla.staleSlaMs * 2) {
    status = "expired";
  } else if (ageMs > sla.staleSlaMs) {
    status = "stale";
  } else if (ageMs > sla.freshSlaMs) {
    status = "delayed";
  } else if (ageMs > sla.liveSlaMs) {
    status = "fresh";
  } else {
    status = "live";
  }

  return {
    status,
    ageMs,
    updatedAtMs,
    sla,
  };
}

/**
 * Detects price anomalies in quote feeds:
 * - Negative or zero prices
 * - Broken high/low boundaries (high < low, or price outside [low, high])
 * - Excessive intraday price change (> maxLimitPct)
 */
export function detectPriceAnomalies(
  quotes: Array<{
    symbol?: string;
    price?: number | null;
    changePercent?: number | null;
    high?: number | null;
    low?: number | null;
  }>,
  options?: { maxChangePercent?: number },
): AnomalyDetectionResult {
  const anomalies: QuoteAnomaly[] = [];
  const maxChange = options?.maxChangePercent ?? 15; // default 15% (UPCoM max)

  for (const q of quotes) {
    const sym = q.symbol ?? "UNKNOWN";
    const px = q.price;

    if (px == null || !Number.isFinite(px) || px <= 0) {
      anomalies.push({
        symbol: sym,
        issue: "NON_POSITIVE_PRICE",
        severity: "error",
        price: px ?? undefined,
      });
      continue;
    }

    // High / Low consistency
    if (q.high != null && q.low != null) {
      if (q.high < q.low) {
        anomalies.push({
          symbol: sym,
          issue: "HIGH_BELOW_LOW",
          severity: "error",
          high: q.high,
          low: q.low,
        });
      } else if (px > q.high * 1.001 || px < q.low * 0.999) {
        anomalies.push({
          symbol: sym,
          issue: "PRICE_OUTSIDE_HIGH_LOW_RANGE",
          severity: "warning",
          price: px,
          high: q.high,
          low: q.low,
        });
      }
    }

    // Limit breach
    if (q.changePercent != null && Number.isFinite(q.changePercent)) {
      if (Math.abs(q.changePercent) > maxChange) {
        anomalies.push({
          symbol: sym,
          issue: "EXCESSIVE_PRICE_MOVE",
          severity: "warning",
          changePercent: q.changePercent,
        });
      }
    }
  }

  return {
    valid: anomalies.filter((a) => a.severity === "error").length === 0,
    anomalyCount: anomalies.length,
    anomalies,
  };
}

/**
 * Comprehensive Data Hub Quality Evaluation.
 * Combines schema contract, freshness SLA, and anomaly checks into a single score.
 */
export function evaluatePayloadQuality(
  sourceId: string,
  payload: unknown,
  options?: {
    updatedAtMs?: number | null;
    nowMs?: number;
    bars?: Array<{ time: number }>;
    quotes?: Array<{
      symbol?: string;
      price?: number | null;
      changePercent?: number | null;
      high?: number | null;
      low?: number | null;
    }>;
  },
): DataQualityReport {
  const checkedAt = options?.nowMs ?? Date.now();
  const issues: QualityIssue[] = [];
  let score = 100;

  // 1. Freshness
  const freshness = assessDataFreshness(sourceId, options?.updatedAtMs, checkedAt);
  if (freshness.status === "delayed") {
    score -= 10;
    issues.push({
      code: "DATA_DELAYED",
      severity: "info",
      message: `Data age (${Math.round(freshness.ageMs / 1000)}s) exceeds fresh SLA (${Math.round(freshness.sla.freshSlaMs / 1000)}s)`,
    });
  } else if (freshness.status === "stale") {
    score -= 20;
    issues.push({
      code: "DATA_STALE",
      severity: "warning",
      message: `Data age (${Math.round(freshness.ageMs / 1000)}s) exceeds stale SLA (${Math.round(freshness.sla.staleSlaMs / 1000)}s)`,
    });
  } else if (freshness.status === "expired") {
    score -= 40;
    issues.push({
      code: "DATA_EXPIRED",
      severity: "error",
      message: `Data age exceeds 2x stale SLA or missing timestamp`,
    });
  }

  // 2. Schema Contract
  const schema = validateSchemaContract(sourceId, payload);
  if (!schema.valid) {
    const penalty = Math.min(30, schema.missingFields.length * 15);
    score -= penalty;
    for (const f of schema.missingFields) {
      issues.push({
        code: "SCHEMA_MISSING_FIELD",
        field: f,
        severity: "error",
        message: `Missing required field: ${f}`,
      });
    }
  }
  for (const f of schema.nullFields) {
    score -= 5;
    issues.push({
      code: "SCHEMA_NULL_FIELD",
      field: f,
      severity: "warning",
      message: `Contract field is null or undefined: ${f}`,
    });
  }

  // 3. Time Series Monotonicity (if provided)
  if (options?.bars && options.bars.length > 0) {
    const mono = checkMonotonicTimestamps(options.bars, { nowMs: checkedAt });
    if (!mono.valid) {
      score -= Math.min(25, mono.outOfOrderCount * 10 + (mono.hasFutureTimestamp ? 15 : 0));
    }
    issues.push(...mono.issues);
  }

  // 4. Quote Anomalies (if provided)
  if (options?.quotes && options.quotes.length > 0) {
    const anomalies = detectPriceAnomalies(options.quotes);
    const errorCount = anomalies.anomalies.filter((a) => a.severity === "error").length;
    const warnCount = anomalies.anomalies.filter((a) => a.severity === "warning").length;
    score -= Math.min(35, errorCount * 15 + warnCount * 5);
    for (const a of anomalies.anomalies) {
      issues.push({
        code: a.issue,
        severity: a.severity,
        message: `Symbol ${a.symbol}: ${a.issue}`,
        observed: a.price ?? a.changePercent,
      });
    }
  }

  // Normalize final score
  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade: QualityGrade = "EXCELLENT";
  if (score >= 90) grade = "EXCELLENT";
  else if (score >= 70) grade = "GOOD";
  else if (score >= 50) grade = "DEGRADED";
  else grade = "CRITICAL";

  const hasCriticalErrors = issues.some((i) => i.severity === "error");
  const isUsable = score >= 50 && (!hasCriticalErrors || score >= 60);

  return {
    sourceId,
    score,
    grade,
    isUsable,
    freshness,
    schema,
    issues,
    checkedAt,
  };
}

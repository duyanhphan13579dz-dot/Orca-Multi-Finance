import "server-only";
import type { FreshnessStatus, NormalizedMetrics, NormalizedPeriod } from "./types";

/**
 * Phase 5 — Cross Source Validation + Internal Consistency + Data Quality Score.
 * Never silently merges conflicting numbers.
 */

export type ValidationSeverity = "info" | "warn" | "fail";

export interface MetricDiscrepancy {
  metric: keyof NormalizedMetrics;
  period: string;
  primaryValue: number;
  secondaryValue: number;
  secondarySource: string;
  absDiff: number;
  relDiff: number;
  severity: ValidationSeverity;
}

export interface CrossValidationResult {
  compared: boolean;
  period: string | null;
  primarySource: string;
  secondarySources: string[];
  discrepancies: MetricDiscrepancy[];
  agreementScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";
  note: string | null;
}

export interface FinancialQualityResult {
  score: number;
  status: "VALID" | "SUSPECT" | "STALE" | "INVALID" | "UNVERIFIED";
  checks: { id: string; ok: boolean; message: string }[];
  cross: CrossValidationResult;
}

const KEY_METRICS: (keyof NormalizedMetrics)[] = [
  "revenue",
  "netRevenue",
  "grossProfit",
  "operatingProfit",
  "netIncome",
  "totalAssets",
  "equity",
  "totalLiabilities",
  "operatingCashFlow",
];

const FLOW_COMPARE: (keyof NormalizedMetrics)[] = [
  "revenue",
  "netRevenue",
  "grossProfit",
  "operatingProfit",
  "netIncome",
  "operatingCashFlow",
];

function relDiff(a: number, b: number): number {
  const base = Math.abs(a) || Math.abs(b) || 1;
  return Math.abs(a - b) / base;
}

function severityFor(rel: number): ValidationSeverity {
  if (rel >= 0.15) return "fail";
  if (rel >= 0.05) return "warn";
  return "info";
}

function finalizeCross(
  primary: NormalizedPeriod | null,
  primarySource: string,
  secondarySources: string[],
  discrepancies: MetricDiscrepancy[],
  comparable: number,
  agreed: number,
  noteWhenEmpty: string,
): CrossValidationResult {
  const agreementScore = comparable > 0 ? agreed / comparable : 1;
  let confidence: CrossValidationResult["confidence"] = "UNVERIFIED";
  if (comparable >= 4) {
    if (agreementScore >= 0.95 && !discrepancies.some((d) => d.severity === "fail"))
      confidence = "HIGH";
    else if (agreementScore >= 0.8) confidence = "MEDIUM";
    else confidence = "LOW";
  } else if (comparable > 0) {
    confidence = agreementScore >= 0.9 ? "MEDIUM" : "LOW";
  }

  return {
    compared: comparable > 0,
    period: primary?.period ?? null,
    primarySource,
    secondarySources,
    discrepancies: discrepancies.sort((a, b) => b.relDiff - a.relDiff).slice(0, 20),
    agreementScore: Number(agreementScore.toFixed(3)),
    confidence,
    note:
      comparable === 0
        ? noteWhenEmpty
        : discrepancies.length
          ? `Phát hiện ${discrepancies.length} lệch; ưu tiên nguồn ${primarySource}.`
          : "Đối chiếu đồng thuận trên metric đã so.",
  };
}

/** Compare primary period metrics against secondary snapshot(s). */
export function crossValidatePeriods(
  primary: NormalizedPeriod | null,
  primarySource: string,
  secondaries: { source: string; period: NormalizedPeriod }[],
): CrossValidationResult {
  if (!primary) {
    return {
      compared: false,
      period: null,
      primarySource,
      secondarySources: secondaries.map((s) => s.source),
      discrepancies: [],
      agreementScore: 0,
      confidence: "UNVERIFIED",
      note: "Không có kỳ primary để đối chiếu.",
    };
  }

  if (!secondaries.length) {
    return {
      compared: false,
      period: primary.period,
      primarySource,
      secondarySources: [],
      discrepancies: [],
      agreementScore: 1,
      confidence: "UNVERIFIED",
      note: "Chỉ có một nguồn — chưa cross-validate được.",
    };
  }

  const discrepancies: MetricDiscrepancy[] = [];
  let comparable = 0;
  let agreed = 0;

  for (const sec of secondaries) {
    const match =
      sec.period.period === primary.period ||
      (sec.period.year != null &&
        primary.year != null &&
        sec.period.year === primary.year &&
        sec.period.quarter === primary.quarter);
    if (!match) continue;

    for (const metric of KEY_METRICS) {
      const a = primary.metrics[metric];
      const b = sec.period.metrics[metric];
      if (a == null || b == null) continue;
      comparable += 1;
      const rd = relDiff(a, b);
      if (rd < 0.05) {
        agreed += 1;
        continue;
      }
      discrepancies.push({
        metric,
        period: primary.period,
        primaryValue: a,
        secondaryValue: b,
        secondarySource: sec.source,
        absDiff: Math.abs(a - b),
        relDiff: Number(rd.toFixed(4)),
        severity: severityFor(rd),
      });
    }
  }

  return finalizeCross(
    primary,
    primarySource,
    secondaries.map((s) => s.source),
    discrepancies,
    comparable,
    agreed,
    "Không có metric chung để so sánh giữa các nguồn.",
  );
}

/**
 * Internal consistency when only one external source exists:
 * - Annual vs sum of 4 quarters (same year) for flow metrics
 * - TTM vs sum of last 4 quarters
 */
export function internalConsistencyValidate(
  periods: NormalizedPeriod[],
  primarySource: string,
): CrossValidationResult {
  const nonTtm = periods.filter((p) => p.periodType !== "ttm");
  const quarters = nonTtm
    .filter((p) => p.periodType === "quarter" && p.year != null && p.quarter != null)
    .sort((a, b) => {
      const ay = a.year ?? 0;
      const by = b.year ?? 0;
      if (ay !== by) return by - ay;
      return (b.quarter ?? 0) - (a.quarter ?? 0);
    });
  const annuals = nonTtm.filter((p) => p.periodType === "year" && p.year != null);
  const ttm = periods.find((p) => p.periodType === "ttm") ?? null;

  const discrepancies: MetricDiscrepancy[] = [];
  let comparable = 0;
  let agreed = 0;
  const secondarySources: string[] = [];

  // TTM vs sum of 4 quarters
  if (ttm && quarters.length >= 4) {
    secondarySources.push("internal:ttm-vs-quarters");
    const window = quarters.slice(0, 4);
    for (const metric of FLOW_COMPARE) {
      const tv = ttm.metrics[metric];
      const sum = window.reduce((acc, p) => {
        const v = p.metrics[metric];
        return v != null ? acc + v : acc;
      }, 0);
      const hasAll = window.every((p) => p.metrics[metric] != null);
      if (tv == null || !hasAll) continue;
      comparable += 1;
      const rd = relDiff(tv, sum);
      if (rd < 0.08) {
        agreed += 1;
        continue;
      }
      discrepancies.push({
        metric,
        period: ttm.period,
        primaryValue: tv,
        secondaryValue: sum,
        secondarySource: "internal:ttm-vs-quarters",
        absDiff: Math.abs(tv - sum),
        relDiff: Number(rd.toFixed(4)),
        severity: severityFor(rd),
      });
    }
  }

  // Annual vs sum of quarters in that year
  for (const ann of annuals.slice(0, 2)) {
    const y = ann.year!;
    const qs = quarters.filter((q) => q.year === y);
    if (qs.length < 4) continue;
    secondarySources.push(`internal:annual-${y}-vs-quarters`);
    for (const metric of FLOW_COMPARE) {
      const av = ann.metrics[metric];
      const sum = qs.reduce((acc, p) => {
        const v = p.metrics[metric];
        return v != null ? acc + v : acc;
      }, 0);
      const hasAll = qs.every((p) => p.metrics[metric] != null);
      if (av == null || !hasAll) continue;
      comparable += 1;
      const rd = relDiff(av, sum);
      if (rd < 0.12) {
        // annual may differ from sum of unaudited quarters
        agreed += 1;
        continue;
      }
      discrepancies.push({
        metric,
        period: ann.period,
        primaryValue: av,
        secondaryValue: sum,
        secondarySource: `internal:annual-${y}-vs-quarters`,
        absDiff: Math.abs(av - sum),
        relDiff: Number(rd.toFixed(4)),
        severity: severityFor(rd),
      });
    }
  }

  const primary = ttm ?? quarters[0] ?? annuals[0] ?? null;
  return finalizeCross(
    primary,
    primarySource,
    [...new Set(secondarySources)],
    discrepancies,
    comparable,
    agreed,
    "Không đủ kỳ để kiểm tra nhất quán nội bộ (TTM/năm vs quý).",
  );
}

/** Prefer external multi-source; else internal consistency. */
export function runFullCrossValidation(
  periods: NormalizedPeriod[],
  primarySource: string,
  externalSecondaries: { source: string; period: NormalizedPeriod }[],
): CrossValidationResult {
  const head = periods.find((p) => p.periodType !== "ttm") ?? periods[0] ?? null;
  if (externalSecondaries.length) {
    return crossValidatePeriods(head, primarySource, externalSecondaries);
  }
  return internalConsistencyValidate(periods, primarySource);
}

export function scoreFinancialQuality(input: {
  periods: NormalizedPeriod[];
  freshness: FreshnessStatus;
  fallbackLevel: number;
  cross: CrossValidationResult;
  hasIncome: boolean;
  hasBalance: boolean;
  hasCashflow: boolean;
}): FinancialQualityResult {
  const checks: FinancialQualityResult["checks"] = [];
  let score = 100;

  const hasAny = input.hasIncome || input.hasBalance || input.hasCashflow;
  checks.push({
    id: "has_data",
    ok: hasAny,
    message: hasAny ? "Có dữ liệu báo cáo" : "Không có dữ liệu",
  });
  if (!hasAny) score -= 80;

  checks.push({
    id: "income",
    ok: input.hasIncome,
    message: input.hasIncome ? "Có IS" : "Thiếu bảng KQKD",
  });
  if (!input.hasIncome) score -= 15;

  checks.push({
    id: "balance",
    ok: input.hasBalance,
    message: input.hasBalance ? "Có BS" : "Thiếu Bảng CĐKT",
  });
  if (!input.hasBalance) score -= 15;

  checks.push({
    id: "cashflow",
    ok: input.hasCashflow,
    message: input.hasCashflow ? "Có CF" : "Thiếu LCTT",
  });
  if (!input.hasCashflow) score -= 10;

  const nonTtm = input.periods.filter((p) => p.periodType !== "ttm");
  checks.push({
    id: "period_depth",
    ok: nonTtm.length >= 4,
    message: `Độ sâu kỳ: ${nonTtm.length}`,
  });
  if (nonTtm.length < 2) score -= 12;
  else if (nonTtm.length < 4) score -= 5;

  const head = nonTtm[0];
  if (head) {
    const m = head.metrics;
    if (m.totalAssets != null && m.totalLiabilities != null && m.equity != null) {
      const lhs = m.totalAssets;
      const rhs = m.totalLiabilities + m.equity;
      const rd = relDiff(lhs, rhs);
      const ok = rd < 0.08;
      checks.push({
        id: "balance_identity",
        ok,
        message: ok
          ? "Tài sản ≈ Nợ + VCSH"
          : `Lệch cân đối ${(rd * 100).toFixed(1)}% (TS vs Nợ+VCSH)`,
      });
      if (!ok) score -= rd >= 0.2 ? 20 : 10;
    }
  }

  if (input.freshness === "STALE") {
    score -= 12;
    checks.push({ id: "freshness", ok: false, message: "STALE cache" });
  } else if (input.freshness === "SOURCE_UNAVAILABLE") {
    score -= 25;
    checks.push({ id: "freshness", ok: false, message: "SOURCE_UNAVAILABLE" });
  } else if (input.freshness === "DISCREPANCY_DETECTED") {
    score -= 15;
    checks.push({ id: "freshness", ok: false, message: "DISCREPANCY_DETECTED" });
  } else {
    checks.push({ id: "freshness", ok: true, message: input.freshness });
  }

  if (input.fallbackLevel >= 2) score -= 8;
  if (input.fallbackLevel >= 4) score -= 12;
  checks.push({
    id: "fallback",
    ok: input.fallbackLevel === 0,
    message: `fallbackLevel=${input.fallbackLevel}`,
  });

  if (input.cross.compared) {
    if (input.cross.confidence === "HIGH") score += 0;
    else if (input.cross.confidence === "MEDIUM") score -= 5;
    else if (input.cross.confidence === "LOW") score -= 15;
    checks.push({
      id: "cross_source",
      ok: input.cross.confidence === "HIGH" || input.cross.confidence === "MEDIUM",
      message: `Cross ${input.cross.confidence} · agreement ${input.cross.agreementScore}`,
    });
  } else {
    checks.push({
      id: "cross_source",
      ok: true,
      message: input.cross.note ?? "Chưa cross-validate",
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status: FinancialQualityResult["status"] = "VALID";
  if (!hasAny) status = "INVALID";
  else if (input.freshness === "STALE") status = "STALE";
  else if (input.cross.discrepancies.some((d) => d.severity === "fail") || score < 50)
    status = "SUSPECT";
  else if (!input.cross.compared) status = score >= 70 ? "VALID" : "UNVERIFIED";
  else if (score < 70) status = "SUSPECT";

  return { score, status, checks, cross: input.cross };
}

import "server-only";

/**
 * Phase 3 — Reconciliation Engine for ORCA Data Hub.
 *
 * Cross-checks data points across Primary and Secondary / Fallback providers:
 * - Detects divergences (discrepancies exceeding tolerance) without silent merging.
 * - Flags unverified records when only a single source exists.
 * - Handles graceful fallback when the primary source is degraded or unavailable.
 * - Produces structured reconciliation reports for downstream UI & auditing.
 */

export type ReconcileStatus = "MATCHED" | "DIVERGENT" | "UNVERIFIED" | "FALLBACK_USED";

export type OverallReconcileStatus = "CONSISTENT" | "DISCREPANT" | "UNVERIFIED";

export type ReconcileSourceValue<T> = {
  sourceId: string;
  value: T;
  timestamp?: number | null;
  qualityScore?: number;
};

export type ReconcileFieldResult<T> = {
  field: string;
  primarySource: string | null;
  primaryValue: T | null;
  secondarySources: string[];
  secondaryValues: Record<string, T>;
  status: ReconcileStatus;
  maxDeltaPct?: number;
  chosenValue: T | null;
  chosenSource: string | null;
  discrepancyNote?: string;
};

export type ReconciliationReport = {
  entityId: string;
  overallStatus: OverallReconcileStatus;
  tolerancePct: number;
  fields: Record<string, ReconcileFieldResult<number | string | null>>;
  discrepanciesCount: number;
  reconciledAt: number;
};

/**
 * Reconciles a single numeric field across primary and secondary sources.
 */
export function reconcileNumericField(
  field: string,
  primary: ReconcileSourceValue<number> | null,
  secondaries: ReconcileSourceValue<number>[],
  tolerancePct = 1.5,
): ReconcileFieldResult<number> {
  const validSecondaries = secondaries.filter(
    (s) => s.value != null && Number.isFinite(s.value),
  );
  const secondaryValues: Record<string, number> = {};
  const secondarySources: string[] = [];

  for (const s of validSecondaries) {
    secondarySources.push(s.sourceId);
    secondaryValues[s.sourceId] = s.value;
  }

  const hasPrimary = primary != null && primary.value != null && Number.isFinite(primary.value);

  // Case 1: Primary is missing, but secondary exists -> FALLBACK_USED
  if (!hasPrimary) {
    if (validSecondaries.length === 0) {
      return {
        field,
        primarySource: primary?.sourceId ?? null,
        primaryValue: null,
        secondarySources: [],
        secondaryValues: {},
        status: "UNVERIFIED",
        chosenValue: null,
        chosenSource: null,
        discrepancyNote: "No valid data from primary or secondary sources",
      };
    }

    // Pick secondary with highest qualityScore or first available
    const sorted = [...validSecondaries].sort(
      (a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0),
    );
    const chosen = sorted[0]!;

    return {
      field,
      primarySource: primary?.sourceId ?? null,
      primaryValue: null,
      secondarySources,
      secondaryValues,
      status: "FALLBACK_USED",
      chosenValue: chosen.value,
      chosenSource: chosen.sourceId,
      discrepancyNote: `Primary source unavailable; fell back to ${chosen.sourceId}`,
    };
  }

  // Case 2: Primary exists, but no secondaries -> UNVERIFIED
  if (validSecondaries.length === 0) {
    return {
      field,
      primarySource: primary!.sourceId,
      primaryValue: primary!.value,
      secondarySources: [],
      secondaryValues: {},
      status: "UNVERIFIED",
      chosenValue: primary!.value,
      chosenSource: primary!.sourceId,
      discrepancyNote: "Single source available; unverified against secondaries",
    };
  }

  // Case 3: Both primary and secondaries exist -> Cross-compare
  const pVal = primary!.value;
  let maxDeltaPct = 0;
  let isDivergent = false;
  const divergentNotes: string[] = [];

  for (const sec of validSecondaries) {
    const sVal = sec.value;
    const base = Math.max(Math.abs(pVal), Math.abs(sVal), 1e-9);
    const deltaPct = (Math.abs(pVal - sVal) / base) * 100;
    if (deltaPct > maxDeltaPct) maxDeltaPct = deltaPct;

    if (deltaPct > tolerancePct) {
      isDivergent = true;
      divergentNotes.push(
        `${sec.sourceId} (${sVal}) diverges from ${primary!.sourceId} (${pVal}) by ${deltaPct.toFixed(2)}% (tol: ${tolerancePct}%)`,
      );
    }
  }

  if (isDivergent) {
    return {
      field,
      primarySource: primary!.sourceId,
      primaryValue: pVal,
      secondarySources,
      secondaryValues,
      status: "DIVERGENT",
      maxDeltaPct: Math.round(maxDeltaPct * 100) / 100,
      chosenValue: pVal,
      chosenSource: primary!.sourceId,
      discrepancyNote: divergentNotes.join("; "),
    };
  }

  return {
    field,
    primarySource: primary!.sourceId,
    primaryValue: pVal,
    secondarySources,
    secondaryValues,
    status: "MATCHED",
    maxDeltaPct: Math.round(maxDeltaPct * 100) / 100,
    chosenValue: pVal,
    chosenSource: primary!.sourceId,
  };
}

/**
 * Reconciles quotes (price, volume) between primary and secondary feeds.
 */
export function reconcileQuotes(
  primaryQuote: {
    sourceId: string;
    symbol: string;
    price: number;
    volume?: number | null;
    timestamp?: number;
    qualityScore?: number;
  } | null,
  secondaryQuotes: Array<{
    sourceId: string;
    symbol: string;
    price: number;
    volume?: number | null;
    timestamp?: number;
    qualityScore?: number;
  }>,
  options?: {
    priceTolerancePct?: number;
    volumeTolerancePct?: number;
  },
): ReconciliationReport {
  const symbol = primaryQuote?.symbol ?? secondaryQuotes[0]?.symbol ?? "UNKNOWN";
  const priceTol = options?.priceTolerancePct ?? 1.5;
  const volTol = options?.volumeTolerancePct ?? 5.0; // volume can differ slightly across book updates

  const pPrice = primaryQuote
    ? {
        sourceId: primaryQuote.sourceId,
        value: primaryQuote.price,
        timestamp: primaryQuote.timestamp,
        qualityScore: primaryQuote.qualityScore,
      }
    : null;

  const secPrices = secondaryQuotes.map((s) => ({
    sourceId: s.sourceId,
    value: s.price,
    timestamp: s.timestamp,
    qualityScore: s.qualityScore,
  }));

  const priceResult = reconcileNumericField("price", pPrice, secPrices, priceTol);

  const fields: Record<string, ReconcileFieldResult<number | string | null>> = {
    price: priceResult as ReconcileFieldResult<number | string | null>,
  };

  // Optional volume comparison
  if (primaryQuote?.volume != null || secondaryQuotes.some((s) => s.volume != null)) {
    const pVol =
      primaryQuote?.volume != null
        ? {
            sourceId: primaryQuote.sourceId,
            value: primaryQuote.volume,
            timestamp: primaryQuote.timestamp,
          }
        : null;

    const secVols = secondaryQuotes
      .filter((s) => s.volume != null)
      .map((s) => ({
        sourceId: s.sourceId,
        value: s.volume!,
        timestamp: s.timestamp,
      }));

    fields.volume = reconcileNumericField("volume", pVol, secVols, volTol) as ReconcileFieldResult<
      number | string | null
    >;
  }

  const results = Object.values(fields);
  const discrepanciesCount = results.filter((r) => r.status === "DIVERGENT").length;
  const isUnverified = results.every((r) => r.status === "UNVERIFIED");

  let overallStatus: OverallReconcileStatus = "CONSISTENT";
  if (discrepanciesCount > 0) {
    overallStatus = "DISCREPANT";
  } else if (isUnverified) {
    overallStatus = "UNVERIFIED";
  }

  return {
    entityId: symbol,
    overallStatus,
    tolerancePct: priceTol,
    fields,
    discrepanciesCount,
    reconciledAt: Date.now(),
  };
}

/**
 * Reconciles financial statement metrics across reporting providers.
 */
export function reconcileFinancialMetrics(
  primaryMetrics: {
    sourceId: string;
    period: string;
    metrics: Record<string, number | null | undefined>;
    qualityScore?: number;
  } | null,
  secondaryMetricsList: Array<{
    sourceId: string;
    period: string;
    metrics: Record<string, number | null | undefined>;
    qualityScore?: number;
  }>,
  tolerancePct = 3.0,
): ReconciliationReport {
  const period = primaryMetrics?.period ?? secondaryMetricsList[0]?.period ?? "UNKNOWN_PERIOD";
  const allMetricKeys = new Set<string>();

  if (primaryMetrics) {
    for (const k of Object.keys(primaryMetrics.metrics)) allMetricKeys.add(k);
  }
  for (const sec of secondaryMetricsList) {
    for (const k of Object.keys(sec.metrics)) allMetricKeys.add(k);
  }

  const fields: Record<string, ReconcileFieldResult<number | string | null>> = {};

  for (const key of allMetricKeys) {
    const pVal =
      primaryMetrics && primaryMetrics.metrics[key] != null && Number.isFinite(primaryMetrics.metrics[key])
        ? {
            sourceId: primaryMetrics.sourceId,
            value: Number(primaryMetrics.metrics[key]),
            qualityScore: primaryMetrics.qualityScore,
          }
        : null;

    const secVals = secondaryMetricsList
      .filter((s) => s.metrics[key] != null && Number.isFinite(s.metrics[key]))
      .map((s) => ({
        sourceId: s.sourceId,
        value: Number(s.metrics[key]),
        qualityScore: s.qualityScore,
      }));

    fields[key] = reconcileNumericField(key, pVal, secVals, tolerancePct) as ReconcileFieldResult<
      number | string | null
    >;
  }

  const results = Object.values(fields);
  const discrepanciesCount = results.filter((r) => r.status === "DIVERGENT").length;
  const isUnverified = results.every((r) => r.status === "UNVERIFIED");

  let overallStatus: OverallReconcileStatus = "CONSISTENT";
  if (discrepanciesCount > 0) {
    overallStatus = "DISCREPANT";
  } else if (isUnverified) {
    overallStatus = "UNVERIFIED";
  }

  return {
    entityId: period,
    overallStatus,
    tolerancePct,
    fields,
    discrepanciesCount,
    reconciledAt: Date.now(),
  };
}

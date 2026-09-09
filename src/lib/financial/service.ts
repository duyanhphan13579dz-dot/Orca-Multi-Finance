import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { periodsToLegacyRows } from "./vndirect-fs";
import { runSourceRouter } from "./provider";
import { listFinancialProviders } from "./providers-registry";
import { buildTtmPeriod, computeGrowth, sortPeriodsNewestFirst } from "./normalize";
import { runOfficialDocumentPipeline } from "./official/pipeline";
import { runFullCrossValidation, scoreFinancialQuality, type FinancialQualityResult } from "./validation";
import { appendValidationLog } from "./validation-log";
import {
  logFallback,
  logFinancialError,
  logPackageServed,
  logValidation,
} from "./monitor";
import { decideFallback } from "./fallback";
import { metricProfileForSymbol } from "./metric-dictionary";
import type {
  FinancialPackage,
  FinancialPackageMeta,
  FinancialSourceMeta,
  FreshnessStatus,
  GrowthSnapshot,
  NormalizedPeriod,
} from "./types";
import type { Meta } from "../types";

function labelPeriod(periods: NormalizedPeriod[]): string | null {
  const nonTtm = periods.find((p) => p.periodType !== "ttm");
  return nonTtm?.period ?? periods[0]?.period ?? null;
}

function buildMetaPackage(
  symbol: string,
  periods: NormalizedPeriod[],
  sources: FinancialSourceMeta[],
  fallbackLevel: FinancialPackageMeta["fallbackLevel"],
  freshness: FreshnessStatus,
  note: string | null,
  ttm: NormalizedPeriod | null,
  growth: GrowthSnapshot | null,
  quality: FinancialQualityResult | null,
  auditFromFiling?: FinancialPackageMeta["auditStatus"],
  scopeFromFiling?: FinancialPackageMeta["statementScope"],
): FinancialPackageMeta {
  const primary = sources.find((s) => s.success)?.id ?? "none";
  const head = periods.find((p) => p.periodType !== "ttm") ?? periods[0];
  const profile = metricProfileForSymbol(symbol);
  return {
    ticker: symbol,
    latestPeriod: labelPeriod(periods),
    reportTypeLabel: head?.periodType === "year" ? "Báo cáo năm" : "Báo cáo quý",
    statementScope: scopeFromFiling ?? head?.statementScope ?? "unknown",
    auditStatus: auditFromFiling ?? head?.auditStatus ?? "unknown",
    primarySource: primary,
    sourcesAttempted: sources,
    fallbackLevel,
    freshnessStatus: freshness,
    fetchedAt: new Date().toISOString(),
    lastVerifiedAt: head ? new Date().toISOString() : null,
    note: [note, `metricProfile=${profile}`].filter(Boolean).join(" · "),
    ttmPeriod: ttm?.period ?? null,
    hasGrowth: Boolean(growth && (growth.yoy.length || growth.qoq.length)),
    qualityScore: quality?.score ?? null,
    qualityStatus: quality?.status ?? null,
    crossConfidence: quality?.cross.confidence ?? null,
    discrepancyCount: quality?.cross.discrepancies.length ?? 0,
  };
}

function runQualityGate(
  sym: string,
  periods: NormalizedPeriod[],
  primarySource: string,
  freshness: FreshnessStatus,
  fallbackLevel: number,
  incomeLen: number,
  balanceLen: number,
  cashflowLen: number,
): FinancialQualityResult {
  const externalSecondaries = periods
    .filter((p) => p.periodType !== "ttm" && p.source && p.source !== primarySource)
    .slice(0, 4)
    .map((p) => ({ source: p.source, period: p }));

  const cross = runFullCrossValidation(periods, primarySource, externalSecondaries);
  let effectiveFreshness = freshness;
  if (cross.discrepancies.some((d) => d.severity === "fail")) {
    effectiveFreshness = "DISCREPANCY_DETECTED";
  }

  const quality = scoreFinancialQuality({
    periods,
    freshness: effectiveFreshness,
    fallbackLevel,
    cross,
    hasIncome: incomeLen > 0,
    hasBalance: balanceLen > 0,
    hasCashflow: cashflowLen > 0,
  });

  logValidation({
    ticker: sym,
    status: quality.status,
    qualityScore: quality.score,
    ok: quality.status === "VALID" || quality.status === "UNVERIFIED",
    message: quality.cross.note ?? undefined,
  });

  void appendValidationLog({
    ticker: sym,
    quality,
    fallbackLevel,
    freshnessStatus: effectiveFreshness,
    primarySource,
  }).catch(() => undefined);

  return quality;
}

export async function getFinancialPackage(symbol: string): Promise<{
  pkg: FinancialPackage;
  health: FinancialHealthResult;
  quality: FinancialQualityResult | null;
  meta: Meta;
} | null> {
  const sym = symbol.toUpperCase();
  const metricProfile = metricProfileForSymbol(sym);

  const officialPromise = runOfficialDocumentPipeline(sym).catch((e) => {
    logFinancialError(e instanceof Error ? e.message : "official_pipeline_error", sym, "official-pipeline");
    return null;
  });

  const cachedRes = await cached(`fin:pkg:${sym}:router:v4:${metricProfile}`, {
    ttlMs: 6 * 3_600_000,
    staleMs: 90 * 24 * 3_600_000,
    producer: async () => {
      const routed = await runSourceRouter(sym, listFinancialProviders(), { limitPeriods: 12 });
      if (!routed) return null;

      const basePeriods = sortPeriodsNewestFirst(routed.periods.filter((p) => p.periodType !== "ttm"));
      const ttm = buildTtmPeriod(basePeriods);
      const growth = computeGrowth(basePeriods);
      const periods = ttm ? [ttm, ...basePeriods] : basePeriods;
      const legacy = periodsToLegacyRows(basePeriods, sym);

      return {
        ...legacy,
        periods,
        ttm,
        growth,
        sourceId: routed.sourceId,
        fallbackLevel: routed.fallbackLevel,
        note: routed.note,
        sourcesAttempted: routed.sourcesAttempted,
        metricProfile,
      };
    },
  }).catch((e) => {
    logFinancialError(e instanceof Error ? e.message : "cache_producer_error", sym);
    return null;
  });

  const official = await officialPromise;

  if (!cachedRes?.value) {
    const emptyHealth = computeFinancialHealth({ income: [], balance: [], cashflow: [] }, { symbol: sym });
    const quality = runQualityGate(sym, [], "none", "SOURCE_UNAVAILABLE", 4, 0, 0, 0);
    logFallback(sym, 4, "all_sources_unavailable");
    logPackageServed(sym, { qualityScore: quality.score, fallbackLevel: 4 });
    const pkg: FinancialPackage = {
      symbol: sym,
      income: [],
      balance: [],
      cashflow: [],
      ratios: [],
      periods: [],
      ttm: null,
      growth: null,
      meta: buildMetaPackage(
        sym,
        [],
        [],
        4,
        "SOURCE_UNAVAILABLE",
        "Không có dữ liệu báo cáo từ mọi nguồn đã đăng ký.",
        null,
        null,
        quality,
      ),
    };
    return {
      pkg,
      health: emptyHealth,
      quality,
      meta: buildMeta({
        source: "financial-engine",
        sourceTimestampMs: Date.now(),
        note: "SOURCE_UNAVAILABLE",
      }),
    };
  }

  const v = cachedRes.value;
  const income = v.income ?? [];
  const balance = v.balance ?? [];
  const cashflow = v.cashflow ?? [];
  const ratios = v.ratios ?? [];
  const periods = (v.periods ?? []) as NormalizedPeriod[];
  const ttm = (v.ttm as NormalizedPeriod | null) ?? null;
  const growth = (v.growth as GrowthSnapshot | null) ?? null;

  let sources: FinancialSourceMeta[] = v.sourcesAttempted ?? [];
  if (!sources.length) {
    sources = [
      {
        id: v.sourceId,
        role: "CACHE",
        priority: 0,
        success: true,
        note: cachedRes.cached ? "cache_hit" : "fresh",
      },
    ];
  }

  sources.push({
    id: "official-pipeline",
    role: "PRIMARY_SOURCE_OF_TRUTH",
    priority: 0,
    success: Boolean(official?.latestFsFiling),
    note: official?.latestFsFiling
      ? `filing:${official.latestFsFiling.period ?? official.latestFsFiling.kind}`
      : official
        ? "no_fs_filing"
        : "pipeline_error",
  });

  let freshness: FreshnessStatus = cachedRes.stale
    ? "STALE"
    : official?.latestFsFiling && official.latestFsFiling.confidence >= 0.85
      ? "VERIFIED"
      : "LATEST_AVAILABLE";

  const quality = runQualityGate(
    sym,
    periods,
    v.sourceId,
    freshness,
    v.fallbackLevel,
    income.length,
    balance.length,
    cashflow.length,
  );

  if (quality.cross.discrepancies.some((d) => d.severity === "fail")) {
    freshness = "DISCREPANCY_DETECTED";
  }

  const health = computeFinancialHealth({ income, balance, cashflow }, { symbol: sym });

  let note = v.note ?? null;
  if (official?.notes?.length) {
    note = [note, ...official.notes.slice(0, 2)].filter(Boolean).join(" · ");
  }
  if (quality.cross.note && quality.cross.compared) {
    note = [note, quality.cross.note].filter(Boolean).join(" · ");
  }
  note = [note, `Bộ chỉ tiêu: ${metricProfile === "bank" ? "Ngân hàng" : "Phi ngân hàng"}`]
    .filter(Boolean)
    .join(" · ");

  const fb = decideFallback({
    periods,
    primaryHit: v.fallbackLevel === 0 && !cachedRes.cached,
    usedSecondary: v.fallbackLevel >= 1,
    fromCache: Boolean(cachedRes.cached),
    cacheStale: Boolean(cachedRes.stale),
    officialOk: Boolean(official?.latestFsFiling),
  });
  const resolvedFallback = fb.level;
  if (fb.freshness === "STALE" || fb.freshness === "SOURCE_UNAVAILABLE") {
    freshness = fb.freshness;
  } else if (freshness !== "DISCREPANCY_DETECTED" && freshness !== "VERIFIED") {
    freshness = fb.freshness;
  }
  note = [note, fb.note].filter(Boolean).join(" · ");

  logFallback(sym, resolvedFallback, fb.label);
  logPackageServed(sym, { qualityScore: quality.score, fallbackLevel: resolvedFallback });

  const filing = official?.latestFsFiling;
  const pkg: FinancialPackage = {
    symbol: sym,
    income,
    balance,
    cashflow,
    ratios,
    periods,
    ttm,
    growth,
    meta: buildMetaPackage(
      sym,
      periods,
      sources,
      resolvedFallback,
      freshness,
      note,
      ttm,
      growth,
      quality,
      filing?.auditStatus,
      filing?.statementScope,
    ),
  };

  const meta = buildMeta({
    source: `financial-engine|${v.sourceId}`,
    sourceTimestampMs: Date.now(),
    cached: cachedRes.cached,
    stale: cachedRes.stale,
    note: pkg.meta.note ?? undefined,
    degraded: quality.status === "SUSPECT" || freshness === "DISCREPANCY_DETECTED",
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 7 * 86_400_000, delayedSlaMs: 90 * 86_400_000 },
  });

  return { pkg, health, quality, meta };
}

export async function getFinancialsForSymbol(symbol: string): Promise<{
  financials: {
    income: Record<string, unknown>[] | null;
    balance: Record<string, unknown>[] | null;
    cashflow: Record<string, unknown>[] | null;
    ratios: Record<string, unknown>[] | null;
  };
  health: FinancialHealthResult;
  packageMeta: FinancialPackageMeta;
  growth: GrowthSnapshot | null;
  ttm: NormalizedPeriod | null;
  quality: FinancialQualityResult | null;
  meta: Meta;
  notes: string[];
} | null> {
  const r = await getFinancialPackage(symbol);
  if (!r) return null;
  const has = r.pkg.income.length + r.pkg.balance.length + r.pkg.cashflow.length > 0;
  const notes: string[] = [];
  if (r.pkg.meta.note) notes.push(r.pkg.meta.note);
  if (r.pkg.meta.freshnessStatus === "STALE") notes.push("Dữ liệu đang dùng bản lưu gần nhất (stale cache).");
  if (r.pkg.meta.freshnessStatus === "DISCREPANCY_DETECTED")
    notes.push("Phát hiện lệch số liệu giữa các nguồn — ưu tiên nguồn chính.");
  if (r.pkg.meta.qualityScore != null)
    notes.push(`Data quality score: ${r.pkg.meta.qualityScore}/100 (${r.pkg.meta.qualityStatus ?? "—"})`);
  if (r.pkg.ttm) notes.push(`TTM sẵn sàng: ${r.pkg.ttm.period}`);
  else notes.push("TTM chưa tính được (cần ≥4 quý).");
  if (r.health.industry) notes.push(`Profile ngành: ${r.health.industry.labelVi} (${r.health.industry.id})`);
  if (r.health.riskFlags?.length) notes.push(...r.health.riskFlags.slice(0, 3));
  if (!has) notes.push("Chưa có báo cáo tài chính khả dụng.");

  return {
    financials: {
      income: r.pkg.income.length ? r.pkg.income : null,
      balance: r.pkg.balance.length ? r.pkg.balance : null,
      cashflow: r.pkg.cashflow.length ? r.pkg.cashflow : null,
      ratios: r.pkg.ratios.length ? r.pkg.ratios : null,
    },
    health: r.health,
    packageMeta: r.pkg.meta,
    growth: r.pkg.growth,
    ttm: r.pkg.ttm,
    quality: r.quality,
    meta: r.meta,
    notes,
  };
}

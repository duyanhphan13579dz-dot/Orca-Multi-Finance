import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { periodsToLegacyRows } from "./vndirect-fs";
import { runSourceRouter } from "./provider";
import { listFinancialProviders } from "./providers-registry";
import { buildTtmPeriod, computeGrowth, sortPeriodsNewestFirst } from "./normalize";
import { runOfficialDocumentPipeline } from "./official/pipeline";
import type {
  FinancialPackage,
  FinancialPackageMeta,
  FinancialSourceMeta,
  FreshnessStatus,
  GrowthSnapshot,
  NormalizedPeriod,
} from "./types";
import type { Meta } from "../types";

/**
 * FINANCIAL DATA RELIABILITY LAYER — Phase 1–4
 * Official pipeline (meta) ∥ Router → normalize → TTM/Growth → industry health
 */

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
  auditFromFiling?: FinancialPackageMeta["auditStatus"],
  scopeFromFiling?: FinancialPackageMeta["statementScope"],
): FinancialPackageMeta {
  const primary = sources.find((s) => s.success)?.id ?? "none";
  const head = periods.find((p) => p.periodType !== "ttm") ?? periods[0];
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
    note,
    ttmPeriod: ttm?.period ?? null,
    hasGrowth: Boolean(growth && (growth.yoy.length || growth.qoq.length)),
  };
}

export async function getFinancialPackage(symbol: string): Promise<{
  pkg: FinancialPackage;
  health: FinancialHealthResult;
  meta: Meta;
} | null> {
  const sym = symbol.toUpperCase();

  // Phase 2: official discovery runs in parallel (does not block structured numbers)
  const officialPromise = runOfficialDocumentPipeline(sym).catch(() => null);

  const cachedRes = await cached(`fin:pkg:${sym}:router:v3`, {
    ttlMs: 6 * 3_600_000,
    staleMs: 90 * 24 * 3_600_000,
    producer: async () => {
      const routed = await runSourceRouter(sym, listFinancialProviders(), { limitPeriods: 12 });
      if (!routed) return null;

      const basePeriods = sortPeriodsNewestFirst(routed.periods.filter((p) => p.periodType !== "ttm"));
      const ttm = buildTtmPeriod(basePeriods);
      const growth = computeGrowth(basePeriods);
      const periods = ttm ? [ttm, ...basePeriods] : basePeriods;
      const legacy = periodsToLegacyRows(basePeriods);

      return {
        ...legacy,
        periods,
        ttm,
        growth,
        sourceId: routed.sourceId,
        fallbackLevel: routed.fallbackLevel,
        note: routed.note,
        sourcesAttempted: routed.sourcesAttempted,
      };
    },
  }).catch(() => null);

  const official = await officialPromise;

  if (!cachedRes?.value) {
    const emptyHealth = computeFinancialHealth({ income: [], balance: [], cashflow: [] }, { symbol: sym });
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
      ),
    };
    return {
      pkg,
      health: emptyHealth,
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
  const periods = v.periods ?? [];
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

  // Record official pipeline attempt in source meta
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

  const health = computeFinancialHealth({ income, balance, cashflow }, { symbol: sym });
  const freshness: FreshnessStatus = cachedRes.stale
    ? "STALE"
    : official?.latestFsFiling && official.latestFsFiling.confidence >= 0.85
      ? "VERIFIED"
      : "LATEST_AVAILABLE";

  let note = v.note ?? null;
  if (official?.notes?.length) {
    note = [note, ...official.notes.slice(0, 2)].filter(Boolean).join(" · ");
  }

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
      v.fallbackLevel,
      freshness,
      note,
      ttm,
      growth,
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
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 7 * 86_400_000, delayedSlaMs: 90 * 86_400_000 },
  });

  return { pkg, health, meta };
}

/** Convenience for stock detail / analysis contracts. */
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
  meta: Meta;
  notes: string[];
} | null> {
  const r = await getFinancialPackage(symbol);
  if (!r) return null;
  const has = r.pkg.income.length + r.pkg.balance.length + r.pkg.cashflow.length > 0;
  const notes: string[] = [];
  if (r.pkg.meta.note) notes.push(r.pkg.meta.note);
  if (r.pkg.meta.freshnessStatus === "STALE") notes.push("Dữ liệu đang dùng bản lưu gần nhất (stale cache).");
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
    meta: r.meta,
    notes,
  };
}

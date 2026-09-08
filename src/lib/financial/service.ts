import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { env } from "../env";
import * as vnstock from "../providers/vnstock";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { fetchVndirectFinancials, periodsToLegacyRows } from "./vndirect-fs";
import type {
  FinancialPackage,
  FinancialPackageMeta,
  FinancialSourceMeta,
  FreshnessStatus,
  NormalizedPeriod,
} from "./types";
import type { Meta } from "../types";

/**
 * FINANCIAL DATA RELIABILITY LAYER
 * Priority: VNStock (if key) → VNDirect structured FS → cache stale.
 * Never fabricates numbers. Always returns best available + metadata.
 */

function vnstockOn() {
  return Boolean(env.vnstockApiKey);
}

async function tryVnstock(symbol: string): Promise<{
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
  latencyMs: number;
} | null> {
  if (!vnstockOn()) return null;
  const t0 = performance.now();
  try {
    const [income, balance, cashflow, ratios] = await Promise.all([
      vnstock.getVnFinancials(symbol, "income", "quarter", 8),
      vnstock.getVnFinancials(symbol, "balance", "quarter", 8),
      vnstock.getVnFinancials(symbol, "cashflow", "quarter", 8),
      vnstock.getVnFinancials(symbol, "ratios", "quarter", 8).catch(() => [] as Record<string, unknown>[]),
    ]);
    if (!income.length && !balance.length) return null;
    return { income, balance, cashflow, ratios, latencyMs: Math.round(performance.now() - t0) };
  } catch {
    return null;
  }
}

function labelPeriod(periods: NormalizedPeriod[]): string | null {
  return periods[0]?.period ?? null;
}

function buildMetaPackage(
  symbol: string,
  periods: NormalizedPeriod[],
  sources: FinancialSourceMeta[],
  fallbackLevel: FinancialPackageMeta["fallbackLevel"],
  freshness: FreshnessStatus,
  note: string | null,
): FinancialPackageMeta {
  const primary = sources.find((s) => s.success)?.id ?? "none";
  const head = periods[0];
  return {
    ticker: symbol,
    latestPeriod: labelPeriod(periods),
    reportTypeLabel: head?.periodType === "year" ? "Báo cáo năm" : "Báo cáo quý",
    statementScope: head?.statementScope ?? "unknown",
    auditStatus: head?.auditStatus ?? "unknown",
    primarySource: primary,
    sourcesAttempted: sources,
    fallbackLevel,
    freshnessStatus: freshness,
    fetchedAt: new Date().toISOString(),
    lastVerifiedAt: head ? new Date().toISOString() : null,
    note,
  };
}

export async function getFinancialPackage(symbol: string): Promise<{
  pkg: FinancialPackage;
  health: FinancialHealthResult;
  meta: Meta;
} | null> {
  const sym = symbol.toUpperCase();
  const sources: FinancialSourceMeta[] = [];

  const cachedRes = await cached(`fin:pkg:${sym}:v1`, {
    ttlMs: 6 * 3_600_000,
    staleMs: 90 * 24 * 3_600_000,
    producer: async () => {
      // STEP: structured / official-capable sources
      const vs = await tryVnstock(sym);
      if (vs) {
        sources.push({
          id: "vnstock",
          role: "FAST_STRUCTURED_DATA_SOURCE",
          priority: 2,
          success: true,
          latencyMs: vs.latencyMs,
        });
        return {
          income: vs.income,
          balance: vs.balance,
          cashflow: vs.cashflow,
          ratios: vs.ratios,
          periods: [] as NormalizedPeriod[],
          sourceId: "vnstock",
          fallbackLevel: 0 as const,
          note: "Dữ liệu cấu trúc từ VNStock",
        };
      }
      sources.push({
        id: "vnstock",
        role: "FAST_STRUCTURED_DATA_SOURCE",
        priority: 2,
        success: false,
        note: vnstockOn() ? "empty_or_error" : "not_configured",
      });

      const vd = await fetchVndirectFinancials(sym, { limitPeriods: 8 });
      if (vd) {
        sources.push({
          id: "vndirect-fs",
          role: "FAST_STRUCTURED_DATA_SOURCE",
          priority: 2,
          success: true,
          latencyMs: vd.latencyMs,
        });
        const legacy = periodsToLegacyRows(vd.periods);
        return {
          ...legacy,
          periods: vd.periods,
          sourceId: "vndirect-fs",
          fallbackLevel: 2 as const,
          note: "Dữ liệu cấu trúc từ VNDirect (báo cáo tài chính). Ưu tiên hiển thị kỳ gần nhất có sẵn.",
        };
      }
      sources.push({
        id: "vndirect-fs",
        role: "FAST_STRUCTURED_DATA_SOURCE",
        priority: 2,
        success: false,
        note: "unavailable",
      });

      return null;
    },
  }).catch(() => null);

  if (!cachedRes?.value) {
    const emptyHealth = computeFinancialHealth({ income: [], balance: [], cashflow: [] });
    const pkg: FinancialPackage = {
      symbol: sym,
      income: [],
      balance: [],
      cashflow: [],
      ratios: [],
      periods: [],
      meta: buildMetaPackage(sym, [], sources, 4, "SOURCE_UNAVAILABLE", "Không có dữ liệu báo cáo từ mọi nguồn."),
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

  // Re-record sources for response (cache may hide attempt list on hit)
  if (!sources.length) {
    sources.push({
      id: v.sourceId,
      role: "CACHE",
      priority: 0,
      success: true,
      note: cachedRes.cached ? "cache_hit" : "fresh",
    });
  }

  const health = computeFinancialHealth({ income, balance, cashflow });
  const freshness: FreshnessStatus = cachedRes.stale
    ? "STALE"
    : v.sourceId === "vnstock"
      ? "VERIFIED"
      : "LATEST_AVAILABLE";

  const pkg: FinancialPackage = {
    symbol: sym,
    income,
    balance,
    cashflow,
    ratios,
    periods,
    meta: buildMetaPackage(
      sym,
      periods,
      sources,
      v.fallbackLevel,
      freshness,
      v.note ?? null,
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
  meta: Meta;
  notes: string[];
} | null> {
  const r = await getFinancialPackage(symbol);
  if (!r) return null;
  const has =
    r.pkg.income.length + r.pkg.balance.length + r.pkg.cashflow.length > 0;
  const notes: string[] = [];
  if (r.pkg.meta.note) notes.push(r.pkg.meta.note);
  if (r.pkg.meta.freshnessStatus === "STALE") notes.push("Dữ liệu đang dùng bản lưu gần nhất (stale cache).");
  if (r.pkg.meta.fallbackLevel >= 2) notes.push("Nguồn chính thức/VNStock không khả dụng — đang dùng nguồn cấu trúc dự phòng.");
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
    meta: r.meta,
    notes,
  };
}

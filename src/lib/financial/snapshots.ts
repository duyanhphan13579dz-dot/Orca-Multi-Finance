import "server-only";
import { cached } from "../cache";
import { getFinancialPackage } from "./service";
import { persistFinancialPackageAsync } from "./persist";
import type { FinancialPackage } from "./types";
import type { FinancialHealthResult } from "../engines/fundamental";
import type { GrowthSnapshot } from "./types";

/**
 * Bulk fundamental snapshots — shared layer for screeners (Fundamental, CANSLIM, Valuation).
 *
 * Strategy:
 *  1. Parallel getFinancialPackage (already TTL-cached 6h / stale 90d) with pool limit
 *  2. Flatten health + growth into a filter-friendly snapshot (extra cache 12h)
 *  3. Best-effort persist periods → financial_statements
 *  4. CANSLIM / Valuation reuse the same package map
 */

export type FundamentalSnapshot = {
  symbol: string;
  reportDate: string | null;
  /** ratios as percent points, e.g. 18.5 = 18.5% */
  roe: number | null;
  roa: number | null;
  ros: number | null;
  roic: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  debtEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  interestCoverage: number | null;
  netDebtToEbitda: number | null;
  fcfTtm: number | null;
  ocfTtm: number | null;
  /** Anchors for valuation (VND full units where applicable) */
  revenue: number | null;
  netProfit: number | null;
  equity: number | null;
  totalDebt: number | null;
  cash: number | null;
  shares: number | null;
  epsTtm: number | null;
  ebitdaTtm: number | null;
  revenueYoyPct: number | null;
  niYoyPct: number | null;
  revenueQoqPct: number | null;
  niQoqPct: number | null;
  coverage: number;
  qualityScore: number | null;
  healthScore: number | null;
  hasGrowth: boolean;
  hasHealth: boolean;
};

export type PackageBundle = {
  symbol: string;
  pkg: FinancialPackage;
  health: FinancialHealthResult;
  growth: GrowthSnapshot | null;
  qualityScore: number | null;
};

const pct = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Number((v * 100).toFixed(2));

function growthPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (Math.abs(raw) <= 3) return Number((raw * 100).toFixed(2));
  return Number(raw.toFixed(2));
}

function growthOf(g: GrowthSnapshot | null | undefined, metric: string, kind: "yoy" | "qoq"): number | null {
  if (!g) return null;
  const cell = (kind === "yoy" ? g.yoy : g.qoq).find((c) => c.metric === metric);
  return growthPct(cell?.changePct ?? null);
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker()));
  return out;
}

export function normalizeSymbols(input: string[] | undefined, fallback: string[], max = 80): string[] {
  const src = input?.length ? input : fallback;
  return [
    ...new Set(
      src
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter((s) => s.length >= 3),
    ),
  ].slice(0, max);
}

export function buildSnapshotFromBundle(b: PackageBundle): FundamentalSnapshot {
  const h = b.health;
  const g = b.growth;
  const p = h.groups.profitability;
  const liq = h.groups.liquidity;
  const lev = h.groups.leverage;
  const cf = h.groups.cashflow;
  const a = h.anchors;

  return {
    symbol: b.symbol,
    reportDate: b.pkg.meta.latestPeriod ?? null,
    roe: pct(p.roe),
    roa: pct(p.roa),
    ros: pct(p.netMargin),
    roic: pct(p.roic),
    grossMargin: pct(p.grossMargin),
    netMargin: pct(p.netMargin),
    operatingMargin: pct(p.operatingMargin),
    debtEquity: lev.debtToEquity != null ? Number(lev.debtToEquity.toFixed(2)) : null,
    currentRatio: liq.currentRatio != null ? Number(liq.currentRatio.toFixed(2)) : null,
    quickRatio: liq.quickRatio != null ? Number(liq.quickRatio.toFixed(2)) : null,
    interestCoverage: lev.interestCoverage != null ? Number(lev.interestCoverage.toFixed(2)) : null,
    netDebtToEbitda: lev.netDebtToEbitda != null ? Number(lev.netDebtToEbitda.toFixed(2)) : null,
    fcfTtm: cf.fcfTtm ?? null,
    ocfTtm: cf.ocfTtm ?? null,
    revenue: a.revenue,
    netProfit: a.netProfit,
    equity: a.equity,
    totalDebt: a.totalDebt,
    cash: a.cash,
    shares: a.shares,
    epsTtm: a.epsTtm,
    ebitdaTtm: a.ebitdaTtm,
    revenueYoyPct: growthOf(g, "revenue", "yoy") ?? growthOf(g, "netRevenue", "yoy"),
    niYoyPct: growthOf(g, "netIncome", "yoy") ?? growthOf(g, "netIncomeParent", "yoy"),
    revenueQoqPct: growthOf(g, "revenue", "qoq") ?? growthOf(g, "netRevenue", "qoq"),
    niQoqPct: growthOf(g, "netIncome", "qoq") ?? growthOf(g, "netIncomeParent", "qoq"),
    coverage: h.coverage,
    qualityScore: b.qualityScore,
    healthScore: h.scores.overall,
    hasGrowth: Boolean(g && (g.yoy.length || g.qoq.length)),
    hasHealth: h.coverage > 0,
  };
}

export async function getFinancialPackagesBulk(
  symbols: string[],
  opts?: { concurrency?: number; persist?: boolean },
): Promise<Map<string, PackageBundle>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const concurrency = opts?.concurrency ?? 5;
  const doPersist = opts?.persist !== false;
  const map = new Map<string, PackageBundle>();

  await mapPool(uniq, concurrency, async (symbol) => {
    try {
      const r = await getFinancialPackage(symbol);
      if (!r) return;
      const has =
        r.pkg.income.length + r.pkg.balance.length + r.pkg.cashflow.length > 0 ||
        (r.pkg.periods?.length ?? 0) > 0;
      if (!has && r.health.coverage <= 0) return;
      map.set(symbol, {
        symbol,
        pkg: r.pkg,
        health: r.health,
        growth: r.pkg.growth,
        qualityScore: r.quality?.score ?? r.pkg.meta.qualityScore ?? null,
      });
      if (doPersist) persistFinancialPackageAsync(r.pkg);
    } catch {
      /* skip */
    }
  });

  return map;
}

export async function getFundamentalSnapshots(
  symbols: string[],
  opts?: { concurrency?: number; persist?: boolean },
): Promise<{ snapshots: FundamentalSnapshot[]; packages: Map<string, PackageBundle>; scanned: number; hit: number }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const packages = await getFinancialPackagesBulk(uniq, {
    concurrency: opts?.concurrency ?? 5,
    persist: opts?.persist,
  });

  const snapshots: FundamentalSnapshot[] = [];
  for (const [symbol, bundle] of packages) {
    const key = `fin:snap:v2:${symbol}`;
    try {
      const res = await cached(key, {
        ttlMs: 12 * 3_600_000,
        staleMs: 7 * 24 * 3_600_000,
        producer: async () => buildSnapshotFromBundle(bundle),
      });
      snapshots.push(res.value);
    } catch {
      snapshots.push(buildSnapshotFromBundle(bundle));
    }
  }

  return {
    snapshots,
    packages,
    scanned: uniq.length,
    hit: packages.size,
  };
}

export async function warmFundamentalSnapshots(
  symbols: string[],
  opts?: { concurrency?: number },
): Promise<{ warmed: number; scanned: number }> {
  const r = await getFundamentalSnapshots(symbols, { ...opts, persist: true });
  return { warmed: r.hit, scanned: r.scanned };
}

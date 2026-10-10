import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getFundamentalSnapshots,
  normalizeSymbols,
  type FundamentalSnapshot,
} from "../financial/snapshots";
import { hubVnQuotes } from "../data-engine";
import { sectorOf, getSecurity, type VnExchange } from "../vn/master";
import { resolveListedEquityUniverse, listedEquityUniverseSync } from "../financial/equity-universe";
import { WORKERS_BUDGET, clampUniverse, resolveSnapshotConcurrency } from "../data-engine/workers-budget";
import { readLatestMarketScan } from "./market-screener-snapshots";

function exchangeOf(symbol: string): string | null {
  return getSecurity(symbol)?.exchange ?? null;
}

export type FundamentalScreenRow = {
  symbol: string;
  sector: string | null;
  exchange: string | null;
  price: number | null;
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
  revenueYoyPct: number | null;
  niYoyPct: number | null;
  coverage: number;
  qualityScore: number | null;
  healthScore: number | null;
  reportDate: string | null;
  score: number;
};

export type FundamentalFilterOpts = {
  symbols?: string[];
  sector?: string;
  exchange?: VnExchange | string;
  minRoe?: number;
  maxRoe?: number;
  minRoa?: number;
  maxRoa?: number;
  minRos?: number;
  maxRos?: number;
  minRoic?: number;
  maxRoic?: number;
  minGrossMargin?: number;
  maxGrossMargin?: number;
  minNetMargin?: number;
  maxNetMargin?: number;
  minOperatingMargin?: number;
  maxOperatingMargin?: number;
  minDebtEquity?: number;
  maxDebtEquity?: number;
  minCurrentRatio?: number;
  maxCurrentRatio?: number;
  minCoverage?: number;
  minHealthScore?: number;
  minQualityScore?: number;
  minNiYoy?: number;
  maxNiYoy?: number;
  minRevenueYoy?: number;
  maxRevenueYoy?: number;
  maxNetDebtEbitda?: number;
  requirePositiveFcf?: boolean;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
};

function bandScore(v: number | null, bands: [number, number][]): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  for (const [min, score] of bands) if (v >= min) return score;
  return 20;
}

/** Cap extreme ratios that are usually data errors (e.g. ROE 400%). */
function sanePct(v: number | null, maxAbs = 120): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > maxAbs) return null;
  return v;
}

function computeScreenScore(s: FundamentalSnapshot): number {
  if (s.coverage < 0.15 && s.roe == null && s.roa == null) return 0;

  const roe = sanePct(s.roe);
  const roic = sanePct(s.roic);
  const nm = sanePct(s.netMargin, 80);
  const gm = sanePct(s.grossMargin, 95);

  const parts: { w: number; s: number }[] = [];
  const roeS = bandScore(roe, [[22, 95], [15, 85], [10, 70], [5, 50], [0, 35]]);
  const roicS = bandScore(roic, [[18, 95], [12, 85], [8, 70], [4, 50], [0, 35]]);
  const nmS = bandScore(nm, [[20, 95], [12, 85], [7, 70], [3, 55], [0, 40]]);
  const gmS = bandScore(gm, [[40, 90], [25, 75], [15, 60], [8, 45]]);
  const deS =
    s.debtEquity == null || !Number.isFinite(s.debtEquity)
      ? null
      : s.debtEquity < 0
        ? 10
        : s.debtEquity < 0.5
          ? 90
          : s.debtEquity < 1
            ? 75
            : s.debtEquity < 1.5
              ? 55
              : s.debtEquity < 2.5
                ? 35
                : 20;
  const crS = bandScore(s.currentRatio, [[2, 90], [1.5, 75], [1.1, 60], [0.8, 40]]);
  const covS = s.coverage >= 0.7 ? 90 : s.coverage >= 0.4 ? 65 : s.coverage > 0.2 ? 45 : 25;

  const niYoy = sanePct(s.niYoyPct, 200);
  const growthS =
    niYoy == null
      ? null
      : niYoy >= 25
        ? 90
        : niYoy >= 10
          ? 75
          : niYoy >= 0
            ? 55
            : niYoy >= -15
              ? 35
              : 20;

  if (roeS != null) parts.push({ w: 0.26, s: roeS });
  if (roicS != null) parts.push({ w: 0.2, s: roicS });
  if (nmS != null) parts.push({ w: 0.16, s: nmS });
  if (gmS != null) parts.push({ w: 0.08, s: gmS });
  if (deS != null) parts.push({ w: 0.12, s: deS });
  if (crS != null) parts.push({ w: 0.05, s: crS });
  if (covS != null) parts.push({ w: 0.07, s: covS });
  if (growthS != null) parts.push({ w: 0.06, s: growthS });

  if (!parts.length) return 0;
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  let score = parts.reduce((a, p) => a + p.s * p.w, 0) / wSum;

  if (s.coverage < 0.35) score *= 0.85;
  if (s.qualityScore != null && s.qualityScore < 40) score *= 0.9;

  return Math.round(Math.max(0, Math.min(100, score)));
}

function passesFilters(row: FundamentalScreenRow, f: FundamentalFilterOpts): boolean {
  if (f.sector && row.sector !== f.sector) return false;
  if (f.exchange) {
    const ex = String(f.exchange).toUpperCase();
    if (row.exchange && row.exchange.toUpperCase() !== ex) return false;
    if (!row.exchange) return false;
  }
  const check = (val: number | null, min?: number, max?: number) => {
    if (min != null && Number.isFinite(min) && (val == null || val < min)) return false;
    if (max != null && Number.isFinite(max) && (val == null || val > max)) return false;
    return true;
  };
  if (!check(row.roe, f.minRoe, f.maxRoe)) return false;
  if (!check(row.roa, f.minRoa, f.maxRoa)) return false;
  if (!check(row.ros, f.minRos, f.maxRos)) return false;
  if (!check(row.roic, f.minRoic, f.maxRoic)) return false;
  if (!check(row.grossMargin, f.minGrossMargin, f.maxGrossMargin)) return false;
  if (!check(row.netMargin, f.minNetMargin, f.maxNetMargin)) return false;
  if (!check(row.operatingMargin, f.minOperatingMargin, f.maxOperatingMargin)) return false;
  if (!check(row.debtEquity, f.minDebtEquity, f.maxDebtEquity)) return false;
  if (!check(row.currentRatio, f.minCurrentRatio, f.maxCurrentRatio)) return false;
  if (!check(row.price, f.minPrice, f.maxPrice)) return false;
  if (!check(row.niYoyPct, f.minNiYoy, f.maxNiYoy)) return false;
  if (!check(row.revenueYoyPct, f.minRevenueYoy, f.maxRevenueYoy)) return false;
  if (f.minCoverage != null && Number.isFinite(f.minCoverage) && row.coverage < f.minCoverage) return false;
  if (
    f.minHealthScore != null &&
    Number.isFinite(f.minHealthScore) &&
    (row.healthScore == null || row.healthScore < f.minHealthScore)
  )
    return false;
  if (
    f.minQualityScore != null &&
    Number.isFinite(f.minQualityScore) &&
    (row.qualityScore == null || row.qualityScore < f.minQualityScore)
  )
    return false;
  if (
    f.maxNetDebtEbitda != null &&
    Number.isFinite(f.maxNetDebtEbitda) &&
    (row.netDebtToEbitda == null || row.netDebtToEbitda > f.maxNetDebtEbitda)
  )
    return false;
  if (f.requirePositiveFcf && (row.fcfTtm == null || row.fcfTtm <= 0)) return false;
  return true;
}

function toRow(s: FundamentalSnapshot, price: number | null): FundamentalScreenRow {
  return {
    symbol: s.symbol,
    sector: sectorOf(s.symbol),
    exchange: exchangeOf(s.symbol),
    price,
    roe: s.roe,
    roa: s.roa,
    ros: s.ros,
    roic: s.roic,
    grossMargin: s.grossMargin,
    netMargin: s.netMargin,
    operatingMargin: s.operatingMargin,
    debtEquity: s.debtEquity,
    currentRatio: s.currentRatio,
    quickRatio: s.quickRatio,
    interestCoverage: s.interestCoverage,
    netDebtToEbitda: s.netDebtToEbitda,
    fcfTtm: s.fcfTtm,
    ocfTtm: s.ocfTtm,
    revenueYoyPct: s.revenueYoyPct,
    niYoyPct: s.niYoyPct,
    coverage: s.coverage,
    qualityScore: s.qualityScore,
    healthScore: s.healthScore,
    reportDate: s.reportDate,
    score: computeScreenScore(s),
  };
}

export async function screenFundamental(opts: FundamentalFilterOpts = {}) {
  const fullMarket = !opts.symbols?.length
    ? await readLatestMarketScan<FundamentalScreenRow>("fundamental")
    : null;
  const uniMax = clampUniverse(WORKERS_BUDGET.screenerUniverse);
  let fallback = listedEquityUniverseSync(uniMax);
  try {
    if (!opts.symbols?.length && !fullMarket) {
      const uni = await resolveListedEquityUniverse({ max: uniMax });
      if (uni.symbols.length) fallback = uni.symbols;
    }
  } catch {
    /* master fallback */
  }
  const symbols = normalizeSymbols(
    opts.symbols,
    fallback,
    opts.symbols?.length ? Math.min(opts.symbols.length, WORKERS_BUDGET.screenerUniverseMax) : uniMax,
  );
  const cacheKey = `screener:fundamental:v7:${symbols.join(",")}`;

  const result = fullMarket
    ? null
    : await cached(cacheKey, {
        ttlMs: 20 * 60_000,
        staleMs: 2 * 60 * 60_000,
        softSwr: true,
        producer: async () => {
          const [snapPack, quotes] = await Promise.all([
            getFundamentalSnapshots(symbols, {
              concurrency: resolveSnapshotConcurrency(),
              persist: false,
            }),
            hubVnQuotes(symbols).catch(() => null),
          ]);
          const quoteMap = new Map<string, { price?: number | null }>();
          for (const quote of quotes?.quotes ?? []) {
            if (quote.symbol) quoteMap.set(quote.symbol, quote);
          }

          const rows: FundamentalScreenRow[] = [];
          for (const s of snapPack.snapshots) {
            if (!s.hasHealth && s.roe == null && s.roa == null && s.netMargin == null) continue;
            const price = quoteMap.get(s.symbol)?.price ?? null;
            rows.push(toRow(s, price));
          }
          rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
          return { allRows: rows, scanned: snapPack.scanned, withData: snapPack.hit };
        },
      });

  // Never throw on empty/failed cache — return soft empty shell
  const pack = fullMarket
    ? { allRows: fullMarket.rows, scanned: fullMarket.scanned, withData: fullMarket.withData }
    : result?.value ?? null;

  if (!pack) {
    return {
      rows: [] as FundamentalScreenRow[],
      scanned: 0,
      skipped: 0,
      withData: 0,
      meta: buildMeta({
        source: "fundamental-shell",
        partial: true,
        stale: true,
        note: "Fundamental screener tạm trống — đang phục hồi",
      }),
    };
  }

  const allRows = pack.allRows ?? [];
  const scanned = pack.scanned ?? 0;
  const withData = pack.withData ?? 0;
  let rows = allRows.filter((r) => passesFilters(r, opts));
  if (opts.sector) rows = rows.filter((r) => r.sector === opts.sector);
  const limit = Math.min(opts.limit ?? 80, 100);
  rows = rows.slice(0, limit);

  return {
    rows,
    scanned,
    skipped: Math.max(0, scanned - withData),
    withData,
    meta: buildMeta({
      source: fullMarket ? "fundamental-market-snapshot" : "financial-snapshots+bctc",
      cached: fullMarket != null || result?.cached,
      stale: fullMarket ? fullMarket.ageMs > 24 * 60 * 60_000 : result?.stale,
      partial: scanned > withData,
      note: fullMarket
        ? `Quét toàn thị trường · ${rows.length} khớp / ${withData} có data / ${scanned} mã · cycle ${fullMarket.cycle}`
        : `BCTC · ${rows.length} khớp / ${withData} có data / ${scanned} quét`,
    }),
  };
}

export { listedEquityUniverseSync as DEFAULT_FUNDAMENTAL_UNIVERSE };

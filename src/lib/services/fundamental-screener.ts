import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getFundamentalSnapshots,
  normalizeSymbols,
  type FundamentalSnapshot,
} from "../financial/snapshots";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import { DEFAULT_SYMBOLS } from "./valuation-screener";

export type FundamentalScreenRow = {
  symbol: string;
  sector: string | null;
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
  minDebtEquity?: number;
  maxDebtEquity?: number;
  minCurrentRatio?: number;
  maxCurrentRatio?: number;
  minCoverage?: number;
  minHealthScore?: number;
  minNiYoy?: number;
  limit?: number;
};

function bandScore(v: number | null, bands: [number, number][]): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  for (const [min, score] of bands) if (v >= min) return score;
  return 20;
}

/** Weighted quality score 0–100 from snapshot metrics (percent units). */
function computeScreenScore(s: FundamentalSnapshot): number {
  const parts: { w: number; s: number }[] = [];
  const roeS = bandScore(s.roe, [[22, 95], [15, 85], [10, 70], [5, 50], [0, 35]]);
  const roicS = bandScore(s.roic, [[18, 95], [12, 85], [8, 70], [4, 50], [0, 35]]);
  const nmS = bandScore(s.netMargin, [[20, 95], [12, 85], [7, 70], [3, 55], [0, 40]]);
  const gmS = bandScore(s.grossMargin, [[40, 90], [25, 75], [15, 60], [8, 45]]);
  const deS =
    s.debtEquity == null
      ? null
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
  const covS = s.coverage >= 0.7 ? 90 : s.coverage >= 0.4 ? 65 : s.coverage > 0 ? 40 : null;

  if (roeS != null) parts.push({ w: 0.28, s: roeS });
  if (roicS != null) parts.push({ w: 0.22, s: roicS });
  if (nmS != null) parts.push({ w: 0.18, s: nmS });
  if (gmS != null) parts.push({ w: 0.1, s: gmS });
  if (deS != null) parts.push({ w: 0.12, s: deS });
  if (crS != null) parts.push({ w: 0.05, s: crS });
  if (covS != null) parts.push({ w: 0.05, s: covS });

  if (!parts.length) return 0;
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  return Math.round(parts.reduce((a, p) => a + p.s * p.w, 0) / wSum);
}

function passesFilters(row: FundamentalScreenRow, f: FundamentalFilterOpts): boolean {
  if (f.sector && row.sector !== f.sector) return false;
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
  if (!check(row.debtEquity, f.minDebtEquity, f.maxDebtEquity)) return false;
  if (!check(row.currentRatio, f.minCurrentRatio, f.maxCurrentRatio)) return false;
  if (f.minCoverage != null && Number.isFinite(f.minCoverage) && row.coverage < f.minCoverage) return false;
  if (f.minHealthScore != null && Number.isFinite(f.minHealthScore) && (row.healthScore == null || row.healthScore < f.minHealthScore))
    return false;
  if (f.minNiYoy != null && Number.isFinite(f.minNiYoy) && (row.niYoyPct == null || row.niYoyPct < f.minNiYoy))
    return false;
  return true;
}

function toRow(s: FundamentalSnapshot, price: number | null): FundamentalScreenRow {
  return {
    symbol: s.symbol,
    sector: sectorOf(s.symbol),
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
  const symbols = normalizeSymbols(opts.symbols, DEFAULT_SYMBOLS.split(","), 80);
  const cacheKey = `screener:fundamental:v2:${symbols.join(",")}`;

  const result = await cached(cacheKey, {
    ttlMs: 15 * 60_000,
    staleMs: 60 * 60_000,
    producer: async () => {
      const [snapPack, quotes] = await Promise.all([
        getFundamentalSnapshots(symbols, { concurrency: 5 }),
        getVnQuotes(symbols).catch(() => null),
      ]);
      const quoteMap = new Map((quotes?.quotes ?? []).map((q) => [q.symbol, q]));

      const rows: FundamentalScreenRow[] = [];
      for (const s of snapPack.snapshots) {
        if (!s.hasHealth && s.roe == null && s.roa == null && s.netMargin == null) continue;
        const price = quoteMap.get(s.symbol)?.price ?? null;
        rows.push(toRow(s, price));
      }
      rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
      return {
        allRows: rows,
        scanned: snapPack.scanned,
        withData: snapPack.hit,
      };
    },
  });

  let rows = result.value.allRows.filter((r) => passesFilters(r, opts));
  if (opts.sector) rows = rows.filter((r) => r.sector === opts.sector);
  const limit = Math.min(opts.limit ?? 80, 100);
  rows = rows.slice(0, limit);

  return {
    rows,
    scanned: result.value.scanned,
    skipped: result.value.scanned - result.value.withData,
    withData: result.value.withData,
    meta: buildMeta({
      source: "financial-snapshots+bctc",
      cached: result.cached,
      stale: result.stale,
      partial: result.value.scanned > result.value.withData,
      note: `BCTC snapshot bulk · ${rows.length} khớp lọc / ${result.value.withData} có data / ${result.value.scanned} quét · score = ROE·ROIC·biên·đòn bẩy·coverage`,
    }),
  };
}

export { DEFAULT_SYMBOLS };

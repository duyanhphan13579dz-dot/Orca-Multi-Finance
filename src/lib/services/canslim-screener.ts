import "server-only";
import { buildMeta } from "../freshness";
import { analyzeCanslim, retPct, type CanslimLetter, type CanslimSnapshot } from "../engines/canslim";
import { getFinancialPackagesBulk, mapPool } from "../financial/snapshots";
import { getVnIndices, getVnOhlcv } from "./stocks";
import { batchVnOhlcv } from "./ohlcv-batch";
import { hubVnQuotes } from "../data-engine";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getVndEquitySnapshot, getVndValuationRatios } from "../providers/vndirect-company";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta, OhlcvBar } from "../types";

export interface CanslimScreenRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  score: number;
  grade: CanslimSnapshot["grade"];
  gradeVi: string;
  passCount: number;
  passLetters: CanslimLetter[];
  letters: CanslimSnapshot["letters"];
  metrics: CanslimSnapshot["metrics"];
  dataCoverage: CanslimSnapshot["dataCoverage"];
  flags: string[];
  notes: string[];
}

export interface CanslimCoverageStats {
  withBars: number;
  withGrowth: number;
  withHealth: number;
  withForeign: number;
  withRatios: number;
  withEquity: number;
}

/** Default universe when caller does not pass symbols (keep lean for serverless). */
const CANSLIM_DEFAULT_CAP = 28;
/** Hard max even when symbols= provided. */
const CANSLIM_HARD_CAP = 40;
/** Bars: need ~126 for 6M RS + room for high; 140 is enough (was 260). */
const CANSLIM_BARS = 140;
/** Soft wall-clock budget (ms) before skipping secondary (I/ratios/equity). */
const SECONDARY_BUDGET_MS = 45_000;

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** M: VNINDEX — session Δ% + MA50 + 3M momentum. */
async function resolveMarketDirection(): Promise<{
  bullish: boolean | null;
  detail: string;
  source: string;
}> {
  try {
    const [idxPack, ohlcv] = await Promise.all([
      getVnIndices().catch(() => null),
      getVnOhlcv("VNINDEX", 120).catch(() => null),
    ]);
    const vn =
      idxPack?.items?.find((x) => x.code === "VNINDEX") ??
      idxPack?.items?.find((x) => x.code === "VN30");
    const bars = ohlcv?.bars ?? [];
    const closes = bars.map((b) => b.close);
    const ma50 = sma(closes, 50);
    const last = closes[closes.length - 1];
    const ret63 = bars.length >= 65 ? retPct(bars, 63) : null;

    const parts: string[] = [];
    let score = 0;
    let votes = 0;

    if (vn?.changePercent != null) {
      votes += 1;
      if (vn.changePercent > 0.3) {
        score += 1;
        parts.push(`phiên +${vn.changePercent.toFixed(1)}%`);
      } else if (vn.changePercent < -1.2) {
        score -= 1;
        parts.push(`phiên ${vn.changePercent.toFixed(1)}%`);
      } else {
        parts.push(`phiên ${vn.changePercent.toFixed(1)}%`);
      }
    }

    if (last != null && ma50 != null && ma50 > 0) {
      votes += 1;
      const vsMa = ((last - ma50) / ma50) * 100;
      if (vsMa > 0) {
        score += 1;
        parts.push(`trên MA50 (+${vsMa.toFixed(1)}%)`);
      } else {
        score -= 1;
        parts.push(`dưới MA50 (${vsMa.toFixed(1)}%)`);
      }
    }

    if (ret63 != null) {
      votes += 1;
      if (ret63 > 3) {
        score += 1;
        parts.push(`3M +${ret63.toFixed(0)}%`);
      } else if (ret63 < -5) {
        score -= 1;
        parts.push(`3M ${ret63.toFixed(0)}%`);
      } else {
        parts.push(`3M ${ret63.toFixed(0)}%`);
      }
    }

    if (votes === 0) return { bullish: null, detail: "Chưa lấy được VNINDEX", source: "none" };

    const bullish =
      score > 0 ? true : score < 0 ? false : vn?.changePercent != null ? vn.changePercent > -1 : null;
    return {
      bullish,
      detail: `VNINDEX: ${parts.join(" · ") || "n/a"}`,
      source: bars.length ? "vndirect-index-ohlcv+quote" : "vndirect-index-quote",
    };
  } catch {
    return { bullish: null, detail: "Lỗi nguồn chỉ số", source: "error" };
  }
}

export async function screenCanslim(args?: {
  symbols?: string[];
  minScore?: number;
  minPass?: number;
  requireLetters?: CanslimLetter[];
  sector?: string;
  limit?: number;
}): Promise<{
  rows: CanslimScreenRow[];
  scanned: number;
  skipped: number;
  marketBullish: boolean | null;
  marketDetail: string;
  coverage: CanslimCoverageStats;
  meta: Meta;
} | null> {
  const t0 = Date.now();
  const userSymbols = Boolean(args?.symbols?.length);
  const cap = userSymbols ? CANSLIM_HARD_CAP : CANSLIM_DEFAULT_CAP;
  const uniq = [
    ...new Set(
      (args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean),
    ),
  ].slice(0, cap);

  const [quotesPack, market] = await Promise.all([
    hubVnQuotes(uniq).catch(() => null),
    resolveMarketDirection(),
  ]);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));

  // Pass 1 — batch OHLCV (concurrency 10, 140 bars, no per-symbol retry sleep)
  const ohlcvMap = await batchVnOhlcv(uniq, { bars: CANSLIM_BARS, concurrency: 10 });
  type Pack = { symbol: string; bars: OhlcvBar[]; ret6: number | null };
  const valid: Pack[] = [];
  let skipped = 0;
  for (const sym of uniq) {
    const pack = ohlcvMap.get(sym);
    const bars = pack?.bars ?? [];
    if (bars.length < 30) {
      skipped += 1;
      continue;
    }
    valid.push({ symbol: sym, bars, ret6: retPct(bars, 126) });
  }

  const rets = valid
    .map((p) => p.ret6)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);

  function rsRankOf(r: number | null): number | null {
    if (r == null || !rets.length) return null;
    let below = 0;
    for (const x of rets) if (x < r) below += 1;
    return Math.round((below / rets.length) * 100);
  }

  const coverage: CanslimCoverageStats = {
    withBars: valid.length,
    withGrowth: 0,
    withHealth: 0,
    withForeign: 0,
    withRatios: 0,
    withEquity: 0,
  };

  // Pass 2 — BCTC bulk (shared cache hub)
  const finMap = await getFinancialPackagesBulk(
    valid.map((p) => p.symbol),
    { concurrency: 6, persist: false },
  );

  const elapsedAfterFin = Date.now() - t0;
  const allowSecondary = elapsedAfterFin < SECONDARY_BUDGET_MS;
  const secondaryTimeoutMs = allowSecondary
    ? Math.max(2_500, Math.min(6_000, SECONDARY_BUDGET_MS - elapsedAfterFin))
    : 0;

  // Pass 3 — score each symbol; secondary (I/ratios/equity) only if budget remains
  const analyzed = await mapPool(valid, allowSecondary ? 5 : 8, async (p) => {
    let foreign: Awaited<ReturnType<typeof getVndSymbolForeignFlow>> | null = null;
    let equity: Awaited<ReturnType<typeof getVndEquitySnapshot>> | null = null;
    let ratios: Awaited<ReturnType<typeof getVndValuationRatios>> | null = null;

    if (allowSecondary && secondaryTimeoutMs > 0) {
      const sec = await withTimeout(
        Promise.all([
          getVndSymbolForeignFlow(p.symbol, 5).catch(() => null),
          getVndEquitySnapshot(p.symbol).catch(() => null),
          getVndValuationRatios(p.symbol).catch(() => null),
        ]),
        secondaryTimeoutMs,
      );
      if (sec) {
        foreign = sec[0];
        equity = sec[1];
        ratios = sec[2];
      }
    }

    const fin = finMap.get(p.symbol) ?? null;
    const net1 = foreign?.latest?.netVal ?? null;
    const hist = foreign?.history ?? [];
    const net5 =
      hist.length > 0 ? hist.slice(0, 5).reduce((s, d) => s + (d.netVal || 0), 0) : null;

    if (fin?.growth && (fin.growth.yoy.length || fin.growth.qoq.length)) coverage.withGrowth += 1;
    if (fin?.health && fin.health.coverage > 0) coverage.withHealth += 1;
    if (net1 != null || net5 != null) coverage.withForeign += 1;
    if (ratios?.roe != null || ratios?.eps != null) coverage.withRatios += 1;
    if (equity?.sharesOutstanding) coverage.withEquity += 1;

    const snap = analyzeCanslim({
      bars: p.bars,
      growth: fin?.growth ?? null,
      health: fin?.health ?? null,
      periods: fin?.pkg.periods ?? null,
      foreignNetVal: net1,
      foreignNet5d: net5,
      marketBullish: market.bullish,
      marketDetail: market.detail,
      rsRank: rsRankOf(p.ret6),
      ratiosRoePct: ratios?.roe ?? null,
      ratiosEps: ratios?.eps ?? null,
      sharesOutstanding: equity?.sharesOutstanding ?? null,
    });

    const q = quoteMap.get(p.symbol);
    const sec = getSecurity(p.symbol);
    const row: CanslimScreenRow = {
      symbol: p.symbol,
      name: sec?.name ?? q?.name ?? null,
      sector: sectorOf(p.symbol) ?? sec?.sector ?? null,
      price: q?.price ?? p.bars[p.bars.length - 1]?.close ?? null,
      changePercent: q?.changePercent ?? null,
      volume: q?.quoteVolume ?? q?.volume ?? p.bars[p.bars.length - 1]?.volume ?? null,
      score: snap.score,
      grade: snap.grade,
      gradeVi: snap.gradeVi,
      passCount: snap.passCount,
      passLetters: snap.letters.filter((l) => l.pass).map((l) => l.letter),
      letters: snap.letters,
      metrics: snap.metrics,
      dataCoverage: snap.dataCoverage,
      flags: snap.flags,
      notes: snap.notes,
    };
    return row;
  });

  let rows = analyzed.filter((r): r is CanslimScreenRow => r != null);

  if (args?.minScore != null) rows = rows.filter((r) => r.score >= args.minScore!);
  if (args?.minPass != null) rows = rows.filter((r) => r.passCount >= args.minPass!);
  if (args?.requireLetters?.length) {
    const need = new Set(args.requireLetters);
    rows = rows.filter((r) => [...need].every((L) => r.passLetters.includes(L)));
  }
  if (args?.sector) rows = rows.filter((r) => r.sector === args.sector);

  rows.sort(
    (a, b) => b.score - a.score || b.passCount - a.passCount || (b.volume ?? 0) - (a.volume ?? 0),
  );
  const limit = Math.min(args?.limit ?? 40, 72);
  rows = rows.slice(0, limit);

  const ms = Date.now() - t0;
  const covNote = `BCTC ${coverage.withGrowth}/${valid.length} growth · health ${coverage.withHealth} · ROE ${coverage.withRatios} · NN ${coverage.withForeign} · CP ${coverage.withEquity} · nến ${coverage.withBars} · ${ms}ms${allowSecondary ? "" : " · secondary-skipped"}`;

  return {
    rows,
    scanned: uniq.length,
    skipped,
    marketBullish: market.bullish,
    marketDetail: market.detail,
    coverage,
    meta: buildMeta({
      source:
        [quotesPack?.meta?.source, "bctc-bulk", "ohlcv-batch", market.source]
          .filter(Boolean)
          .join("+") || "canslim-pipeline",
      sourceTimestampMs: Date.now(),
      hasData: rows.length > 0 || valid.length > 0,
      partial:
        skipped > 0 ||
        (valid.length > 0 && coverage.withGrowth < valid.length * 0.5) ||
        !allowSecondary,
      note: `CANSLIM · quét ${uniq.length} · ${covNote} · ${market.detail} · không phải tín hiệu GD`,
    }),
  };
}

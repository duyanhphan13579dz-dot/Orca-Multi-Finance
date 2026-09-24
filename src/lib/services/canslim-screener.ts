import "server-only";
import { buildMeta } from "../freshness";
import { analyzeCanslim, retPct, type CanslimLetter, type CanslimSnapshot } from "../engines/canslim";
import { getFinancialPackagesBulk, mapPool } from "../financial/snapshots";
import { getVnIndices, getVnOhlcv } from "./stocks";
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

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** M: VNINDEX OHLCV — giá vs MA50 + đà 3 tháng + Δ% phiên. */
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
    const vn = idxPack?.items?.find((x) => x.code === "VNINDEX") ?? idxPack?.items?.find((x) => x.code === "VN30");
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

    const bullish = score > 0 ? true : score < 0 ? false : vn?.changePercent != null ? vn.changePercent > -1 : null;
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
  const uniq = [
    ...new Set((args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean)),
  ].slice(0, 48);

  const [quotesPack, market] = await Promise.all([hubVnQuotes(uniq).catch(() => null), resolveMarketDirection()]);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));

  let skipped = 0;
  type Pack = { symbol: string; bars: OhlcvBar[]; ret6: number | null };

  // Pass 1 — OHLCV (pool 6)
  const packs = await mapPool(uniq, 6, async (symbol): Promise<Pack | null> => {
    const ohlcv = await getVnOhlcv(symbol, 260).catch(() => null);
    const bars = ohlcv?.bars ?? [];
    if (bars.length < 40) {
      skipped += 1;
      return null;
    }
    return { symbol, bars, ret6: retPct(bars, 126) };
  });
  const valid = packs.filter((p): p is Pack => p != null);
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

  // Pass 2a — bulk BCTC (shared cache with Fundamental screener)
  const finMap = await getFinancialPackagesBulk(
    valid.map((p) => p.symbol),
    { concurrency: 5 },
  );

  // Pass 2b — foreign + equity + ratios (pool 4), BCTC already warm
  const analyzed = await mapPool(valid, 4, async (p) => {
    const [foreign, equity, ratios] = await Promise.all([
      getVndSymbolForeignFlow(p.symbol, 8).catch(() => null),
      getVndEquitySnapshot(p.symbol).catch(() => null),
      getVndValuationRatios(p.symbol).catch(() => null),
    ]);

    const fin = finMap.get(p.symbol) ?? null;
    const net1 = foreign?.latest?.netVal ?? null;
    const hist = foreign?.history ?? [];
    const net5 =
      hist.length > 0
        ? hist.slice(0, 5).reduce((s, d) => s + (d.netVal || 0), 0)
        : null;

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

  rows.sort((a, b) => b.score - a.score || b.passCount - a.passCount || (b.volume ?? 0) - (a.volume ?? 0));
  const limit = Math.min(args?.limit ?? 40, 48);
  rows = rows.slice(0, limit);

  if (!rows.length && skipped === uniq.length) return null;

  const covNote = `BCTC bulk ${coverage.withGrowth}/${valid.length} growth · health ${coverage.withHealth} · ROE/ratios ${coverage.withRatios} · NN ${coverage.withForeign} · CP ${coverage.withEquity} · nến ${coverage.withBars}`;

  return {
    rows,
    scanned: uniq.length,
    skipped,
    marketBullish: market.bullish,
    marketDetail: market.detail,
    coverage,
    meta: buildMeta({
      source: [quotesPack?.meta?.source, "bctc-bulk", "vnd-ratios", "ohlcv", market.source].filter(Boolean).join("+") || "canslim-pipeline",
      sourceTimestampMs: Date.now(),
      partial: skipped > 0 || coverage.withGrowth < valid.length * 0.5,
      note: `CANSLIM · quét ${uniq.length} · ${covNote} · ${market.detail} · không phải tín hiệu GD`,
    }),
  };
}

import "server-only";
import { buildMeta } from "../freshness";
import { cached } from "../cache";
import { analyzeCanslim, retPct, type CanslimLetter, type CanslimSnapshot } from "../engines/canslim";
import { getFinancialPackagesBulk, mapPool, type PackageBundle } from "../financial/snapshots";
import { getVnIndices, getVnOhlcv } from "./stocks";
import { batchVnOhlcv } from "./ohlcv-batch";
import { hubVnQuotes } from "../data-engine";
import { defaultTechnicalUniverse } from "../vn/vn100";
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
  phase?: "tech" | "full";
}

export interface CanslimCoverageStats {
  withBars: number;
  withGrowth: number;
  withHealth: number;
  withForeign: number;
  withRatios: number;
  withEquity: number;
}

export type CanslimScreenResult = {
  rows: CanslimScreenRow[];
  scanned: number;
  skipped: number;
  marketBullish: boolean | null;
  marketDetail: string;
  coverage: CanslimCoverageStats;
  meta: Meta;
  phase: "tech" | "full";
};

/** Lean default board for low-latency first paint (VN100 head). */
export const CANSLIM_DEFAULT_CAP = 24;
const CANSLIM_HARD_CAP = 40;
/** ~70 bars: MA50 + vol ratio + RS 3M (63d). */
const CANSLIM_BARS = 70;
const RS_LOOKBACK = 63;

const REALTIME_BUDGET_MS = 12_000;
const FULL_BUDGET_MS = 55_000;
const BCTC_BUDGET_MS = 5_000;
const BCTC_MIN_LEFT_MS = 3_500;

const CANSLIM_RESULT_TTL_MS = 4 * 60_000;
const CANSLIM_RESULT_STALE_MS = 20 * 60_000;

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

function percentileRank(sortedAsc: number[], value: number): number {
  if (!sortedAsc.length) return 50;
  let below = 0;
  for (const x of sortedAsc) if (x < value) below += 1;
  return Math.round((below / sortedAsc.length) * 100);
}

export function canslimCacheKey(args?: {
  symbols?: string[];
  minScore?: number;
  minPass?: number;
  requireLetters?: CanslimLetter[];
  sector?: string;
  limit?: number;
  phase?: "tech" | "full" | "auto";
}): string {
  const syms = args?.symbols?.length
    ? [...new Set(args.symbols.map((s) => s.toUpperCase()).filter(Boolean))].sort().join(",")
    : `board:${CANSLIM_DEFAULT_CAP}`;
  const letters = args?.requireLetters?.length
    ? [...args.requireLetters].map((L) => L.toUpperCase()).sort().join("")
    : "-";
  const sector = (args?.sector ?? "-").toUpperCase();
  const minScore = args?.minScore ?? 50;
  const minPass = args?.minPass ?? 0;
  const limit = Math.min(args?.limit ?? 40, 72);
  const phase = args?.phase === "tech" ? "tech" : args?.phase === "full" ? "full" : "rt";
  return `canslim:v6:${phase}:${syms}:s${minScore}:p${minPass}:L${letters}:sec${sector}:n${limit}`;
}

async function resolveMarketDirection(): Promise<{
  bullish: boolean | null;
  detail: string;
  source: string;
}> {
  try {
    const idxPack = await getVnIndices().catch(() => null);
    const vn =
      idxPack?.items?.find((x) => x.code === "VNINDEX") ??
      idxPack?.items?.find((x) => x.code === "VN30");

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

    const ohlcv = await withTimeout(getVnOhlcv("VNINDEX", 70).catch(() => null), 1_200);
    const bars = ohlcv?.bars ?? [];
    const closes = bars.map((b) => b.close);
    const ma50 = sma(closes, 50);
    const last = closes[closes.length - 1];
    const ret63 = bars.length >= 65 ? retPct(bars, 63) : null;

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
      source: bars.length ? "index-ohlcv+quote" : "index-quote",
    };
  } catch {
    return { bullish: null, detail: "Lỗi nguồn chỉ số", source: "error" };
  }
}

type Pack = {
  symbol: string;
  bars: OhlcvBar[];
  ret6: number | null;
  sector: string;
};

function buildRsRankers(valid: Pack[]): {
  rsOf: (p: Pack) => number | null;
  note: string;
} {
  const uniRets = valid
    .map((p) => p.ret6)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);

  const bySector = new Map<string, number[]>();
  for (const p of valid) {
    if (p.ret6 == null) continue;
    const sec = p.sector || "Khác";
    const arr = bySector.get(sec) ?? [];
    arr.push(p.ret6);
    bySector.set(sec, arr);
  }
  for (const [k, arr] of bySector) bySector.set(k, arr.sort((a, b) => a - b));

  return {
    note: "RS=3M universe+sector",
    rsOf: (p: Pack) => {
      if (p.ret6 == null) return null;
      const uni = percentileRank(uniRets, p.ret6);
      const peers = bySector.get(p.sector || "Khác") ?? [];
      if (peers.length >= 4) return Math.max(uni, percentileRank(peers, p.ret6));
      return uni;
    },
  };
}

function rowFromSnap(
  p: Pack,
  snap: CanslimSnapshot,
  quoteMap: Map<
    string,
    {
      symbol?: string;
      name?: string | null;
      price?: number | null;
      changePercent?: number | null;
      quoteVolume?: number | null;
      volume?: number | null;
    }
  >,
  phase: "tech" | "full",
): CanslimScreenRow {
  const q = quoteMap.get(p.symbol);
  const sec = getSecurity(p.symbol);
  return {
    symbol: p.symbol,
    name: sec?.name ?? q?.name ?? null,
    sector: p.sector || sectorOf(p.symbol) || sec?.sector || null,
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
    phase,
  };
}

function applyFilters(
  rows: CanslimScreenRow[],
  args?: {
    minScore?: number;
    minPass?: number;
    requireLetters?: CanslimLetter[];
    sector?: string;
    limit?: number;
  },
): CanslimScreenRow[] {
  let out = rows;
  if (args?.minScore != null) out = out.filter((r) => r.score >= args.minScore!);
  if (args?.minPass != null) out = out.filter((r) => r.passCount >= args.minPass!);
  if (args?.requireLetters?.length) {
    const need = new Set(args.requireLetters);
    out = out.filter((r) => [...need].every((L) => r.passLetters.includes(L)));
  }
  if (args?.sector) out = out.filter((r) => r.sector === args.sector);
  out.sort(
    (a, b) => b.score - a.score || b.passCount - a.passCount || (b.volume ?? 0) - (a.volume ?? 0),
  );
  return out.slice(0, Math.min(args?.limit ?? 40, 72));
}

async function screenCanslimCore(args?: {
  symbols?: string[];
  minScore?: number;
  minPass?: number;
  requireLetters?: CanslimLetter[];
  sector?: string;
  limit?: number;
  phase?: "tech" | "full" | "auto";
}): Promise<CanslimScreenResult> {
  const t0 = Date.now();
  const mode = args?.phase ?? "auto";
  const budgetMs = mode === "full" ? FULL_BUDGET_MS : REALTIME_BUDGET_MS;
  const userSymbols = Boolean(args?.symbols?.length);
  const cap = userSymbols ? CANSLIM_HARD_CAP : CANSLIM_DEFAULT_CAP;
  const uniq = [
    ...new Set(
      (args?.symbols?.length ? args.symbols : defaultTechnicalUniverse(cap))
        .map((s) => s.toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, cap);

  const ohlcvDeadline = mode === "full" ? 18_000 : 9_500;
  const [quotesPack, market, ohlcvMap] = await Promise.all([
    hubVnQuotes(uniq).catch(() => null),
    resolveMarketDirection(),
    batchVnOhlcv(uniq, {
      bars: CANSLIM_BARS,
      concurrency: mode === "full" ? 14 : 16,
      deadlineMs: ohlcvDeadline,
      perSymbolMs: mode === "full" ? 4_000 : 2_800,
    }),
  ]);

  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol as string, q]));

  const valid: Pack[] = [];
  let skipped = 0;
  for (const sym of uniq) {
    const pack = ohlcvMap.get(sym);
    const bars = pack?.bars ?? [];
    if (bars.length < 28) {
      skipped += 1;
      continue;
    }
    valid.push({
      symbol: sym,
      bars,
      ret6: retPct(bars, RS_LOOKBACK),
      sector: sectorOf(sym) || getSecurity(sym)?.sector || "Khác",
    });
  }

  const { rsOf, note: rsNote } = buildRsRankers(valid);

  const coverage: CanslimCoverageStats = {
    withBars: valid.length,
    withGrowth: 0,
    withHealth: 0,
    withForeign: 0,
    withRatios: 0,
    withEquity: 0,
  };

  let rows: CanslimScreenRow[] = valid.map((p) => {
    const snap = analyzeCanslim({
      bars: p.bars,
      growth: null,
      health: null,
      periods: null,
      marketBullish: market.bullish,
      marketDetail: market.detail,
      rsRank: rsOf(p),
    });
    return rowFromSnap(p, snap, quoteMap, "tech");
  });

  let finalPhase: "tech" | "full" = "tech";
  const elapsedA = Date.now() - t0;

  const left = budgetMs - elapsedA;
  const wantB = mode === "full" || (mode === "auto" && left >= BCTC_MIN_LEFT_MS && elapsedA < 9_000);

  if (wantB && valid.length > 0) {
    const bctcMs = Math.min(BCTC_BUDGET_MS, left - 1_000);
    const finMap =
      (await withTimeout(
        getFinancialPackagesBulk(
          valid.map((p) => p.symbol),
          { concurrency: 10, persist: false },
        ),
        Math.max(1_500, bctcMs),
      )) ?? new Map<string, PackageBundle>();

    const secondaryMs =
      mode === "full" && Date.now() - t0 < budgetMs - 2_500 ? 2_500 : 0;

    const enriched = await mapPool(valid, 12, async (p) => {
      const fin = finMap.get(p.symbol) ?? null;

      let foreign: Awaited<ReturnType<typeof getVndSymbolForeignFlow>> | null = null;
      let equity: Awaited<ReturnType<typeof getVndEquitySnapshot>> | null = null;
      let ratios: Awaited<ReturnType<typeof getVndValuationRatios>> | null = null;

      if (secondaryMs > 0 && fin) {
        const sec = await withTimeout(
          Promise.all([
            getVndSymbolForeignFlow(p.symbol, 5).catch(() => null),
            getVndEquitySnapshot(p.symbol).catch(() => null),
            getVndValuationRatios(p.symbol).catch(() => null),
          ]),
          secondaryMs,
        );
        if (sec) {
          foreign = sec[0];
          equity = sec[1];
          ratios = sec[2];
        }
      }

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
        rsRank: rsOf(p),
        ratiosRoePct: ratios?.roe ?? null,
        ratiosEps: ratios?.eps ?? null,
        sharesOutstanding: equity?.sharesOutstanding ?? null,
      });
      return rowFromSnap(p, snap, quoteMap, fin ? "full" : "tech");
    });

    rows = enriched.filter((r): r is CanslimScreenRow => r != null);
    if (coverage.withGrowth > 0 || coverage.withHealth > 0) finalPhase = "full";
  }

  const allScored = [...rows].sort(
    (a, b) => b.score - a.score || b.passCount - a.passCount || (b.volume ?? 0) - (a.volume ?? 0),
  );

  let filtered = applyFilters(rows, args);
  let filterRelaxed = false;
  if (filtered.length === 0 && allScored.length > 0) {
    filtered = allScored.slice(0, Math.min(args?.limit ?? 40, 24));
    filterRelaxed = true;
  }

  const ms = Date.now() - t0;
  const covNote =
    finalPhase === "tech"
      ? `rt tech · nến ${coverage.withBars}/${uniq.length} · ${rsNote} · ${ms}ms`
      : `rt+fund · BCTC ${coverage.withGrowth}/${valid.length} · nến ${coverage.withBars} · ${rsNote} · ${ms}ms`;

  return {
    rows: filtered,
    scanned: uniq.length,
    skipped,
    marketBullish: market.bullish,
    marketDetail: market.detail,
    coverage,
    phase: finalPhase,
    meta: buildMeta({
      source:
        [
          quotesPack?.meta?.source,
          finalPhase === "full" ? "bctc-budget" : "tech-rt",
          "ohlcv-batch",
          market.source,
        ]
          .filter(Boolean)
          .join("+") || "canslim-rt",
      sourceTimestampMs: Date.now(),
      hasData: valid.length > 0 || filtered.length > 0,
      partial:
        finalPhase === "tech" ||
        filterRelaxed ||
        skipped > 0 ||
        (valid.length > 0 && coverage.withGrowth < valid.length * 0.4),
      note: `CANSLIM · ${finalPhase} · VN100 · quét ${uniq.length} · ${covNote}${filterRelaxed ? " · nới filter" : ""} · ${market.detail} · không phải tín hiệu GD`,
    }),
  };
}

export async function screenCanslim(args?: {
  symbols?: string[];
  minScore?: number;
  minPass?: number;
  requireLetters?: CanslimLetter[];
  sector?: string;
  limit?: number;
  skipCache?: boolean;
  phase?: "tech" | "full" | "auto";
}): Promise<CanslimScreenResult | null> {
  const key = canslimCacheKey(args);
  try {
    const hit = await cached<CanslimScreenResult>(key, {
      ttlMs: CANSLIM_RESULT_TTL_MS,
      staleMs: CANSLIM_RESULT_STALE_MS,
      skipCache: args?.skipCache === true,
      softSwr: true,
      producer: async () => screenCanslimCore(args),
    });
    const result = hit.value;
    if (hit.cached && result.meta) {
      const tag = hit.stale ? "cache-stale" : "cache-hit";
      result.meta = {
        ...result.meta,
        note: `${result.meta.note ?? ""} · ${tag}`,
        partial: result.meta.partial || hit.stale,
      };
    }
    return result;
  } catch {
    try {
      return await screenCanslimCore({ ...args, phase: "tech" });
    } catch {
      return null;
    }
  }
}

export async function warmCanslimDefault(): Promise<{ rows: number; scanned: number; ms: number }> {
  const t0 = Date.now();
  const r = await screenCanslim({
    minScore: 0,
    minPass: 0,
    limit: 40,
    phase: "tech",
    skipCache: true,
  });
  return {
    rows: r?.rows.length ?? 0,
    scanned: r?.scanned ?? 0,
    ms: Date.now() - t0,
  };
}

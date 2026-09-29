import "server-only";
import { buildMeta } from "../freshness";
import { cached } from "../cache";
import { analyzeCanslim, retPct, type CanslimLetter, type CanslimSnapshot } from "../engines/canslim";
import { getFinancialPackagesBulk, mapPool, type PackageBundle } from "../financial/snapshots";
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

export const CANSLIM_DEFAULT_CAP = 28;
const CANSLIM_HARD_CAP = 40;
/** Fewer bars = faster realtime OHLCV (still enough for 6M RS ~126). */
const CANSLIM_BARS = 130;

/**
 * Realtime budget for default/auto path — finish well under serverless limits.
 * Phase A (quote+OHLCV) is guaranteed; Phase B (BCTC) is best-effort inside leftover time.
 */
const REALTIME_BUDGET_MS = 22_000;
/** Hard ceiling when phase=full explicitly requested. */
const FULL_BUDGET_MS = 65_000;
/** Max time spent on BCTC bulk in realtime mode (hub cache hits are fast). */
const BCTC_BUDGET_MS = 10_000;

const CANSLIM_RESULT_TTL_MS = 5 * 60_000;
const CANSLIM_RESULT_STALE_MS = 25 * 60_000;

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
  return `canslim:v4:${phase}:${syms}:s${minScore}:p${minPass}:L${letters}:sec${sector}:n${limit}`;
}

async function resolveMarketDirection(): Promise<{
  bullish: boolean | null;
  detail: string;
  source: string;
}> {
  try {
    const [idxPack, ohlcv] = await Promise.all([
      getVnIndices().catch(() => null),
      getVnOhlcv("VNINDEX", 90).catch(() => null),
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
    note: "RS=universe+sector",
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

/**
 * Realtime-first core:
 * 1) Always finish Phase A (quotes + OHLCV → N/S/L/M) — this is what made old CANSLIM "always usable".
 * 2) Phase B best-effort: BCTC via hub (cache-first) under short timeout; never blocks availability.
 * 3) If user filters wipe the table, fall back to top-by-score so UI never shows hard UNAVAILABLE.
 */
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
      (args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean),
    ),
  ].slice(0, cap);

  // ── Phase A (guaranteed realtime path) ───────────────────────────────────
  const [quotesPack, market] = await Promise.all([
    hubVnQuotes(uniq).catch(() => null),
    resolveMarketDirection(),
  ]);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol as string, q]));

  const ohlcvMap = await batchVnOhlcv(uniq, {
    bars: CANSLIM_BARS,
    concurrency: mode === "full" ? 10 : 12,
  });

  const valid: Pack[] = [];
  let skipped = 0;
  for (const sym of uniq) {
    const pack = ohlcvMap.get(sym);
    const bars = pack?.bars ?? [];
    if (bars.length < 30) {
      skipped += 1;
      continue;
    }
    valid.push({
      symbol: sym,
      bars,
      ret6: retPct(bars, 126),
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

  // ── Phase B: best-effort BCTC (cache hits via hub) — never required for availability ──
  const wantB = mode !== "tech" && valid.length > 0;
  const left = budgetMs - elapsedA;
  if (wantB && left > 4_000) {
    const bctcMs = Math.min(BCTC_BUDGET_MS, left - 2_000);
    const finMap =
      (await withTimeout(
        getFinancialPackagesBulk(
          valid.map((p) => p.symbol),
          { concurrency: 8, persist: false },
        ),
        bctcMs,
      )) ?? new Map<string, PackageBundle>();

    const elapsedB = Date.now() - t0;
    const secondaryMs =
      mode === "full" && elapsedB < budgetMs - 3_000
        ? Math.min(3_500, budgetMs - elapsedB - 1_500)
        : 0;

    const enriched = await mapPool(valid, secondaryMs > 0 ? 6 : 10, async (p) => {
      const fin = finMap.get(p.symbol) ?? null;

      let foreign: Awaited<ReturnType<typeof getVndSymbolForeignFlow>> | null = null;
      let equity: Awaited<ReturnType<typeof getVndEquitySnapshot>> | null = null;
      let ratios: Awaited<ReturnType<typeof getVndValuationRatios>> | null = null;

      // Secondary only when BCTC already present or full mode with time
      if (secondaryMs > 0 && (fin || mode === "full")) {
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

  // Always-usable: if strict filters empty the table but we have scores, show top board
  if (filtered.length === 0 && allScored.length > 0) {
    filtered = allScored.slice(0, Math.min(args?.limit ?? 40, 24));
    filterRelaxed = true;
  }

  const ms = Date.now() - t0;
  const covNote =
    finalPhase === "tech"
      ? `realtime tech · nến ${coverage.withBars} · ${rsNote} · ${ms}ms`
      : `realtime+fund · BCTC ${coverage.withGrowth}/${valid.length} · ROE ${coverage.withRatios} · NN ${coverage.withForeign} · nến ${coverage.withBars} · ${rsNote} · ${ms}ms`;

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
          finalPhase === "full" ? "bctc-cache-budget" : "tech-realtime",
          "ohlcv-batch",
          market.source,
        ]
          .filter(Boolean)
          .join("+") || "canslim-realtime",
      sourceTimestampMs: Date.now(),
      // hasData true whenever we scanned bars — UI must not show UNAVAILABLE
      hasData: valid.length > 0 || filtered.length > 0,
      partial:
        finalPhase === "tech" ||
        filterRelaxed ||
        skipped > 0 ||
        (valid.length > 0 && coverage.withGrowth < valid.length * 0.4),
      note: `CANSLIM · ${finalPhase} · quét ${uniq.length} · ${covNote}${filterRelaxed ? " · đã nới filter (hiển thị top điểm)" : ""} · ${market.detail} · không phải tín hiệu GD`,
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
    phase: "auto",
    skipCache: true,
  });
  return {
    rows: r?.rows.length ?? 0,
    scanned: r?.scanned ?? 0,
    ms: Date.now() - t0,
  };
}

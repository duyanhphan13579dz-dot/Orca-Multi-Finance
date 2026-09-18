import "server-only";
import { buildMeta } from "../freshness";
import { analyzeCanslim, retPct, type CanslimLetter, type CanslimSnapshot } from "../engines/canslim";
import { getFinancialPackage } from "../financial/service";
import { getVnIndices, getVnOhlcv, getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta } from "../types";

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
  flags: string[];
  notes: string[];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function marketBullish(): Promise<boolean | null> {
  try {
    const idx = await getVnIndices();
    const vn = idx?.items?.find((x) => x.code === "VNINDEX" || x.code === "VN30");
    if (!vn) return null;
    // heuristic: Δ% phiên > -1 và không đang rơi mạnh
    if (vn.changePercent != null) return vn.changePercent > -1.2;
    return null;
  } catch {
    return null;
  }
}

export async function screenCanslim(args?: {
  symbols?: string[];
  minScore?: number;
  minPass?: number;
  requireLetters?: CanslimLetter[];
  sector?: string;
  limit?: number;
}): Promise<{ rows: CanslimScreenRow[]; scanned: number; skipped: number; marketBullish: boolean | null; meta: Meta } | null> {
  const uniq = [
    ...new Set((args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean)),
  ].slice(0, 48);

  const [quotesPack, mBull] = await Promise.all([
    getVnQuotes(uniq).catch(() => null),
    marketBullish(),
  ]);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));

  // Pass 1: OHLCV + returns for RS ranking
  let skipped = 0;
  type Pack = {
    symbol: string;
    bars: Awaited<ReturnType<typeof getVnOhlcv>> extends { bars: infer B } | null ? B : never;
    ret6: number | null;
  };
  const packs = await mapPool(uniq, 5, async (symbol): Promise<Pack | null> => {
    const ohlcv = await getVnOhlcv(symbol, 260).catch(() => null);
    const bars = ohlcv?.bars ?? [];
    if (bars.length < 40) {
      skipped += 1;
      return null;
    }
    return { symbol, bars, ret6: retPct(bars, 126) };
  });
  const valid = packs.filter((p): p is Pack => p != null);
  const rets = valid.map((p) => p.ret6).filter((r): r is number => r != null).sort((a, b) => a - b);

  function rsRankOf(r: number | null): number | null {
    if (r == null || !rets.length) return null;
    let below = 0;
    for (const x of rets) if (x < r) below += 1;
    return Math.round((below / rets.length) * 100);
  }

  // Pass 2: financials + foreign + analyze
  const analyzed = await mapPool(valid, 4, async (p) => {
    const [fin, foreign] = await Promise.all([
      getFinancialPackage(p.symbol).catch(() => null),
      getVndSymbolForeignFlow(p.symbol, 5).catch(() => null),
    ]);
    const snap = analyzeCanslim({
      bars: p.bars,
      growth: fin?.pkg.growth ?? null,
      health: fin?.health ?? null,
      periods: fin?.pkg.periods ?? null,
      foreignNetVal: foreign?.latest?.netVal ?? null,
      marketBullish: mBull,
      rsRank: rsRankOf(p.ret6),
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

  return {
    rows,
    scanned: uniq.length,
    skipped,
    marketBullish: mBull,
    meta: buildMeta({
      source: quotesPack?.meta.source ?? "vndirect+bctc+ohlcv",
      sourceTimestampMs: Date.now(),
      partial: skipped > 0,
      note: `CANSLIM heuristic · quét ${uniq.length} mã · đủ nến ${uniq.length - skipped} · M=${mBull === true ? "bullish" : mBull === false ? "weak" : "n/a"} · không phải tín hiệu GD`,
    }),
  };
}

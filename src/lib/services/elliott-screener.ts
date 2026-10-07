import "server-only";
import { buildMeta } from "../freshness";
import { analyzeElliott, type ElliottPattern, type ElliottSnapshot } from "../engines/wyckoff-elliott";
import { getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta } from "../types";
import { fetchOhlcvResilient, mapPool } from "./screener-ohlcv";

export interface ElliottScreenRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  pattern: ElliottPattern;
  patternVi: string;
  degree: ElliottSnapshot["degree"];
  confidence: number;
  bias: ElliottSnapshot["bias"];
  waves: ElliottSnapshot["waves"];
  invalidation: number | null;
  nextTarget: number | null;
  notes: string[];
}

export async function screenElliott(args?: {
  symbols?: string[];
  pattern?: ElliottPattern | "all";
  minConfidence?: number;
  sector?: string;
  limit?: number;
}): Promise<{ rows: ElliottScreenRow[]; scanned: number; skipped: number; meta: Meta }> {
  const uniq = [
    ...new Set(
      (args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean),
    ),
  ].slice(0, 90);

  const quotesPack = await getVnQuotes(uniq).catch(() => null);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));
  let skipped = 0;

  const analyzed = await mapPool(uniq, 8, async (symbol) => {
    const { bars } = await fetchOhlcvResilient(symbol, 120);
    if (bars.length < 30) {
      skipped += 1;
      return null;
    }
    const e = analyzeElliott(bars);
    const q = quoteMap.get(symbol);
    const sec = getSecurity(symbol);
    return {
      symbol,
      name: sec?.name ?? q?.name ?? null,
      sector: sectorOf(symbol) ?? sec?.sector ?? null,
      price: q?.price ?? bars.at(-1)?.close ?? null,
      changePercent: q?.changePercent ?? null,
      pattern: e.pattern,
      patternVi: e.patternVi,
      degree: e.degree,
      confidence: e.confidence,
      bias: e.bias,
      waves: e.waves,
      invalidation: e.invalidation,
      nextTarget: e.nextTarget,
      notes: e.notes,
    } as ElliottScreenRow;
  });

  let rows = analyzed.filter((r): r is ElliottScreenRow => r != null);
  if (args?.pattern && args.pattern !== "all") rows = rows.filter((r) => r.pattern === args.pattern);
  if (args?.minConfidence != null) rows = rows.filter((r) => r.confidence >= args.minConfidence!);
  if (args?.sector) rows = rows.filter((r) => r.sector === args.sector);
  rows.sort((a, b) => b.confidence - a.confidence);
  rows = rows.slice(0, Math.min(args?.limit ?? 40, 80));

  return {
    rows,
    scanned: uniq.length,
    skipped,
    meta: buildMeta({
      source: quotesPack?.meta?.source ?? "vndirect+ohlcv",
      sourceTimestampMs: Date.now(),
      hasData: rows.length > 0,
      partial: skipped > 0,
      note: `Quét ${uniq.length} mã · đủ nến ${uniq.length - skipped} · Elliott heuristic (không phải tín hiệu GD)`,
    }),
  };
}

export type { ElliottPattern };

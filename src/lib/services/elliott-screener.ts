import "server-only";
import { buildMeta } from "../freshness";
import { analyzeElliott, type ElliottPattern, type ElliottSnapshot } from "../engines/wyckoff-elliott";
import { getVnOhlcv, getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta } from "../types";

export interface ElliottScreenRow {
  symbol: string; name: string | null; sector: string | null; price: number | null; changePercent: number | null;
  pattern: ElliottPattern; patternVi: string; degree: ElliottSnapshot["degree"]; confidence: number;
  bias: ElliottSnapshot["bias"]; waves: ElliottSnapshot["waves"]; invalidation: number | null; nextTarget: number | null; notes: string[];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]!); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker())); return out;
}

export async function screenElliott(args?: { symbols?: string[]; pattern?: ElliottPattern | "all"; minConfidence?: number; sector?: string; limit?: number }): Promise<{ rows: ElliottScreenRow[]; scanned: number; skipped: number; meta: Meta } | null> {
  const uniq = [...new Set((args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 60);
  const quotesPack = await getVnQuotes(uniq).catch(() => null);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q])); let skipped = 0;
  const analyzed = await mapPool(uniq, 6, async (symbol) => {
    const ohlcv = await getVnOhlcv(symbol, 120).catch(() => null); const bars = ohlcv?.bars ?? [];
    if (bars.length < 40) { skipped += 1; return null; }
    const e = analyzeElliott(bars); const q = quoteMap.get(symbol); const sec = getSecurity(symbol);
    return { symbol, name: sec?.name ?? q?.name ?? null, sector: sectorOf(symbol) ?? sec?.sector ?? null, price: q?.price ?? bars.at(-1)?.close ?? null, changePercent: q?.changePercent ?? null, pattern: e.pattern, patternVi: e.patternVi, degree: e.degree, confidence: e.confidence, bias: e.bias, waves: e.waves, invalidation: e.invalidation, nextTarget: e.nextTarget, notes: e.notes } as ElliottScreenRow;
  });
  let rows = analyzed.filter((r): r is ElliottScreenRow => r != null);
  if (args?.pattern && args.pattern !== "all") rows = rows.filter((r) => r.pattern === args.pattern);
  if (args?.minConfidence != null) rows = rows.filter((r) => r.confidence >= args.minConfidence!);
  if (args?.sector) rows = rows.filter((r) => r.sector === args.sector);
  rows.sort((a, b) => b.confidence - a.confidence); rows = rows.slice(0, Math.min(args?.limit ?? 40, 60));
  if (!rows.length && skipped === uniq.length) return null;
  return { rows, scanned: uniq.length, skipped, meta: buildMeta({ source: quotesPack?.meta.source ?? "vndirect+ohlcv", sourceTimestampMs: Date.now(), partial: skipped > 0, note: `Quét ${uniq.length} mã thanh khoản · Elliott heuristic theo pivot, không phải tín hiệu giao dịch` }) };
}

export type { ElliottPattern };

import "server-only";
import { buildMeta } from "../freshness";
import { analyzeStructure, type StructureAnalysis } from "../engines/wyckoff-elliott";
import { getVnStockDetail } from "./stocks";
import type { Meta } from "../types";

export type { StructureAnalysis } from "../engines/wyckoff-elliott";

export async function getStockStructure(
  symbolRaw: string,
): Promise<{ data: StructureAnalysis & { symbol: string }; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length > 12) return null;

  const detail = await getVnStockDetail(symbol);
  if (!detail?.detail?.bars?.length) return null;

  const bars = detail.detail.bars;
  const analysis = analyzeStructure(bars);
  if (!analysis) return null;

  const meta = buildMeta({
    source: "ohlcv-structure:wyckoff+elliott",
    sourceTimestampMs: bars[bars.length - 1]?.time ?? Date.now(),
    note: `Heuristic từ ${bars.length} nến · nghiên cứu, không phải khuyến nghị`,
  });

  return {
    data: { symbol, ...analysis },
    meta,
  };
}

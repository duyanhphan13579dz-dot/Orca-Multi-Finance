import { ok, unavailable } from "@/lib/envelope";
import { getStockStyleFit } from "@/lib/services/stock-style-fit";
import type { Meta } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CacheEntry = { at: number; payload: unknown; meta: Meta };
const CACHE_TTL_MS = 90_000;
const styleCache = new Map<string, CacheEntry>();

/**
 * GET /api/v1/stocks/:symbol/style-fit
 * Giải thích điều kiện đạt của Minervini Trend Template và CANSLIM.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return unavailable("style-fit", "Mã cổ phiếu không hợp lệ.");

  const hit = styleCache.get(normalized);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return ok(hit.payload, hit.meta);
  }

  try {
    const result = await getStockStyleFit(normalized);
    if (!result.minervini && !result.canslim) {
      return unavailable(
        "style-fit",
        result.notes.join(" ") || `Chưa đủ dữ liệu để đánh giá ${normalized}.`,
      );
    }
    const meta = {
      source: "minervini-canslim-style-fit",
      sourceTimestamp: new Date().toISOString(),
      freshness: "FRESH" as const,
      ageMs: 0,
      hasData: true,
      partial: result.notes.length > 0,
      note: "Điều kiện nghiên cứu, không phải tín hiệu giao dịch.",
    } satisfies Meta;
    styleCache.set(normalized, { at: Date.now(), payload: result, meta });
    return ok(result, meta);
  } catch {
    return unavailable(
      "style-fit",
      `Tạm thời chưa đánh giá được Minervini/CANSLIM cho ${normalized}.`,
    );
  }
}

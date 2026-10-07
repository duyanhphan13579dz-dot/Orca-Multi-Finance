import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getStockStructure } from "@/lib/services/stock-structure";
import type { Meta } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CacheEntry = { at: number; data: unknown; meta: Meta };
const CACHE_TTL_MS = 90_000;
const structureCache = new Map<string, CacheEntry>();

/** GET /api/v1/stocks/:symbol/structure — Wyckoff phase + Elliott wave heuristics */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) return badRequest("Mã cổ phiếu không hợp lệ");
  const key = symbol.toUpperCase();

  const hit = structureCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return ok(hit.data, hit.meta);
  }

  const r = await getStockStructure(symbol);
  if (!r) {
    return unavailable(
      "stock-structure",
      `Chưa đủ chuỗi giá để phân tích cấu trúc ${key}.`,
    );
  }
  structureCache.set(key, { at: Date.now(), data: r.data, meta: r.meta });
  return ok(r.data, r.meta);
}

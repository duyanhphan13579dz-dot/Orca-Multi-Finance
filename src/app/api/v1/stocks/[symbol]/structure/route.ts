import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getStockStructure } from "@/lib/services/stock-structure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/stocks/:symbol/structure — Wyckoff phase + Elliott wave heuristics */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) return badRequest("Mã cổ phiếu không hợp lệ");
  const r = await getStockStructure(symbol);
  if (!r) return unavailable("stock-structure", `Chưa đủ chuỗi giá để phân tích cấu trúc ${symbol.toUpperCase()}.`);
  return ok(r.data, r.meta);
}

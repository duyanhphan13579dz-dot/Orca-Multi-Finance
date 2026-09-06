import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCryptoOrderBook } from "@/lib/services/crypto-orderbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_LIMITS = new Set([5, 10, 20, 50, 100]);

/**
 * CRYPTO ORDER BOOK — Binance spot depth (public, real market data).
 * - limit ∈ {5,10,20,50,100}; default 20
 * - provider fail → 502 JSON `{success:false, error:{code:"UPSTREAM_UNAVAILABLE"}}`
 *   (page/component shows UNAVAILABLE; never fake levels, never HTML)
 */
export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  if (!/^[A-Za-z0-9]{2,20}$/.test(symbol)) return badRequest("Symbol không hợp lệ");
  if (!VALID_LIMITS.has(limit)) return badRequest("limit phải là 5 | 10 | 20 | 50 | 100");
  const r = await getCryptoOrderBook(symbol, limit);
  if (!r) {
    return unavailable("binance-spot", `Không lấy được order book ${symbol.toUpperCase()} từ Binance.`);
  }
  return ok(r.book, r.meta);
}

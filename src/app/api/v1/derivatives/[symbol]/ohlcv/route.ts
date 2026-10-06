import { ok, notFound, badRequest } from "@/lib/envelope";
import { getDerivativeOhlcv } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/{symbol}/ohlcv?days=60 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  if (!symbol?.trim()) return badRequest("symbol is required");
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days") ?? 60) || 60, 250);
  const r = await getDerivativeOhlcv(symbol.trim(), days);
  if (!r) return notFound(`Unknown derivative symbol: ${symbol.toUpperCase()}`);
  return ok({ symbol: symbol.toUpperCase(), bars: r.bars }, r.meta);
}

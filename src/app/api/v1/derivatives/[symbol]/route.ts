import { ok, notFound, badRequest } from "@/lib/envelope";
import { getDerivativeContractDetail } from "@/lib/services/derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/{symbol} — contract master + quote + basis when available. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  if (!symbol?.trim()) return badRequest("symbol is required");
  const r = await getDerivativeContractDetail(symbol.trim());
  if (!r) return notFound(`Unknown derivative symbol: ${symbol.toUpperCase()}`);
  return ok(r.data, r.meta);
}

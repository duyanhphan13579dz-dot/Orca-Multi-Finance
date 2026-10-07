import { ok, unavailable } from "@/lib/envelope";
import { buildStockAnalysis } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * STOCK STATE + FUNDAMENTAL INTELLIGENCE — full structured contract:
 * market-state engine + financial health engine + valuation engine +
 * reconciliation + news, with freshness/quality/confidence.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await buildStockAnalysis(symbol);
  if (!r) return unavailable("vn-market", `Không dựng được analysis contract cho ${symbol.toUpperCase()}.`);
  return ok({ contract: r.contract, confidence: r.confidence }, r.meta);
}

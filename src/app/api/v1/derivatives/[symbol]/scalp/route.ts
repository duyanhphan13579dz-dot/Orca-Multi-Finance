import { ok, badRequest, unavailable } from "@/lib/envelope";
import { buildDerivativeScalpSignal } from "@/lib/services/derivatives-scalp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TF = new Set(["1m", "5m", "15m"]);

/**
 * GET /api/v1/derivatives/{symbol}/scalp?tf=5m
 * Vietnam Derivatives Scalping Intelligence: quant setup, basis dynamics, flow, and VSDC margin calculations.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  if (!symbol?.trim()) return badRequest("symbol is required");

  const url = new URL(req.url);
  const tf = url.searchParams.get("tf") ?? "5m";
  if (!TF.has(tf)) return badRequest("tf must be 1m | 5m | 15m");

  const r = await buildDerivativeScalpSignal(symbol.trim(), tf);
  if (!r) {
    return unavailable(
      "derivatives",
      `Không đủ dữ liệu realtime hoặc hợp đồng không tồn tại: ${symbol.toUpperCase()}`,
    );
  }

  return ok(r.result, r.meta);
}

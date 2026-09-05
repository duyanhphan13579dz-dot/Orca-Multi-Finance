import { ok, unavailable, badRequest } from "@/lib/envelope";
import { buildForexAnalysisContract } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** FOREX TRADING INTELLIGENCE — structured contract (state + setup + meta). */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 6) return badRequest("Cặp tỷ giá phải dạng 6 ký tự, ví dụ EURUSD");
  const r = await buildForexAnalysisContract(clean);
  if (!r) return unavailable("forex-providers", `Không lấy được dữ liệu ${clean}.`);
  return ok({ contract: r.contract, confidence: r.confidence }, r.meta);
}

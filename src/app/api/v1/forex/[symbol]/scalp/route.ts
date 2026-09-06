import { ok, unavailable, badRequest } from "@/lib/envelope";
import { buildForexScalpSignal } from "@/lib/services/forex-scalp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** FOREX SCALPING INTELLIGENCE — M15→M5→M1 + session/spread filters */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{6,12}$/.test(symbol)) return badRequest("Pair khong hop le");
  const r = await buildForexScalpSignal(symbol);
  if (!r) return unavailable("yahoo-fx", `Khong du du lieu nen de tinh forex scalp cho ${symbol.toUpperCase()}.`);
  return ok(r.result, r.meta);
}

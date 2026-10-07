import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCryptoOrderFlow } from "@/lib/services/crypto-orderflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Order book + large prints + signal% + leverage plans from Binance */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{5,20}$/.test(symbol)) return badRequest("Symbol khong hop le");
  const r = await getCryptoOrderFlow(symbol);
  if (!r) return unavailable("binance-spot", `Khong lay duoc order flow ${symbol.toUpperCase()} tu Binance.`);
  return ok(r.data, r.meta);
}

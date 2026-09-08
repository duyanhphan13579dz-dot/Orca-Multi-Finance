import { ok, fail, unavailable, badRequest } from "@/lib/envelope";
import { getCryptoOrderFlow } from "@/lib/services/crypto-orderflow";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Order book + large prints + signal% + leverage plans from Binance */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để sử dụng Crypto", 401);
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{5,20}$/.test(symbol)) return badRequest("Symbol khong hop le");
  const r = await getCryptoOrderFlow(symbol);
  if (!r) return unavailable("binance-spot", `Khong lay duoc order flow ${symbol.toUpperCase()} tu Binance.`);
  return ok(r.data, r.meta);
}
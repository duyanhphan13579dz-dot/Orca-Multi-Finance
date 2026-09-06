import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getMetalDetail } from "@/lib/services/metals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** METALS DETAIL API — quote + daily OHLC + performance 1D/1W/1M/1Q/1Y + technical. */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (!/^(XAUUSD|XAGUSD|XPTUSD|XPDUSD)$/.test(clean)) return badRequest("Symbol phải là XAUUSD | XAGUSD | XPTUSD | XPDUSD");
  const r = await getMetalDetail(clean);
  if (!r) return unavailable("metals-providers", `Không lấy được dữ liệu ${clean} (Swissquote/Yahoo).`);
  return ok(r.detail, r.meta);
}

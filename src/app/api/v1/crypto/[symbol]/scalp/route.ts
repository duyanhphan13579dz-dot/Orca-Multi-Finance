import { ok, unavailable, badRequest } from "@/lib/envelope";
import { buildScalpSignal } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TF = new Set(["1m", "5m", "15m"]);

/** CRYPTO SCALPING INTELLIGENCE — realtime quant signal over live klines. */
export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{2,20}$/.test(symbol)) return badRequest("Symbol không hợp lệ");
  const tf = new URL(req.url).searchParams.get("tf") ?? "5m";
  if (!TF.has(tf)) return badRequest("tf phải là 1m | 5m | 15m");
  const r = await buildScalpSignal(symbol, tf);
  if (!r) return unavailable("binance", `Không đủ dữ liệu realtime để tính scalp signal cho ${symbol.toUpperCase()}.`);
  return ok(r.result, r.meta);
}

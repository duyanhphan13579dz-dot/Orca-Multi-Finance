import { ok, unavailable } from "@/lib/envelope";
import { getVnOhlcv, vnstockConfigured } from "@/lib/services/stocks";
import { analyzeSeries, detectPatterns } from "@/lib/technical";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!vnstockConfigured()) return unavailable("vnstock", "VNSTOCK_API_KEY chưa được cấu hình.");
  const r = await getVnOhlcv(symbol, 250);
  if (!r) return unavailable("vnstock", `Không lấy được chuỗi OHLCV cho ${symbol.toUpperCase()}.`);
  return ok(
    {
      symbol: symbol.toUpperCase(),
      bars: r.bars,
      technical: analyzeSeries(r.bars),
      patterns: detectPatterns(r.bars),
    },
    r.meta,
  );
}

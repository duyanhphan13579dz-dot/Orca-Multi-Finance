import { ok, unavailable } from "@/lib/envelope";
import { getVnOhlcv } from "@/lib/services/stocks";
import { analyzeSeries, detectPatterns } from "@/lib/technical";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await getVnOhlcv(symbol, 250);
  if (!r) return unavailable("vn-market", `Không lấy được chuỗi OHLCV cho ${symbol.toUpperCase()} từ VNDirect/nguồn dự phòng.`);
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

import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCryptoDetail } from "@/lib/services/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_INTERVALS = new Set(["5m", "15m", "1h", "4h", "1d", "1w"]);

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const url = new URL(req.url);
  const interval = url.searchParams.get("interval") ?? "1h";
  if (!/^[A-Za-z0-9]{2,20}$/.test(symbol)) return badRequest("Symbol không hợp lệ");
  if (!VALID_INTERVALS.has(interval)) return badRequest("Interval không hợp lệ");
  const r = await getCryptoDetail(symbol, interval);
  if (!r) {
    return unavailable("binance", `Không lấy được dữ liệu ${symbol.toUpperCase()} từ Binance (kiểm tra ký hiệu hoặc trạng thái tại /system).`);
  }
  return ok(r.detail, r.meta);
}

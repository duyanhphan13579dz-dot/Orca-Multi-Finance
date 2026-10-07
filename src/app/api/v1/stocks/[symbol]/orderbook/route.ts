import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getVnOrderBook } from "@/lib/services/stock-orderbook";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 8;

/**
 * Order book + match tape.
 * - In session: live SSI DataHub X (when WS enabled)
 * - Outside session: last-session snapshot (WS memory / Redis cache up to 72h)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) {
    return badRequest("Mã chứng khoán không hợp lệ");
  }

  // Không chặn REST/cache khi SSI WebSocket chưa cấu hình. getVnOrderBook
  // tự chạy đa nguồn SSI iBoard + VPS song song rồi mới dùng snapshot cache.
  const r = await getVnOrderBook(symbol);
  if (!r) {
    const wsOff = process.env.SSI_WS_DISABLED === "true";
    return unavailable(
      "ssi-ws",
      wsOff
        ? `Chưa có sổ lệnh ${symbol.toUpperCase()}. Cần SSI_WS_DISABLED=false trong phiên để thu depth; ngoài phiên sẽ hiện snapshot đã lưu (Redis/memory).`
        : `Chưa có sổ lệnh ${symbol.toUpperCase()} — trong phiên có realtime; ngoài phiên hiện snapshot phiên gần nhất nếu đã từng nhận tick.`,
    );
  }
  return ok(r.book, r.meta);
}

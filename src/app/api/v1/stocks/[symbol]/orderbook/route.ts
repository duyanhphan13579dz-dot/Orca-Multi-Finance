import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getVnOrderBook } from "@/lib/services/stock-orderbook";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live order book (sổ lệnh) for a VN equity symbol from SSI DataHub streaming.
 * Requires SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET and SSI_WS_DISABLED != true.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) {
    return badRequest("Mã chứng khoán không hợp lệ");
  }

  if (!ssiFcConfigured()) {
    return unavailable(
      "ssi-fcdata",
      "Chưa cấu hình SSI FastConnect (SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET).",
    );
  }

  if (process.env.SSI_WS_DISABLED === "true") {
    return unavailable(
      "ssi-ws",
      "Sổ lệnh cần SSI WebSocket streaming. Trên serverless hãy chạy Node/VPS dài hạn và đặt SSI_WS_DISABLED=false (hoặc xóa biến).",
    );
  }

  const r = await getVnOrderBook(symbol);
  if (!r) {
    return unavailable(
      "ssi-ws",
      `Chưa có sổ lệnh realtime cho ${symbol.toUpperCase()} — đang chờ tick X từ SSI DataHub (mở trang trong phiên giao dịch hoặc đợi vài giây).`,
    );
  }
  return ok(r.book, r.meta);
}

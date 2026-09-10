import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getVnOrderBook } from "@/lib/services/stock-orderbook";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Order book + match tape.
 * - In session: live SSI DataHub X channel
 * - Outside session: last-session depth snapshot (if process still holds it or SSI pushes on subscribe)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) {
    return badRequest("Mã chứng khoán không hợp lệ");
  }

  if (!ssiFcConfigured()) {
    return unavailable(
      "ssi-fcdata",
      "Chưa cấu hình SSI (SSI_API_KEY + SSI_API_SECRET hoặc SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET).",
    );
  }

  if (process.env.SSI_WS_DISABLED === "true") {
    return unavailable(
      "ssi-ws",
      "Sổ lệnh cần SSI WebSocket. Đặt SSI_WS_DISABLED=false trên VPS dài hạn để giữ snapshot phiên gần nhất.",
    );
  }

  const r = await getVnOrderBook(symbol);
  if (!r) {
    return unavailable(
      "ssi-ws",
      `Chưa có sổ lệnh cho ${symbol.toUpperCase()} — trong phiên sẽ có realtime; ngoài phiên cần process đã nhận tick trước đó hoặc SSI snapshot khi subscribe.`,
    );
  }
  return ok(r.book, r.meta);
}

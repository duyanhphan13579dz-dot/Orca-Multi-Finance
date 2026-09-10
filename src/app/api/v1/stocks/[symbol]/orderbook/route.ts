import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getVnOrderBook } from "@/lib/services/stock-orderbook";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live order book + match tape for a VN equity from SSI DataHub streaming.
 * Credentials: SSI_FC_CONSUMER_ID/SECRET or SSI_API_KEY/SSI_API_SECRET.
 * Requires SSI_WS_DISABLED != true (long-lived Node/VPS recommended).
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
      "Sổ lệnh / khớp lệnh cần SSI WebSocket. Đặt SSI_WS_DISABLED=false trên runtime dài hạn (VPS). Serverless Vercel không giữ WS ổn định.",
    );
  }

  const r = await getVnOrderBook(symbol);
  if (!r) {
    return unavailable(
      "ssi-ws",
      `Chưa có độ sâu/khớp lệnh realtime cho ${symbol.toUpperCase()} — chờ tick X từ SSI trong phiên giao dịch.`,
    );
  }
  return ok(r.book, r.meta);
}

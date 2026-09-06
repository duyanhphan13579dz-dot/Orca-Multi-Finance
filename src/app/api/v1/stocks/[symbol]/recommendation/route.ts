import { ok, badRequest } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getVndRecommendation } from "@/lib/providers/vndirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ANALYST RECOMMENDATIONS — VNDirect finfo KHÔNG công bố dữ liệu recommendation
 * qua REST public. Endpoint trả trạng thái rõ ràng UNAVAILABLE + reason;
 * tuyệt đối không tạo dữ liệu giả.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{3,6}$/.test(sym)) return badRequest("Mã cổ phiếu không hợp lệ");
  const rec = await getVndRecommendation(sym);
  const meta = buildMeta({ source: "vndirect", note: rec.reason });
  meta.freshness = "UNAVAILABLE";
  meta.qualityStatus = "INVALID";
  meta.providers = ["vndirect"];
  return ok(rec, meta);
}

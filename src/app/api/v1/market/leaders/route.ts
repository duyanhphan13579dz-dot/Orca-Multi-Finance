import { ok, fail } from "@/lib/envelope";
import { getMarketLeaders } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — phát hiện cổ phiếu dẫn dắt (backend intelligence; UI chưa hiển thị). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const res = await getMarketLeaders(limit);
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để phát hiện dẫn dắt (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ leadership: res.leadership }, res.meta);
}

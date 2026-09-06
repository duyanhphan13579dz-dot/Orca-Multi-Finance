import { ok, fail } from "@/lib/envelope";
import { getMarketRegime } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — trạng thái thị trường VN (backend intelligence; UI chưa hiển thị). */
export async function GET() {
  const res = await getMarketRegime();
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để xác định regime thị trường (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ regime: res.regime }, res.meta);
}

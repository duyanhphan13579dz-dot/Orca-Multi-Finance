import { ok, fail } from "@/lib/envelope";
import { getMarketBreadth } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — độ rộng thị trường VN (backend intelligence; UI chưa hiển thị). */
export async function GET() {
  const res = await getMarketBreadth();
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để tính breadth (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ breadth: res.breadth }, res.meta);
}

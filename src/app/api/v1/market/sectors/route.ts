import { ok, fail } from "@/lib/envelope";
import { getSectorRotation } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — xoay vòng ngành VN (backend intelligence; UI chưa hiển thị). */
export async function GET() {
  const res = await getSectorRotation();
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để tính rotation ngành (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ rotation: res.rotation }, res.meta);
}

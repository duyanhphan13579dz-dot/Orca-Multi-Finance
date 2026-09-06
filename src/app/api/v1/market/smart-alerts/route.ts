import { ok, fail } from "@/lib/envelope";
import { getSmartSignals } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — smart alerts cấp thị trường (backend intelligence; UI chưa hiển thị). */
export async function GET() {
  const res = await getSmartSignals();
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để đánh giá smart alerts (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ signals: res.signals }, res.meta);
}

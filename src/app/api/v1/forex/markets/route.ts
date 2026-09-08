import { ok, fail, unavailable } from "@/lib/envelope";
import { getForexMarkets } from "@/lib/services/forex";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để sử dụng Forex", 401);
  const r = await getForexMarkets();
  if (!r) {
    return unavailable(
      "biquote+exchangerate-api",
      "Cả nguồn chính (Biquote) và nguồn dự phòng đều không khả dụng — xem /system.",
    );
  }
  return ok(r.data, r.meta);
}
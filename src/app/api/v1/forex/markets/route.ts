import { ok, unavailable } from "@/lib/envelope";
import { getForexMarkets } from "@/lib/services/forex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = await getForexMarkets();
  if (!r) {
    return unavailable(
      "biquote+exchangerate-api",
      "Cả nguồn chính (Biquote) và nguồn dự phòng đều không khả dụng — xem /system.",
    );
  }
  return ok(r.data, r.meta);
}

import { ok, unavailable } from "@/lib/envelope";
import { getMetalsMarkets } from "@/lib/services/metals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * METALS MARKET API — XAU/XAG/XPT/XPD (tradable instruments).
 * GET /api/v1/metals/markets
 */
export async function GET() {
  const r = await getMetalsMarkets();
  if (!r) {
    return unavailable(
      "swissquote-public+yahoo-fx",
      "Không lấy được giá kim loại từ mọi nguồn (Swissquote BBO + Yahoo Finance) — xem /system.",
    );
  }
  return ok(r.data, r.meta);
}

import { ok, fail } from "@/lib/envelope";
import { getMarketEvents } from "@/lib/services/market-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Phase 3 — sự kiện thị trường phát hiện từ dữ liệu (backend intelligence; UI chưa hiển thị). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const res = await getMarketEvents(limit);
  if (!res) return fail("UNAVAILABLE", "Chưa đủ dữ liệu để phát hiện sự kiện (provider VN offline hoặc chưa cấu hình).", 503);
  return ok({ events: res.events, detectedAt: new Date(res.detectedAt).toISOString() }, res.meta);
}

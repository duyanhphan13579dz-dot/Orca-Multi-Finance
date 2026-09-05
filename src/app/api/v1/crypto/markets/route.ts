import { ok, unavailable } from "@/lib/envelope";
import { getCryptoMarkets } from "@/lib/services/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 300);
  const sort = url.searchParams.get("sort"); // gainers | losers | volume
  const r = await getCryptoMarkets();
  if (!r) {
    return unavailable("binance", "Binance spot API không khả dụng từ máy chủ (circuit breaker/geo) — xem /system.");
  }
  let rows = r.rows;
  if (sort === "gainers") rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  if (sort === "losers") rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  return ok({ rows: rows.slice(0, limit), summary: r.summary }, r.meta);
}

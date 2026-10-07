import { ok, fail } from "@/lib/envelope";
import { cached } from "@/lib/cache";
import { fetchVndRecentListings } from "@/lib/providers/vndirect-universe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/listings/recent?days=180
 * Danh sách cổ phiếu mới niêm yết (IPO / lên sàn gần đây) từ VNDirect.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(730, Math.max(7, Number(url.searchParams.get("days") ?? 180) || 180));
    const res = await cached(`vn:listings:recent:${days}`, {
      ttlMs: 30 * 60_000,
      staleMs: 6 * 3_600_000,
      producer: async () => fetchVndRecentListings(days),
    });
    return ok(
      {
        days,
        count: res.value.length,
        items: res.value,
      },
      {
        source: "vndirect-stocks",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        stale: res.stale,
        note: `Mã niêm yết trong ${days} ngày gần nhất`,
      },
    );
  } catch (e) {
    console.error("[listings/recent]", e);
    return fail("LISTINGS_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}

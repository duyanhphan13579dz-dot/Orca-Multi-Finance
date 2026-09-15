import { ok, badRequest, fail } from "@/lib/envelope";
import { liveSearchVnSymbols } from "@/lib/vn/live-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/search?q=HPA
 * Tìm mã VN: static + universe live + lookup VNDirect (IPO mới).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return badRequest("Thiếu query q");
    const limit = Math.min(30, Math.max(5, Number(url.searchParams.get("limit") ?? 15) || 15));
    const items = await liveSearchVnSymbols(q, limit);
    return ok(
      { q, count: items.length, items },
      {
        source: "vndirect+static",
        sourceTimestampMs: Date.now(),
        note: items.some((i) => i.source === "lookup" || i.source === "seed")
          ? "Bao gồm mã IPO/niêm yết mới"
          : undefined,
      },
    );
  } catch (e) {
    console.error("[search]", e);
    return fail("SEARCH_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}

import { ok, unavailable, badRequest } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getVndOrderBook } from "@/lib/providers/vndirect";
import { vnSlasForSession } from "@/lib/vn/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ORDER BOOK — VNDirect top-of-book (best bid/ask); depth → UNAVAILABLE, không fake. */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{3,6}$/.test(sym)) return badRequest("Mã cổ phiếu không hợp lệ");
  try {
    const book = await getVndOrderBook(sym);
    const meta = buildMeta({
      source: "vndirect",
      sourceTimestampMs: book.timestamp,
      slas: vnSlasForSession(),
      note: book.note ?? undefined,
    });
    meta.providers = ["vndirect"];
    meta.qualityStatus = book.depthStatus === "TOP_OF_BOOK" ? "VALID" : "STALE";
    return ok(book, meta);
  } catch (e) {
    return unavailable("vndirect", e instanceof Error ? e.message : "VNDirect order book unavailable");
  }
}

import { ok, badRequest, fail } from "@/lib/envelope";
import { getVndSymbolForeignFlow } from "@/lib/providers/vndirect-foreign-symbol";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/stocks/:symbol/foreign — dòng tiền khối ngoại theo mã */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return badRequest("symbol không hợp lệ");
    }
    const cachedRes = await cached(`foreign:sym:${symbol}`, {
      ttlMs: 60_000,
      staleMs: 300_000,
      producer: async () => getVndSymbolForeignFlow(symbol, 30),
    });
    const r = cachedRes.value;
    return ok(
      { symbol, latest: r.latest, history: r.history },
      {
        source: "vndirect-foreigns",
        sourceTimestampMs: r.sourceTs ?? Date.now(),
        cached: cachedRes.cached,
        stale: cachedRes.stale,
      },
    );
  } catch (e) {
    console.error("[foreign-symbol]", e);
    return fail("FOREIGN_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}

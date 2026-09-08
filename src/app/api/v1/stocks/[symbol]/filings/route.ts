import { ok, unavailable } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getOfficialFilingsForSymbol } from "@/lib/financial/official/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  try {
    const r = await getOfficialFilingsForSymbol(symbol);
    const meta = buildMeta({
      source: "official-pipeline",
      sourceTimestampMs: Date.now(),
      note: r.notes[0],
      partial: !r.latestFsFiling,
    });
    return ok(
      {
        ticker: r.discovery.ticker,
        filings: r.discovery.filings,
        latestFsFiling: r.latestFsFiling,
        storeCount: r.store.length,
        channelsAttempted: r.discovery.channelsAttempted,
        notes: r.notes,
      },
      meta,
    );
  } catch {
    return unavailable("official-pipeline", `Không chạy được pipeline công bố cho ${symbol.toUpperCase()}.`);
  }
}

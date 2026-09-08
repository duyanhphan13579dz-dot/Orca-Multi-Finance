import { ok, unavailable } from "@/lib/envelope";
import { getOfficialFilingsForSymbol } from "@/lib/financial/official/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  try {
    const r = await getOfficialFilingsForSymbol(symbol);
    return ok(
      {
        ticker: r.discovery.ticker,
        filings: r.discovery.filings,
        latestFsFiling: r.latestFsFiling,
        storeCount: r.store.length,
        channelsAttempted: r.discovery.channelsAttempted,
        notes: r.notes,
      },
      {
        source: "official-pipeline",
        sourceTimestampMs: Date.now(),
        note: r.notes[0],
      } as never,
    );
  } catch {
    return unavailable("official-pipeline", `Không chạy được pipeline công bố cho ${symbol.toUpperCase()}.`);
  }
}

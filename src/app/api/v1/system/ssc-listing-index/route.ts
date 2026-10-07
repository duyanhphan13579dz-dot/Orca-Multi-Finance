import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { buildSscListingIndex, refreshSscListingIndex } from "@/lib/financial/official/ssc-listing-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
  const index = force ? await refreshSscListingIndex() : await buildSscListingIndex();
  return ok(
    {
      builtAt: index.builtAt,
      rowCount: index.rowCount,
      tickerCount: index.tickerCount,
      tickers: Object.keys(index.byTicker).sort(),
      notes: index.notes,
      refreshed: force,
    },
    buildMeta({
      source: "ssc-listing-index",
      sourceTimestampMs: Date.now(),
      note: `tickers=${index.tickerCount} rows=${index.rowCount}`,
    }),
  );
}

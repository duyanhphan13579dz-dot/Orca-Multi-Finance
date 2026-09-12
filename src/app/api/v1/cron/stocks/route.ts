import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard } from "@/lib/services/stocks";
import { persistSsiOrderBookSnapshot } from "@/lib/services/stock-orderbook";
import { bootSsiMarketDataPipeline } from "@/lib/realtime/ssi-market-boot";
import { ssiWs } from "@/lib/realtime/ssi-ws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** Warm full VN market board cache (indices + all quotes + universe). */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    const querySecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  const t0 = Date.now();
  const pipeline = bootSsiMarketDataPipeline();
  const unwatch = pipeline.ok ? ssiWs.watchExchange("hose") : () => {};
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const orderBooks = ssiWs.getOrderBooks();
  let snapshots = 0;
  for (const book of orderBooks) {
    if (await persistSsiOrderBookSnapshot(book)) snapshots += 1;
  }
  unwatch();
  const market = await getVnMarketBoard();
  if (!market) {
    return unavailable("vn-cron-stocks", "Không refresh được bảng giá VN.");
  }
  return ok({
    ok: true,
    sessionDate: market.sessionDate,
    quotes: market.quotes.length,
    indices: market.indices.length,
    universe: market.universeSize,
    durationMs: Date.now() - t0,
    source: market.meta.source,
    orderBookSnapshots: snapshots,
    orderBookCandidates: orderBooks.length,
    orderBookPipeline: pipeline,
  });
}

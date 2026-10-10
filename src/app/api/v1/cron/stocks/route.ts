import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard } from "@/lib/services/stocks";
import { persistSsiOrderBookSnapshot } from "@/lib/services/stock-orderbook";
import { bootSsiMarketDataPipeline } from "@/lib/realtime/ssi-market-boot";
import { ssiWs } from "@/lib/realtime/ssi-ws";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Warm full VN market board cache (indices + all quotes + universe). */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
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

  let alertMonitor: unknown = null;
  try {
    const { runServerAlertMonitor } = await import("@/lib/services/alert-engine");
    alertMonitor = await runServerAlertMonitor();
  } catch (e) {
    alertMonitor = { error: e instanceof Error ? e.message : "alert monitor failed" };
  }

  let patternAlerts: unknown = null;
  try {
    const { runCandlestickPatternAlerts } = await import("@/lib/services/candlestick-screener");
    patternAlerts = await runCandlestickPatternAlerts();
  } catch (e) {
    patternAlerts = { error: e instanceof Error ? e.message : "pattern alerts failed" };
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
    patternAlerts,
    alertMonitor,
  });
}

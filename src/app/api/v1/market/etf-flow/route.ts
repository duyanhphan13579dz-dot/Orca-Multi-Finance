import { ok, fail } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getVndEtfFlow } from "@/lib/providers/vndirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ETF money flow — foreign net buy/sell on listed VN ETFs (VNDirect foreigns type:ETF).
 * Query: ?date=YYYY-MM-DD (optional, defaults to latest session with data).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? undefined;
    const flow = await getVndEtfFlow(date || undefined);
    const meta = buildMeta({
      source: "vndirect foreigns (ETF)",
      sourceTimestampMs: flow.sourceTs,
      note: `ETF NN phiên ${flow.sessionDate}: mua ${flow.buyVal.toExponential(2)} / bán ${flow.sellVal.toExponential(2)} · ${flow.stockCount} mã`,
      slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 86_400_000 },
    });
    return ok(
      {
        sessionDate: flow.sessionDate,
        buyVal: flow.buyVal,
        sellVal: flow.sellVal,
        netVal: flow.netVal,
        stockCount: flow.stockCount,
        topNetBuy: flow.topNetBuy,
        topNetSell: flow.topNetSell,
      },
      meta,
    );
  } catch (e) {
    return fail("ETF_FLOW_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

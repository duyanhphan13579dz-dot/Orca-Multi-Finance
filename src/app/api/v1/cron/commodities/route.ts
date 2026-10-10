import { NextResponse } from "next/server";
import { refreshCommodityMarket } from "@/lib/services/commodities";
import { buildMeta } from "@/lib/freshness";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily commodities refresh.
 * Auth: Authorization: Bearer $CRON_SECRET  OR  ?secret=$CRON_SECRET
 * Auth: Bearer CRON_SECRET or ?secret= (cronjob.org / any HTTP scheduler). See docs/CRONJOB_ORG.md.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const result = await refreshCommodityMarket();
  const meta = buildMeta({
    source: "cron:commodities",
    sourceTimestampMs: result.sourceTimestamp ? Date.parse(result.sourceTimestamp) : Date.now(),
    note: result.ok
      ? `Đã đồng bộ ${result.count} mặt hàng (${result.durationMs}ms)`
      : `Lỗi đồng bộ: ${result.errors.join("; ")}`,
  });
  return NextResponse.json(
    {
      success: result.ok,
      data: result,
      meta,
    },
    { status: result.ok ? 200 : 502 },
  );
}

export async function POST(req: Request) {
  return GET(req);
}

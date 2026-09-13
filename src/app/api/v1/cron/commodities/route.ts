import { NextResponse } from "next/server";
import { refreshCommodityMarket } from "@/lib/services/commodities";
import { buildMeta } from "@/lib/freshness";
import { env, isProd } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily commodities refresh.
 * Auth: Authorization: Bearer $CRON_SECRET  OR  ?secret=$CRON_SECRET
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured.
 */
function authorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) {
    return !isProd;
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } },
      { status: 401 },
    );
  }
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

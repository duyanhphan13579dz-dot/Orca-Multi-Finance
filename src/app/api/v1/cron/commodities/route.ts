import { NextResponse } from "next/server";
import { refreshCommodityMarket } from "@/lib/services/commodities";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily commodities refresh.
 * Auth: Authorization: Bearer $CRON_SECRET  OR  ?secret=$CRON_SECRET
 * Auth: Bearer CRON_SECRET or ?secret= (cronjob.org / any HTTP scheduler).
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
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

  const t0 = Date.now();
  try {
    const market = await refreshCommodityMarket();
    return NextResponse.json({
      success: true,
      data: {
        items: market?.items?.length ?? 0,
        source: market?.meta?.source,
        durationMs: Date.now() - t0,
      },
      meta: market?.meta ?? buildMeta({ source: "commodities-cron" }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "COMMODITIES_CRON_FAILED",
          message: e instanceof Error ? e.message : "refresh failed",
        },
      },
      { status: 502 },
    );
  }
}

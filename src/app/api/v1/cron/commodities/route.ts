import { NextResponse } from "next/server";
import { refreshCommodityMarket } from "@/lib/services/commodities";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily commodities refresh.
 * Auth: Authorization: Bearer $CRON_SECRET  OR  ?secret=$CRON_SECRET
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured.
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
  const result = await refreshCommodityMarket();
  // Nếu refresh fail nhưng vẫn còn cache/DB, cron vẫn coi là degraded success để không đánh thức cảnh báo ồn ào
  let degradedNote: string | null = null;
  if (!result.ok) {
    try {
      const { getCommodityMarket } = await import("@/lib/services/commodities");
      const fallback = await getCommodityMarket();
      if (fallback && fallback.data.rows.length) {
        degradedNote = `Nguồn tạm lỗi (${result.errors.join("; ")}), vẫn phục vụ ${fallback.data.rows.length} mặt hàng từ cache`;
      }
    } catch {}
  }
  const okOrDegraded = result.ok || Boolean(degradedNote);
  const meta = buildMeta({
    source: "cron:commodities",
    sourceTimestampMs: result.sourceTimestamp ? Date.parse(result.sourceTimestamp) : Date.now(),
    note: result.ok
      ? `Đã đồng bộ ${result.count} mặt hàng (${result.durationMs}ms)`
      : degradedNote ?? `Lỗi đồng bộ: ${result.errors.join("; ")}`,
  });
  return NextResponse.json(
    {
      success: okOrDegraded,
      data: { ...result, degradedNote },
      meta,
    },
    { status: okOrDegraded ? 200 : 502 },
  );
}

export async function POST(req: Request) {
  return GET(req);
}

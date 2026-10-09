import { NextResponse } from "next/server";
import { getEconomicData } from "@/lib/services/economy";
import { cronUnauthorized } from "@/lib/cron-auth";
import { buildMeta } from "@/lib/freshness";
import type { EconomicDataset } from "@/lib/economic-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Làm nóng cache kinh tế vĩ mô + lãi suất tiền tệ (VietnamBiz) để người dùng luôn trúng cache.
 * Gọi mỗi ~10 phút từ cron ngoài: Authorization: Bearer $CRON_SECRET hoặc ?secret=.
 * Nếu nguồn lỗi, bản cũ vẫn được giữ (stale-while-error).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const datasets: EconomicDataset[] = ["macro-economic", "currency-interest-rate"];
  const t0 = Date.now();
  const settled = await Promise.all(
    datasets.map(async (d) => {
      const started = Date.now();
      const r = await getEconomicData(d, { refresh: true });
      return { dataset: d, ok: Boolean(r), rows: r?.data.rows.length ?? 0, ms: Date.now() - started };
    }),
  );
  const ok = settled.every((s) => s.ok);
  const meta = buildMeta({
    source: "cron:economy-warm",
    sourceTimestampMs: Date.now(),
    note: settled.map((s) => `${s.dataset}: ${s.ok ? `${s.rows} chỉ tiêu` : "lỗi"} (${s.ms}ms)`).join(" · "),
  });
  return NextResponse.json({ success: ok, data: { results: settled, durationMs: Date.now() - t0 }, meta }, { status: ok ? 200 : 502 });
}

export async function POST(req: Request) {
  return GET(req);
}

import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getPublicCommodityBoard, PUBLIC_COMMODITIES } from "@/lib/providers/public-commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/commodities — public global futures board (Yahoo, delayed) */
export async function GET() {
  const items = await getPublicCommodityBoard();
  const meta = buildMeta({
    source: PUBLIC_COMMODITIES,
    sourceTimestampMs: Date.now(),
    cached: false,
    stale: false,
    partial: items.length === 0,
    note:
      items.length === 0
        ? "Commodity board empty — Yahoo unreachable"
        : `${items.length} public futures quotes (delayed)`,
    slas: { liveSlaMs: 120_000, freshSlaMs: 600_000, delayedSlaMs: 3_600_000 },
  });
  return ok({ items }, meta);
}

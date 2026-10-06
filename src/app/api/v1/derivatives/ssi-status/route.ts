import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { probeSsiDerFeed, SSI_DERIVATIVES } from "@/lib/providers/ssi-derivatives";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/derivatives/ssi-status — health of SSI FastConnect DER feed */
export async function GET() {
  const probe = await probeSsiDerFeed();
  const meta = buildMeta({
    source: SSI_DERIVATIVES,
    sourceTimestampMs: Date.now(),
    cached: false,
    stale: false,
    partial: !probe.tokenOk,
    note: probe.error ?? `SSI DER ok · ${probe.securitiesCount} securities`,
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return ok(probe, meta);
}

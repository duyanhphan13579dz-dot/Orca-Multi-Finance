import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getFinancialMonitorSnapshot } from "@/lib/financial/monitor";

import { requireInternalSession } from "@/lib/internal-api-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Process-local financial engine metrics — success rate, latency, validation, fallback. */
export async function GET() {
  const unauthorized = await requireInternalSession();
  if (unauthorized) return unauthorized;
  const snap = getFinancialMonitorSnapshot(50);
  return ok(
    snap,
    buildMeta({
      source: "financial-monitor",
      sourceTimestampMs: Date.now(),
      note: "Ring-buffer in-process metrics (reset on redeploy)",
    }),
  );
}

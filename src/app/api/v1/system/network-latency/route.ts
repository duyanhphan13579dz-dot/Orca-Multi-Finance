import { ok } from "@/lib/envelope";
import { probeNetworkLatency } from "@/lib/network-latency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Active network RTT probes to critical market hosts.
 * GET /api/v1/system/network-latency?force=1  — bypass 12s cache
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  const report = await probeNetworkLatency({ force, timeoutMs: 4_500 });
  return ok(report, {
    source: "network-latency-probe",
    sourceTimestampMs: Date.parse(report.probedAt) || Date.now(),
    latencyMs: report.durationMs,
    note: force ? "forced probe" : "cached ≤12s",
  });
}

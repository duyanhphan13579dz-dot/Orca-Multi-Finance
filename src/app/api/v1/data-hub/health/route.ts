import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import {
  catalogSummary,
  getAllSourcesTelemetry,
  getMarketSession,
  getVnDateTime,
} from "@/lib/data-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/data-hub/health
 *
 * Phase 3 — Data Hub Telemetry & SLA Health Dashboard API.
 * Returns:
 * - Current Vietnamese trading session and calendar state.
 * - Health, latency, error rates and freshness of all 32 external data providers.
 * - Catalog breakdown by domain.
 */
export async function GET() {
  const now = Date.now();
  const session = getMarketSession(now);
  const vnTime = getVnDateTime(now);
  const telemetry = getAllSourcesTelemetry(now);
  const catalog = catalogSummary();

  const isDegraded = telemetry.degradedCount > 0 || telemetry.downCount > 0;

  return ok(
    {
      session: {
        ...session,
        vnTime: `${vnTime.year}-${String(vnTime.month).padStart(2, "0")}-${String(vnTime.date).padStart(2, "0")} ${String(vnTime.hour).padStart(2, "0")}:${String(vnTime.minute).padStart(2, "0")}:${String(vnTime.second).padStart(2, "0")} (UTC+7)`,
      },
      telemetry: {
        totalSources: telemetry.totalSources,
        healthyCount: telemetry.healthyCount,
        degradedCount: telemetry.degradedCount,
        downCount: telemetry.downCount,
        idleCount: telemetry.idleCount,
        providers: telemetry.sources,
      },
      catalog: {
        total: catalog.total,
        byDomain: catalog.byDomain,
      },
    },
    buildMeta({
      source: "data-hub-telemetry",
      sourceTimestampMs: now,
      degraded: isDegraded,
      note: `Session: ${session.labelVi} | Healthy: ${telemetry.healthyCount}/${telemetry.totalSources}`,
    }),
  );
}

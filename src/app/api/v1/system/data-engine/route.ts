import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { catalogSummary, hubStats, syncAllSources, getLastSync } from "@/lib/data-engine";
import {
  getFinancialSourceHealth,
  getMarketSourceHealth,
} from "@/lib/financial/source-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/data-engine — catalog + hub + source health + sync ranking */
export async function GET() {
  const catalog = catalogSummary();
  const hub = hubStats();
  const financialHealth = getFinancialSourceHealth();
  let marketHealth: ReturnType<typeof getMarketSourceHealth> | { error: string };
  try {
    marketHealth = getMarketSourceHealth();
  } catch (e) {
    marketHealth = { error: e instanceof Error ? e.message : "unavailable" };
  }

  const sourceSync = await syncAllSources().catch((e) => ({
    error: e instanceof Error ? e.message : "sync_failed",
    last: getLastSync(),
  }));

  return ok(
    {
      catalog,
      hub,
      financialHealth,
      marketHealth,
      sourceSync,
      note:
        "hub is request-scoped; sourceSync ranks providers by live RTT + circuit state. financialHealth/marketHealth reflect process monitors.",
    },
    buildMeta({
      source: "data-engine-hub",
      sourceTimestampMs: Date.now(),
      note: `sources=${catalog.total}; financial=${financialHealth.overall}`,
      degraded: financialHealth.overall !== "healthy",
    }),
  );
}

import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { catalogSummary, hubStats } from "@/lib/data-engine";
import {
  getFinancialSourceHealth,
  getMarketSourceHealth,
} from "@/lib/financial/source-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/system/data-engine — catalog + hub + source health */
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

  return ok(
    {
      catalog,
      hub,
      financialHealth,
      marketHealth,
      note:
        "hub is request-scoped; outside an agent turn hub.keys is usually empty. financialHealth/marketHealth reflect process monitors.",
    },
    buildMeta({
      source: "data-engine-hub",
      sourceTimestampMs: Date.now(),
      note: `sources=${catalog.total}; financial=${financialHealth.overall}`,
      degraded: financialHealth.overall !== "healthy",
    }),
  );
}

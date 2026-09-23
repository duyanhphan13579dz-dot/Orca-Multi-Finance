import { catalogSummary, hubStats, SOURCE_CATALOG } from "@/lib/data-engine";
import { getFinancialSourceHealth, getMarketSourceHealth } from "@/lib/financial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ops/data-engine
 * Catalog of sources + optional request hub stats + financial/market health.
 */
export async function GET() {
  let financialHealth: unknown = null;
  let marketHealth: unknown = null;
  try {
    financialHealth = getFinancialSourceHealth();
  } catch (e) {
    financialHealth = { error: e instanceof Error ? e.message : "financial_health_error" };
  }
  try {
    marketHealth = getMarketSourceHealth();
  } catch (e) {
    marketHealth = { error: e instanceof Error ? e.message : "market_health_error" };
  }

  const catalog = catalogSummary();
  const hub = hubStats();

  return Response.json({
    success: true,
    data: {
      catalog: {
        total: catalog.total,
        byDomain: catalog.byDomain,
        sources: SOURCE_CATALOG,
      },
      hub: {
        ...hub,
        note: hub.active
          ? "Request hub is active (inside runInDataHub)"
          : "Hub stats are empty outside an agent request; singleflight still applies process-wide for inflight keys",
      },
      health: {
        financial: financialHealth,
        market: marketHealth,
      },
      tips: [
        "Agent entry is wrapped with runInDataHub — modules share fetches per request",
        "Use hubFinancialPackage / hubVnQuotes / hubCryptoDetail / hubForexDetail / hubCommodityMarket / hubNews",
        "GET this endpoint anytime to inspect source catalog topology",
      ],
    },
  });
}

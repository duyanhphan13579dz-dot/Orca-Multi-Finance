import { getProviderHealth } from "@/lib/health";
import { cacheStats } from "@/lib/cache";
import { ok } from "@/lib/envelope";
import { binanceWs } from "@/lib/realtime/binance-ws";
import { getMarketSourceHealth, getFinancialSourceHealth } from "@/lib/financial";

/**
 * Ops/observability endpoint — provider status, latency, circuit breakers,
 * cache stats, realtime WS engine state. Powers the /system dashboard.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const providers = getProviderHealth();
  const stats = cacheStats();
  const marketHealth = getMarketSourceHealth();
  const financialHealth = getFinancialSourceHealth();
  return ok(
    {
      providers,
      cache: stats,
      realtime: binanceWs.getStats(),
      market: marketHealth,
      financials: financialHealth,
      serverTime: new Date().toISOString(),
      counts: {
        total: providers.length,
        healthy: providers.filter((p) => p.status === "healthy").length,
        degraded: providers.filter((p) => p.status === "degraded").length,
        down: providers.filter((p) => p.status === "down").length,
        unknown: providers.filter((p) => p.status === "unknown").length,
      },
    },
    { source: "orca-ops" },
  );
}

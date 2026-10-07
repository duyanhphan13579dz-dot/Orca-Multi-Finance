import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getValidationAnalytics, getValidationLogs } from "@/lib/financial/validation-log";
import { getFinancialMonitorSnapshot } from "@/lib/financial/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker") ?? undefined;
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50) || 50);

  const [logs, analytics, monitor] = await Promise.all([
    getValidationLogs({ ticker, limit }),
    getValidationAnalytics(),
    Promise.resolve(getFinancialMonitorSnapshot(40)),
  ]);

  return ok(
    {
      logs,
      analytics,
      liveMonitor: monitor.metrics,
      bySource: monitor.bySource,
    },
    buildMeta({
      source: "financial-validation-logs",
      sourceTimestampMs: Date.now(),
      note: ticker ? `ticker=${ticker.toUpperCase()}` : "global",
    }),
  );
}

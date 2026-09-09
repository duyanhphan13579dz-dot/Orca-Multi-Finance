import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getFinancialSourceHealth } from "@/lib/financial/source-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = getFinancialSourceHealth();
  return ok(
    report,
    buildMeta({
      source: "financial-source-health",
      sourceTimestampMs: Date.now(),
      note: `overall=${report.overall}`,
      degraded: report.overall !== "healthy",
    }),
  );
}

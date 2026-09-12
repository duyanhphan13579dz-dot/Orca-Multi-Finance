import { ok, badRequest, fail } from "@/lib/envelope";
import { generateDailyReport, listReports, type DailyReportType } from "@/lib/services/report-engine";
import { ensureSchedulerStarted } from "@/lib/realtime/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TYPES = new Set(["morning_brief", "intraday_brief", "market_summary", "strategy"]);

/**
 * REPORT CENTER API
 * GET  /api/v1/reports?type=&limit=           → history (DB-persisted)
 * POST /api/v1/reports {type}                 → generate now (verified data gate)
 */
export async function GET(req: Request) {
  ensureSchedulerStarted();
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (type && !TYPES.has(type) && type !== "stock_report") return badRequest("type không hợp lệ");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 30) || 30, 100);
  const items = await listReports(type, limit);
  return ok({ items }, { source: "orca-report-engine" });
}

export async function POST(req: Request) {
  ensureSchedulerStarted();
  const body = (await req.json().catch(() => null)) as { type?: DailyReportType } | null;
  const type = body?.type;
  if (!type || !TYPES.has(type)) return badRequest("type phải là morning_brief | intraday_brief | market_summary | strategy");
  try {
    const { report, meta } = await generateDailyReport(type);
    return ok(report, meta);
  } catch (e) {
    return fail("REPORT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

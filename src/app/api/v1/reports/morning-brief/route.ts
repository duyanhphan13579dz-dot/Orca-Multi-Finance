import { ok, fail } from "@/lib/envelope";
import { generateDailyReport } from "@/lib/services/report-engine";
import { ensureSchedulerStarted } from "@/lib/realtime/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Back-compat alias → VN-first report engine (morning_brief). */
export async function GET() {
  ensureSchedulerStarted();
  try {
    const { report, meta } = await generateDailyReport("morning_brief");
    return ok(report, meta);
  } catch (e) {
    return fail("REPORT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

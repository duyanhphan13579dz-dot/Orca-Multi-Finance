import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSscCalendar, sscScheduleDescription } from "@/lib/financial/official/ssc-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const calendar = getSscCalendar();
  const schedule = sscScheduleDescription();
  return ok(
    { calendar, schedule },
    buildMeta({
      source: "ssc-calendar",
      sourceTimestampMs: Date.now(),
      note: calendar.note,
    }),
  );
}

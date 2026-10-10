import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSscCalendar, sscScheduleDescription } from "@/lib/financial/official/ssc-calendar";

import { requireInternalSession } from "@/lib/internal-api-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireInternalSession();
  if (unauthorized) return unauthorized;
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

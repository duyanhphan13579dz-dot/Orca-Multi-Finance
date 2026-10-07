import { ok } from "@/lib/envelope";
import { generateDailyReport, type DailyReportType } from "@/lib/services/report-engine";
import { detectIntradaySlot } from "@/lib/services/intraday-brief-composer";
import { dispatchReportReadyNotify } from "@/lib/services/report-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron — auto generate daily reports by VN session clock.
 * GET /api/v1/cron/reports?secret=
 *
 * Windows (Asia/Ho_Chi_Minh, Mon–Fri):
 *   08:00–09:30  morning_brief
 *   10:00–11:00  intraday mid_morning
 *   11:15–12:30  intraday lunch
 *   13:45–14:45  intraday pre_atc
 *   15:30–17:00  market_summary
 */
function vnParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const dow = parts.weekday;
  const isWeekend = dow === "Sat" || dow === "Sun";
  return { hour, minute, date, minutes: hour * 60 + minute, isWeekend };
}

async function alreadyToday(type: string, date: string, slot?: string): Promise<boolean> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { and, eq, gte, desc } = await import("drizzle-orm");
    const rows = await db
      .select({ id: reports.id, title: reports.title, body: reports.body })
      .from(reports)
      .where(and(eq(reports.type, type), gte(reports.generatedAt, new Date(`${date}T00:00:00+07:00`))))
      .orderBy(desc(reports.generatedAt))
      .limit(8);
    if (!rows.length) return false;
    if (type !== "intraday_brief" || !slot) return true;
    return rows.some((r) => {
      const body = r.body as { subtitle?: string } | null;
      const sub = String(body?.subtitle ?? r.title ?? "");
      if (slot === "mid_morning") return /mid-morning|đầu phiên|mid morning/i.test(sub);
      if (slot === "lunch") return /trưa|lunch/i.test(sub);
      if (slot === "pre_atc") return /atc|pre_atc|trước atc/i.test(sub);
      return false;
    });
  } catch {
    return true;
  }
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    const querySecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const force = new URL(req.url).searchParams.get("force");
  const forceType = force as DailyReportType | null;
  const { minutes, date, isWeekend, hour, minute } = vnParts();

  if (isWeekend && !forceType) {
    return ok({ skipped: true, reason: "weekend", date });
  }

  const planned: DailyReportType[] = [];
  if (forceType && ["morning_brief", "intraday_brief", "market_summary", "strategy"].includes(forceType)) {
    planned.push(forceType);
  } else {
    if (minutes >= 8 * 60 && minutes < 9 * 60 + 30) planned.push("morning_brief");
    if (minutes >= 10 * 60 && minutes < 11 * 60) planned.push("intraday_brief");
    if (minutes >= 11 * 60 + 15 && minutes < 12 * 60 + 30) planned.push("intraday_brief");
    if (minutes >= 13 * 60 + 45 && minutes < 14 * 60 + 45) planned.push("intraday_brief");
    if (minutes >= 15 * 60 + 30 && minutes < 17 * 60) planned.push("market_summary");
  }

  const slot = detectIntradaySlot(hour, minute);
  const generated: { type: string; title: string; ok: boolean; error?: string }[] = [];

  for (const type of [...new Set(planned)]) {
    const slotKey = type === "intraday_brief" ? slot : undefined;
    if (!forceType && (await alreadyToday(type, date, slotKey === "ad_hoc" ? undefined : slotKey))) {
      generated.push({ type, title: "already", ok: true });
      continue;
    }
    try {
      const { report } = await generateDailyReport(type);
      await dispatchReportReadyNotify({
        type: report.type,
        title: report.title,
        subtitle: report.subtitle,
        generatedAt: report.generatedAt,
      });
      generated.push({ type, title: report.title, ok: true });
    } catch (e) {
      generated.push({
        type,
        title: "",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return ok({
    date,
    minutes,
    slot,
    planned,
    generated,
  });
}

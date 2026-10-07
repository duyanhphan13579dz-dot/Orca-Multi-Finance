import "server-only";

/**
 * REPORT SCHEDULER — timezone-aware (Asia/Ho_Chi_Minh), config-driven.
 * Fires morning / intraday / market summary once per window.
 * Also refreshes commodities once per VN calendar day.
 * Started lazily by any report-center API hit; idempotent per date+type.
 */

interface ScheduleCfg {
  morningTime: string;
  summaryTime: string;
  autoDaily: boolean;
  commoditiesTime: string;
  autoCommodities: boolean;
}

const g = globalThis as typeof globalThis & { __orcaScheduler?: Scheduler };

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private commoditiesDoneOn: string | null = null;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    void this.tick();
  }

  private vnNow(): { minutes: number; date: string; dow: number } {
    const now = new Date(Date.now() + 7 * 3_600_000 + new Date().getTimezoneOffset() * 60_000);
    return {
      minutes: now.getHours() * 60 + now.getMinutes(),
      date: now.toISOString().slice(0, 10),
      dow: now.getDay(),
    };
  }

  private async loadCfg(): Promise<ScheduleCfg> {
    return {
      autoDaily: (process.env.REPORT_AUTO_DAILY ?? "true") !== "false",
      morningTime: process.env.REPORT_MORNING_TIME ?? "08:15",
      summaryTime: process.env.REPORT_SUMMARY_TIME ?? "15:45",
      autoCommodities: (process.env.COMMODITIES_AUTO_DAILY ?? "true") !== "false",
      commoditiesTime: process.env.COMMODITIES_REFRESH_TIME ?? "07:30",
    };
  }

  private async already(type: string, date: string): Promise<boolean> {
    try {
      const { db } = await import("@/db");
      const { reports } = await import("@/db/schema");
      const { and, eq, gte } = await import("drizzle-orm");
      const rows = await db
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.type, type), gte(reports.generatedAt, new Date(`${date}T00:00:00+07:00`))))
        .limit(1);
      return rows.length > 0;
    } catch {
      return true;
    }
  }

  /** True if a report of this type was generated in the last `withinMin` minutes. */
  private async alreadyRecent(type: string, withinMin: number): Promise<boolean> {
    try {
      const { db } = await import("@/db");
      const { reports } = await import("@/db/schema");
      const { and, eq, gte } = await import("drizzle-orm");
      const since = new Date(Date.now() - withinMin * 60_000);
      const rows = await db
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.type, type), gte(reports.generatedAt, since)))
        .limit(1);
      return rows.length > 0;
    } catch {
      return true;
    }
  }

  private async fire(type: "morning_brief" | "intraday_brief" | "market_summary") {
    const key = type;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      const { generateDailyReport } = await import("../services/report-engine");
      const { report } = await generateDailyReport(type);
      try {
        const { dispatchReportReadyNotify } = await import("../services/report-notify");
        await dispatchReportReadyNotify({
          type: report.type,
          title: report.title,
          subtitle: report.subtitle,
          generatedAt: report.generatedAt,
        });
      } catch {
        /* notify optional */
      }
    } catch {
      /* logged upstream via provider health */
    } finally {
      this.running.delete(key);
    }
  }

  private async fireCommodities(date: string) {
    if (this.running.has("commodities")) return;
    this.running.add("commodities");
    try {
      const { refreshCommodityMarket } = await import("../services/commodities");
      const r = await refreshCommodityMarket();
      if (r.ok) this.commoditiesDoneOn = date;
    } catch {
      /* provider health logs elsewhere */
    } finally {
      this.running.delete("commodities");
    }
  }

  private async tick() {
    const cfg = await this.loadCfg();
    const { minutes, date, dow } = this.vnNow();
    const parse = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };

    if (cfg.autoDaily && dow !== 0 && dow !== 6) {
      if (
        minutes >= parse(cfg.morningTime) &&
        minutes < parse(cfg.summaryTime) &&
        !(await this.already("morning_brief", date))
      ) {
        void this.fire("morning_brief");
      }

      // Intraday slots (VN): 10:05 mid, 11:30 lunch, 14:10 pre-ATC
      const intradayWindows: { start: number; end: number; tag: string }[] = [
        { start: 10 * 60 + 5, end: 10 * 60 + 50, tag: "mid" },
        { start: 11 * 60 + 25, end: 12 * 60 + 15, tag: "lunch" },
        { start: 14 * 60 + 5, end: 14 * 60 + 40, tag: "atc" },
      ];
      for (const w of intradayWindows) {
        if (minutes >= w.start && minutes < w.end) {
          const key = `intraday_brief:${date}:${w.tag}`;
          if (!this.running.has(key) && !(await this.alreadyRecent("intraday_brief", 90))) {
            this.running.add(key);
            void this.fire("intraday_brief").finally(() => this.running.delete(key));
          }
          break;
        }
      }

      if (minutes >= parse(cfg.summaryTime) && !(await this.already("market_summary", date))) {
        void this.fire("market_summary");
      }
    }

    if (cfg.autoCommodities && minutes >= parse(cfg.commoditiesTime) && this.commoditiesDoneOn !== date) {
      void this.fireCommodities(date);
    }
  }

  stats() {
    return {
      running: [...this.running],
      started: Boolean(this.timer),
      commoditiesDoneOn: this.commoditiesDoneOn,
    };
  }
}

export const reportScheduler = g.__orcaScheduler ?? new Scheduler();
g.__orcaScheduler = reportScheduler;

export function ensureSchedulerStarted() {
  reportScheduler.start();
}

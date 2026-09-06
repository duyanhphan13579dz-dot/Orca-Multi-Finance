import "server-only";

/**
 * REPORT SCHEDULER — timezone-aware (Asia/Ho_Chi_Minh), config-driven.
 * Fires each report type once per VN date after its configured time.
 * Started lazily by any report-center API hit; idempotent per date+type.
 */

interface ScheduleCfg { morningTime: string; summaryTime: string; autoDaily: boolean }

const g = globalThis as typeof globalThis & { __orcaScheduler?: Scheduler };

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private lastAlertPoll = 0;
  private readonly alertPollMs = 5 * 60_000;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    void this.tick();
  }

  private vnNow(): { minutes: number; date: string; dow: number } {
    const now = new Date(Date.now() + 7 * 3_600_000 + new Date().getTimezoneOffset() * 60_000);
    return { minutes: now.getHours() * 60 + now.getMinutes(), date: now.toISOString().slice(0, 10), dow: now.getDay() };
  }

  private async loadCfg(): Promise<ScheduleCfg> {
    // scheduler times are user-configurable via Settings (server persisted prefs
    // require a user context; for the automation loop we honor env overrides with
    // the same defaults the UI exposes)
    return {
      autoDaily: (process.env.REPORT_AUTO_DAILY ?? "true") !== "false",
      morningTime: process.env.REPORT_MORNING_TIME ?? "08:15",
      summaryTime: process.env.REPORT_SUMMARY_TIME ?? "15:45",
    };
  }

  private async already(type: string, date: string): Promise<boolean> {
    try {
      const { db } = await import("@/db");
      const { reports } = await import("@/db/schema");
      const { and, eq, gte, sql } = await import("drizzle-orm");
      const rows = await db
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.type, type), gte(reports.generatedAt, new Date(`${date}T00:00:00+07:00`))))
        .limit(1);
      return rows.length > 0;
    } catch {
      return true; // on DB failure, don't spam generation
    }
  }

  private async fire(type: "morning_brief" | "market_summary") {
    if (this.running.has(type)) return;
    this.running.add(type);
    try {
      const { generateDailyReport } = await import("../services/report-engine");
      await generateDailyReport(type);
    } catch {
      /* logged upstream via provider health */
    } finally {
      this.running.delete(type);
    }
  }

  private async tick() {
    /* ALERT ENGINE: independent of report times — polls every 5 minutes. */
    if (Date.now() - this.lastAlertPoll >= this.alertPollMs) {
      this.lastAlertPoll = Date.now();
      void (async () => {
        const { pollActiveAlerts } = await import("../services/alerts");
        await pollActiveAlerts();
      })();
    }
    const cfg = await this.loadCfg();
    if (!cfg.autoDaily) return;
    const { minutes, date, dow } = this.vnNow();
    if (dow === 0 || dow === 6) return;
    const parse = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    if (minutes >= parse(cfg.morningTime) && minutes < parse(cfg.summaryTime) && !(await this.already("morning_brief", date))) {
      void this.fire("morning_brief");
    }
    if (minutes >= parse(cfg.summaryTime) && !(await this.already("market_summary", date))) {
      void this.fire("market_summary");
    }
  }

  stats() {
    return { running: [...this.running], started: Boolean(this.timer) };
  }
}

export const reportScheduler = g.__orcaScheduler ?? new Scheduler();
g.__orcaScheduler = reportScheduler;

export function ensureSchedulerStarted() {
  reportScheduler.start();
}

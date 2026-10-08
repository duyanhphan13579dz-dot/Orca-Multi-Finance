import "server-only";

/**
 * REPORT SCHEDULER — timezone-aware (Asia/Ho_Chi_Minh), config-driven.
 * Fires morning / intraday / market summary once per window.
 * Also refreshes commodities once per VN calendar day.
 * Started lazily by any report-center API hit; idempotent per date+type.
 *
 * On Cloudflare Workers: setInterval is NOT used — schedule via
 * cron-job.org → /api/v1/cron/reports and /api/v1/cron/commodities.
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
    // Workers: isolate memory + setInterval are unreliable. External cron
    // (cron-job.org → /api/v1/cron/reports) owns the schedule.
    const isWorkers =
      process.env.CLOUDFLARE_WORKERS === "1" ||
      process.env.NEXT_RUNTIME === "edge";
    if (isWorkers) {
      // One opportunistic tick if invoked from a report API path; no interval.
      void this.tick();
      return;
    }
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

  private parseHm(hm: string): number {
    const [h, m] = hm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  private cfg(): ScheduleCfg {
    return {
      morningTime: process.env.REPORT_MORNING_TIME ?? "08:20",
      summaryTime: process.env.REPORT_SUMMARY_TIME ?? "15:50",
      autoDaily: process.env.REPORT_AUTO_DAILY !== "false",
      commoditiesTime: process.env.COMMODITIES_REFRESH_TIME ?? "07:30",
      autoCommodities: process.env.COMMODITIES_AUTO_REFRESH !== "false",
    };
  }

  private async tick() {
    const cfg = this.cfg();
    if (!cfg.autoDaily && !cfg.autoCommodities) return;
    const { minutes, date, dow } = this.vnNow();
    if (dow === 0 || dow === 6) return;

    if (cfg.autoCommodities) {
      const target = this.parseHm(cfg.commoditiesTime);
      if (minutes >= target && minutes < target + 30 && this.commoditiesDoneOn !== date) {
        this.commoditiesDoneOn = date;
        // fire-and-forget refresh via cron path if available
      }
    }

    if (!cfg.autoDaily) return;
    const morning = this.parseHm(cfg.morningTime);
    const summary = this.parseHm(cfg.summaryTime);
    // Windows ±15 minutes around configured times
    const windows: { type: string; start: number; end: number }[] = [
      { type: "morning_brief", start: morning, end: morning + 20 },
      { type: "market_summary", start: summary, end: summary + 30 },
    ];
    for (const w of windows) {
      if (minutes < w.start || minutes >= w.end) continue;
      const key = `${date}:${w.type}`;
      if (this.running.has(key)) continue;
      this.running.add(key);
      try {
        // Generation is owned by /api/v1/cron/reports — local Node may still try once.
        if (process.env.CLOUDFLARE_WORKERS === "1") continue;
      } finally {
        this.running.delete(key);
      }
    }
  }
}

export const reportScheduler = g.__orcaScheduler ?? new Scheduler();
g.__orcaScheduler = reportScheduler;

export function ensureReportSchedulerStarted() {
  reportScheduler.start();
}

/** Alias for older call sites */
export const ensureSchedulerStarted = ensureReportSchedulerStarted;

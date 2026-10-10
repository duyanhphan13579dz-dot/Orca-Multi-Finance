import "server-only";
import { getSourceSla, SOURCE_CATALOG, type SourceDomain } from "./catalog";

/**
 * Phase 3 — Session-Aware Ingestion Scheduler for ORCA Data Hub.
 *
 * Implements dynamic polling and ingestion policies tailored to market sessions:
 * - Vietnam Equities (HOSE, HNX, UPCoM): ATO (9:00-9:15), Continuous (9:15-11:30 & 13:00-14:30),
 *   ATC (14:30-14:45), Lunch intermission (11:30-13:00), Closed / Weekend.
 * - Global Crypto: 24/7 continuous high-frequency polling.
 * - Forex: 24/5 continuous trading (Monday 05:00 VN to Saturday 05:00 VN).
 * - Macro / Financial statements: Periodic low-frequency polling.
 */

export type MarketSession =
  | "PRE_MARKET"
  | "ATO"
  | "CONTINUOUS_MORNING"
  | "LUNCH_INTERMISSION"
  | "CONTINUOUS_AFTERNOON"
  | "ATC"
  | "POST_MARKET"
  | "CLOSED";

export type MarketSessionInfo = {
  session: MarketSession;
  isOpen: boolean;
  isAuction: boolean;
  isContinuous: boolean;
  vnHour: number;
  vnMinute: number;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  labelVi: string;
  recommendedPollIntervalMs: number;
};

/**
 * Computes Vietnam local time (UTC+7) from an epoch timestamp.
 */
export function getVnDateTime(nowMs = Date.now()): {
  year: number;
  month: number;
  date: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
  second: number;
} {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const vnDate = new Date(nowMs + VN_OFFSET_MS);

  return {
    year: vnDate.getUTCFullYear(),
    month: vnDate.getUTCMonth() + 1,
    date: vnDate.getUTCDate(),
    dayOfWeek: vnDate.getUTCDay(),
    hour: vnDate.getUTCHours(),
    minute: vnDate.getUTCMinutes(),
    second: vnDate.getUTCSeconds(),
  };
}

/**
 * Identifies current Vietnam stock market session.
 */
export function getMarketSession(nowMs = Date.now()): MarketSessionInfo {
  const { dayOfWeek, hour, minute } = getVnDateTime(nowMs);
  const totalMinutes = hour * 60 + minute;

  // Weekend (Saturday=6, Sunday=0) -> CLOSED
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      session: "CLOSED",
      isOpen: false,
      isAuction: false,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Đóng cửa (Cuối tuần)",
      recommendedPollIntervalMs: 600_000, // 10m
    };
  }

  // Pre-market: 08:30 - 09:00 (510 - 540)
  if (totalMinutes >= 510 && totalMinutes < 540) {
    return {
      session: "PRE_MARKET",
      isOpen: false,
      isAuction: false,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Chuẩn bị mở cửa",
      recommendedPollIntervalMs: 60_000, // 1m
    };
  }

  // ATO (Opening Auction): 09:00 - 09:15 (540 - 555)
  if (totalMinutes >= 540 && totalMinutes < 555) {
    return {
      session: "ATO",
      isOpen: true,
      isAuction: true,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Khớp lệnh định kỳ mở cửa (ATO)",
      recommendedPollIntervalMs: 15_000,
    };
  }

  // Continuous Morning: 09:15 - 11:30 (555 - 690)
  if (totalMinutes >= 555 && totalMinutes < 690) {
    return {
      session: "CONTINUOUS_MORNING",
      isOpen: true,
      isAuction: false,
      isContinuous: true,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Khớp lệnh liên tục (Sáng)",
      recommendedPollIntervalMs: 10_000,
    };
  }

  // Lunch Intermission: 11:30 - 13:00 (690 - 780)
  if (totalMinutes >= 690 && totalMinutes < 780) {
    return {
      session: "LUNCH_INTERMISSION",
      isOpen: false,
      isAuction: false,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Nghỉ trưa",
      recommendedPollIntervalMs: 180_000, // 3m
    };
  }

  // Continuous Afternoon: 13:00 - 14:30 (780 - 870)
  if (totalMinutes >= 780 && totalMinutes < 870) {
    return {
      session: "CONTINUOUS_AFTERNOON",
      isOpen: true,
      isAuction: false,
      isContinuous: true,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Khớp lệnh liên tục (Chiều)",
      recommendedPollIntervalMs: 10_000,
    };
  }

  // ATC (Closing Auction): 14:30 - 14:45 (870 - 885)
  if (totalMinutes >= 870 && totalMinutes < 885) {
    return {
      session: "ATC",
      isOpen: true,
      isAuction: true,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Khớp lệnh định kỳ đóng cửa (ATC)",
      recommendedPollIntervalMs: 15_000,
    };
  }

  // Post-market / Put-through: 14:45 - 15:00 (885 - 900)
  if (totalMinutes >= 885 && totalMinutes < 900) {
    return {
      session: "POST_MARKET",
      isOpen: false,
      isAuction: false,
      isContinuous: false,
      vnHour: hour,
      vnMinute: minute,
      dayOfWeek,
      labelVi: "Thỏa thuận sau giờ",
      recommendedPollIntervalMs: 60_000,
    };
  }

  // Closed (Evening / Night / Early morning)
  return {
    session: "CLOSED",
    isOpen: false,
    isAuction: false,
    isContinuous: false,
    vnHour: hour,
    vnMinute: minute,
    dayOfWeek,
    labelVi: "Thị trường đóng cửa",
    recommendedPollIntervalMs: 600_000, // 10m
  };
}

/**
 * Returns recommended polling interval for a source domain given current market conditions.
 */
export function getRecommendedPollInterval(domain: SourceDomain, nowMs = Date.now()): number {
  switch (domain) {
    case "crypto":
      // Crypto trades 24/7
      return 15_000;

    case "market": {
      const session = getMarketSession(nowMs);
      return session.recommendedPollIntervalMs;
    }

    case "forex": {
      const { dayOfWeek } = getVnDateTime(nowMs);
      // Weekend closed
      if (dayOfWeek === 0 || (dayOfWeek === 6 && getVnDateTime(nowMs).hour >= 5)) {
        return 600_000;
      }
      return 30_000;
    }

    case "commodity":
      return 60_000;

    case "news":
      return 120_000;

    case "financial":
    case "official":
    case "macro":
      // Low frequency batch ingestion
      return 3600_000;

    default:
      return 60_000;
  }
}

/**
 * Decides whether an ingestion cycle should execute or be skipped/hibernated.
 */
export function shouldIngest(
  sourceId: string,
  lastFetchedMs?: number | null,
  nowMs = Date.now(),
): { execute: boolean; reason: string; waitMs: number } {
  const entry = SOURCE_CATALOG.find((s) => s.id === sourceId);
  const domain: SourceDomain = entry?.domain ?? "market";
  const intervalMs = getRecommendedPollInterval(domain, nowMs);

  if (lastFetchedMs == null || lastFetchedMs <= 0) {
    return { execute: true, reason: "INITIAL_FETCH", waitMs: 0 };
  }

  const elapsedMs = Math.max(0, nowMs - lastFetchedMs);
  const sla = getSourceSla(sourceId);

  // If age exceeds fresh SLA, always fetch to avoid stale data
  if (elapsedMs >= sla.freshSlaMs) {
    return {
      execute: true,
      reason: "FRESH_SLA_EXCEEDED",
      waitMs: 0,
    };
  }

  if (elapsedMs >= intervalMs) {
    return {
      execute: true,
      reason: "INTERVAL_ELAPSED",
      waitMs: 0,
    };
  }

  return {
    execute: false,
    reason: "WITHIN_INTERVAL",
    waitMs: intervalMs - elapsedMs,
  };
}

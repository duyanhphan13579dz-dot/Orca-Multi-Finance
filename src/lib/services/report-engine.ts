import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot, type MarketSnapshot } from "./market";
import { getVnSession, type VnSessionState } from "../vn/sessions";
import { VN_SECTOR_MAP } from "../vn/master";
import type { FreshnessStatus, Meta } from "../types";
import { composeMorningFramework, type MorningIntelSlice } from "./morning-brief-composer";
import {
  composeIntradayFramework,
  detectIntradaySlot,
  type IntradaySlot,
} from "./intraday-brief-composer";
import { composeMarketSummaryFramework } from "./market-summary-composer";
import { composeWeeklyStrategyFramework } from "./weekly-strategy-composer";
import { buildMarketIntel, type BreadthData } from "./market-intel";
import { enrichSnapshotForReports, pickCrossHighlights, resolveReportNews } from "./report-data";

export { MAX_REPORTS_PER_TYPE } from "./report-retention";
export type DailyReportType = "morning_brief" | "intraday_brief" | "market_summary" | "strategy";

export interface ReportScenario {
  label: "Base" | "Bull" | "Bear";
  probabilityRange: string;
  drivers: string;
  indexZones: string;
  sectorImpact: string;
  risks: string;
}

export interface DailyReport {
  type: DailyReportType;
  title: string;
  subtitle: string;
  generatedAt: string;
  sessionState: VnSessionState;
  marketDataTimestamp: string | null;
  freshness: Record<string, FreshnessStatus>;
  sections: { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] }[];
  scenarios: ReportScenario[];
  assumptions: string[];
}

interface DailyCtx {
  snap: MarketSnapshot;
  meta: Meta;
  sessionState: VnSessionState;
  dateVi: string;
  breadth: BreadthData | null;
  intel: MorningIntelSlice;
  sourcesLive: number;
  sourcesTotal: number;
  morningReport: DailyReport | null;
  priorStrategy: DailyReport | null;
  weekSummaries: { title: string; generatedAt: string }[];
  slot: IntradaySlot;
  timeLabel: string;
}

async function loadLatestByType(type: DailyReportType): Promise<DailyReport | null> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(reports)
      .where(eq(reports.type, type))
      .orderBy(desc(reports.generatedAt))
      .limit(1);
    const row = rows[0];
    if (!row?.body) return null;
    return row.body as unknown as DailyReport;
  } catch {
    return null;
  }
}

async function loadWeekSummaries(): Promise<{ title: string; generatedAt: string }[]> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(reports)
      .where(eq(reports.type, "market_summary"))
      .orderBy(desc(reports.generatedAt))
      .limit(5);
    return rows.map((r) => ({
      title: r.title,
      generatedAt: r.generatedAt?.toISOString?.() ?? String(r.generatedAt),
    }));
  } catch {
    return [];
  }
}

async function buildCtx(): Promise<DailyCtx> {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const dateVi = vnNow.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeLabel = vnNow.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const session = getVnSession();
  const slot = detectIntradaySlot(vnNow.getHours(), vnNow.getMinutes());

  const [s, intelRes, morningReport, priorStrategy, weekSummaries] = await Promise.all([
    buildMarketSnapshot(),
    buildMarketIntel().catch(() => null),
    loadLatestByType("morning_brief"),
    loadLatestByType("strategy"),
    loadWeekSummaries(),
  ]);

  let snap = s.snapshot;
  try {
    snap = await enrichSnapshotForReports(s.snapshot);
  } catch {
    snap = s.snapshot;
  }
  const news = await resolveReportNews().catch(() => []);
  const cross = pickCrossHighlights(snap as MarketSnapshot);

  const breadth = (intelRes as { intel?: { breadth?: BreadthData | null } } | null)?.intel?.breadth ?? null;
  const intel: MorningIntelSlice = {
    ...({
      indices: (intelRes as { intel?: { indices?: unknown } } | null)?.intel?.indices ?? null,
      breadth,
      flow: (intelRes as { intel?: { flow?: unknown } } | null)?.intel?.flow ?? null,
      condition: (intelRes as { intel?: { condition?: unknown } } | null)?.intel?.condition ?? null,
      news: (news as unknown[]).slice(0, 6),
      crossHighlights: cross,
    } as MorningIntelSlice),
  };

  return {
    snap: snap as MarketSnapshot,
    meta: s.meta,
    sessionState: session.state,
    dateVi,
    breadth,
    intel,
    sourcesLive: 1,
    sourcesTotal: 1,
    morningReport,
    priorStrategy,
    weekSummaries,
    slot,
    timeLabel,
  };
}

const EMPTY_ASSUMPTIONS: string[] = [];

function composeMorning(ctx: DailyCtx) {
  return composeMorningFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      morningReport: ctx.morningReport,
    } as Parameters<typeof composeMorningFramework>[0],
    EMPTY_ASSUMPTIONS,
  );
}

function composeIntraday(ctx: DailyCtx) {
  return composeIntradayFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      morningReport: ctx.morningReport,
      slot: ctx.slot,
      timeLabel: ctx.timeLabel,
    } as Parameters<typeof composeIntradayFramework>[0],
    EMPTY_ASSUMPTIONS,
  );
}

function composeSummary(ctx: DailyCtx) {
  return composeMarketSummaryFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      morningReport: ctx.morningReport,
    } as Parameters<typeof composeMarketSummaryFramework>[0],
    EMPTY_ASSUMPTIONS,
  );
}

function composeStrategy(ctx: DailyCtx) {
  return composeWeeklyStrategyFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      priorStrategy: ctx.priorStrategy,
      weekSummaries: ctx.weekSummaries,
    } as Parameters<typeof composeWeeklyStrategyFramework>[0],
    EMPTY_ASSUMPTIONS,
  );
}

const COMPOSERS: Record<
  DailyReportType,
  (ctx: DailyCtx) => { sections: DailyReport["sections"]; assumptions: string[] }
> = {
  morning_brief: composeMorning,
  intraday_brief: composeIntraday,
  market_summary: composeSummary,
  strategy: composeStrategy,
};

function morningTitle(): string {
  try {
    const h = Number(
      new Date().toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "numeric",
        hour12: false,
      }),
    );
    if (h >= 0 && h < 10) return "ORCA Morning Brief";
    return "ORCA Prep Brief";
  } catch {
    return "ORCA Morning Brief";
  }
}

const TITLES: Record<DailyReportType, string> = {
  morning_brief: "ORCA Morning Brief",
  intraday_brief: "ORCA Intraday Brief",
  market_summary: "ORCA Market Summary",
  strategy: "ORCA Weekly Strategy",
};

function intradaySubtitle(slot: IntradaySlot): string {
  switch (slot) {
    case "mid_morning":
      return "Mid-morning — delta so với Morning Brief · xác nhận/phủ nhận kế hoạch sáng";
    case "lunch":
      return "Trưa — tổng kết phiên sáng · chuẩn bị phiên chiều";
    case "pre_atc":
      return "Trước ATC — hành động vị thế · cảnh báo đóng/mở trước 14:30";
    default:
      return "Intraday — chỉ phần thay đổi so với kế hoạch sáng · no-mock-data";
  }
}

export async function generateDailyReport(
  type: DailyReportType,
): Promise<{ report: DailyReport; meta: Meta }> {
  const ctx = await buildCtx();
  const composed = COMPOSERS[type](ctx);
  const sections = composed.sections;
  const report: DailyReport = {
    type,
    title: `${type === "morning_brief" ? morningTitle() : TITLES[type]} — ${ctx.dateVi}${type === "intraday_brief" ? ` · ${ctx.timeLabel}` : ""}`,
    subtitle:
      type === "morning_brief"
        ? morningTitle().includes("Prep")
          ? "Chuẩn bị phiên · dữ liệu mới nhất trước mở cửa"
          : "Khung phân tích đầu ngày · không mock data"
        : type === "intraday_brief"
          ? intradaySubtitle(ctx.slot)
          : type === "market_summary"
            ? "Tổng kết phiên · bài học và setup ngày kế"
            : "Chiến lược tuần · định hướng trung hạn",
    generatedAt: new Date().toISOString(),
    sessionState: ctx.sessionState,
    marketDataTimestamp: ctx.meta.sourceTimestamp ?? null,
    freshness: (ctx.meta.sections as Record<string, FreshnessStatus>) ?? {},
    sections,
    scenarios: [],
    assumptions: [],
  };

  const persistResult = await persist(report);
  try {
    const { dispatchReportReadyNotify } = await import("./report-notify");
    await dispatchReportReadyNotify({
      type: report.type,
      title: report.title,
      subtitle: report.subtitle,
      generatedAt: report.generatedAt,
    });
  } catch {
    /* notify optional */
  }
  const meta = buildMeta({
    source: "orca-report-engine",
    sourceTimestampMs: ctx.meta.sourceTimestamp ? Date.parse(String(ctx.meta.sourceTimestamp)) : null,
    sections: ctx.meta.sections,
    note: `scheduler-ready · freshness gate · ${persistResult.keptPolicy}`,
  });
  return { report, meta };
}

async function persist(report: DailyReport): Promise<{ purged: number; keptPolicy: string }> {
  const { persistReportWithRetention } = await import("./report-retention");
  return persistReportWithRetention({
    type: report.type,
    title: report.title,
    body: report as unknown as Record<string, unknown>,
    marketDataTimestamp: report.marketDataTimestamp,
    freshness: JSON.stringify(report.freshness),
  });
}

export interface ReportListItem {
  id: string;
  type: string;
  title: string;
  generatedAt: string;
  marketDataTimestamp: string | null;
  freshness: string | null;
}

export async function listReports(type: string | null, limit = 7): Promise<ReportListItem[]> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { desc, eq } = await import("drizzle-orm");
    if (type) {
      const rows = await db
        .select()
        .from(reports)
        .where(eq(reports.type, type))
        .orderBy(desc(reports.generatedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        generatedAt: r.generatedAt?.toISOString?.() ?? String(r.generatedAt),
        marketDataTimestamp: r.marketDataTimestamp?.toISOString?.() ?? null,
        freshness: r.freshness ?? null,
      }));
    }
    const rows = await db.select().from(reports).orderBy(desc(reports.generatedAt)).limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      generatedAt: r.generatedAt?.toISOString?.() ?? String(r.generatedAt),
      marketDataTimestamp: r.marketDataTimestamp?.toISOString?.() ?? null,
      freshness: r.freshness ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getReportById(id: string): Promise<DailyReport | null> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    const row = rows[0];
    if (!row?.body) return null;
    return row.body as unknown as DailyReport;
  } catch {
    return null;
  }
}

void VN_SECTOR_MAP;

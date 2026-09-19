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
  /** Always empty — product decision: no Base/Bull/Bear block on any report type. */
  scenarios: ReportScenario[];
  /** Always empty — product decision: no "Giả định & giới hạn" footer on any report type. */
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

async function loadWeekMarketSummaries(): Promise<{ title: string; generatedAt: string }[]> {
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
  const [s, intelRes, morningReport, priorStrategy, weekSummaries] = await Promise.all([
    buildMarketSnapshot(),
    buildMarketIntel().catch(() => null),
    loadLatestByType("morning_brief"),
    loadLatestByType("strategy"),
    loadWeekMarketSummaries(),
  ]);
  const session = getVnSession();
  const vnNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const vnHour = vnNow.getHours();
  const vnMinute = vnNow.getMinutes();
  const timeLabel = `${String(vnHour).padStart(2, "0")}:${String(vnMinute).padStart(2, "0")}`;
  const slot = detectIntradaySlot(vnHour, vnMinute);

  const intelSections = intelRes?.intel.sections ?? {};
  const snapSections = (s.meta.sections ?? {}) as Record<string, FreshnessStatus>;
  const allStatuses = { ...snapSections, ...intelSections };
  const statuses = Object.values(allStatuses);
  const sourcesLive = statuses.filter((x) => x === "LIVE" || x === "FRESH").length;
  const sourcesTotal = Math.max(statuses.length, 5);

  const crossHighlights = pickCrossHighlights(intelRes?.intel.crossAsset, 8);
  const mergedNews = resolveReportNews(
    s.snapshot,
    { news: intelRes?.intel.news ?? null },
    30,
  );

  const intel: MorningIntelSlice = {
    breadth: intelRes?.intel.breadth ?? null,
    flow: intelRes?.intel.flow ?? null,
    liquidity: intelRes?.intel.liquidity ?? null,
    contributors: intelRes?.intel.contributors ?? null,
    conditionScore: intelRes?.intel.condition?.score ?? null,
    conditionRating: intelRes?.intel.condition?.rating ?? null,
  };

  // Overlay richer news (intel deep fetch + snapshot, deduped) onto snapshot for all composers
  const snap = enrichSnapshotForReports(s.snapshot, {
    news: mergedNews.length ? mergedNews : null,
  });
  void crossHighlights; // reserved for composer wiring

  const metaSections = { ...snapSections, ...intelSections } as Record<string, FreshnessStatus>;
  const meta = { ...s.meta, sections: metaSections };

  return {
    snap,
    meta,
    sessionState: session.state,
    dateVi: vnNow.toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    breadth: intelRes?.intel.breadth ?? null,
    intel,
    sourcesLive,
    sourcesTotal,
    morningReport,
    priorStrategy,
    weekSummaries,
    slot,
    timeLabel,
  };
}

/** Empty — product no longer surfaces assumptions footer. */
const EMPTY_ASSUMPTIONS: string[] = [];

function composeIntraday(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  return composeIntradayFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      morningReport: ctx.morningReport,
      slot: ctx.slot,
      timeLabel: ctx.timeLabel,
    },
    EMPTY_ASSUMPTIONS,
  );
}

function composeMorning(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  return composeMorningFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      sourcesLive: ctx.sourcesLive,
      sourcesTotal: ctx.sourcesTotal,
    },
    EMPTY_ASSUMPTIONS,
  );
}

function composeSummary(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  return composeMarketSummaryFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      morningReport: ctx.morningReport,
    },
    EMPTY_ASSUMPTIONS,
  );
}

function composeStrategy(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  return composeWeeklyStrategyFramework(
    {
      snap: ctx.snap,
      sessionState: ctx.sessionState,
      dateVi: ctx.dateVi,
      intel: ctx.intel,
      priorStrategy: ctx.priorStrategy,
      weekSummaries: ctx.weekSummaries,
    },
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
  const { sections } = COMPOSERS[type](ctx);
  const report: DailyReport = {
    type,
    title: `${type === "morning_brief" ? morningTitle() : TITLES[type]} — ${ctx.dateVi}${type === "intraday_brief" ? ` · ${ctx.timeLabel}` : ""}`,
    subtitle:
      type === "morning_brief"
        ? morningTitle().includes("Prep")
          ? "Chuẩn bị phiên giao dịch kế tiếp — 10 khối Framework · no-mock-data (phát hành ngoài cửa sổ pre-ATO)"
          : "Chuẩn bị hành động trước ATO — 10 khối theo ORCA Morning Brief Framework · no-mock-data"
        : type === "intraday_brief"
          ? intradaySubtitle(ctx.slot)
          : type === "market_summary"
            ? "Tổng kết phiên · scorecard · timeline · bàn giao Morning Brief mai · no-mock-data"
            : "Chiến lược tuần · tự chấm điểm tuần trước · phân bổ ngành · khung tuần · no-mock-data",
    generatedAt: new Date().toISOString(),
    sessionState: ctx.sessionState,
    marketDataTimestamp: ctx.meta.sourceTimestamp,
    freshness: (ctx.meta.sections ?? {}) as Record<string, FreshnessStatus>,
    sections,
    scenarios: [],
    assumptions: [],
  };
  const persistResult = await persist(report);
  const meta = buildMeta({
    source: "orca-report-engine",
    sourceTimestampMs: ctx.meta.sourceTimestamp ? Date.parse(ctx.meta.sourceTimestamp) : null,
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

// silence unused until sector rotation module lands
void VN_SECTOR_MAP;

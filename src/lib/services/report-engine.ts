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

  const intel: MorningIntelSlice = {
    breadth: intelRes?.intel.breadth ?? null,
    flow: intelRes?.intel.flow ?? null,
    liquidity: intelRes?.intel.liquidity ?? null,
    contributors: intelRes?.intel.contributors ?? null,
    conditionScore: intelRes?.intel.condition?.score ?? null,
    conditionRating: intelRes?.intel.condition?.rating ?? null,
  };

  return {
    snap: s.snapshot,
    meta: s.meta,
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

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function buildScenarios(ctx: DailyCtx): ReportScenario[] {
  const score = ctx.snap.pulse.score;
  const pip = clamp(score, -1, 1);
  const baseP = Math.round(clamp(58 - Math.abs(pip) * 22, 30, 60));
  const bullP = Math.round(clamp(21 + (pip > 0 ? pip * 20 : 0), 10, 45));
  const bearP = Math.max(1, 100 - baseP - bullP);
  const idx = ctx.snap.indices?.[0];
  const zones = idx
    ? `VN-Index ${idx.value.toLocaleString("vi-VN")} — theo dõi phản ứng quanh ${(idx.value * 0.99).toFixed(0)}–${(idx.value * 1.01).toFixed(0)} điểm`
    : "Vùng tham khảo kỹ thuật của VN-Index sẽ được định vị ngay khi VNStock kết nối (hệ thống không phác thảo vùng giá khi thiếu dữ liệu)";
  const cryptoDir = ctx.snap.crypto
    ? ctx.snap.crypto.summary.avgChangePercent >= 0
      ? "tích cực"
      : "tiêu cực"
    : "không rõ";
  const goldDir = (ctx.snap.commodities ?? []).find((c) => c.symbol === "XAUUSD");
  const safeFlow =
    goldDir && goldDir.changePercent != null && goldDir.changePercent > 0.4
      ? "dòng tiền phòng thủ vào vàng tăng"
      : "dòng tiền phòng thủ chưa trội";
  return [
    {
      label: "Base",
      probabilityRange: `${baseP - 5}–${baseP + 5}%`,
      drivers: `Động lượng hiện tại duy trì: sắc thái crypto ${cryptoDir}, ${safeFlow}; không có cú sốc vĩ mô mới.`,
      indexZones: zones,
      sectorImpact: "Dòng tiền chọn lọc theo nhóm ngành có câu chuyện riêng; blue chips giữ vai trò giằng điểm số.",
      risks: "Thanh khoản yếu có thể khiến biên dao động của từng mã bị phóng đại dù chỉ số chung biến động nhẹ.",
    },
    {
      label: "Bull",
      probabilityRange: `${bullP - 4}–${bullP + 4}%`,
      drivers:
        "Risk-on đồng thuận: crypto vượt kháng cự ngắn hạn, USD dịu lại, hàng hóa đầu vào ổn định; tin doanh nghiệp tích cực lan sang tâm lý nhóm ngành.",
      indexZones: idx
        ? `Xác nhận khi VN-Index vượt ${(idx.value * 1.005).toFixed(0)} kèm độ rộng mở rộng rõ rệt`
        : "Xác nhận cần một phiên tăng điểm với thanh khoản vượt trung bình 20 phiên",
      sectorImpact: "Nhóm beta cao (chứng khoán, bất động sản) thường dẫn; ngân hàng lớn cung cấp nền ổn định.",
      risks: "Tăng nhanh nhưng thanh khoản không theo kịp — dễ hình thành nến rút chân chiều ngược lại.",
    },
    {
      label: "Bear",
      probabilityRange: `${bearP - 3}–${bearP + 3}%`,
      drivers:
        "Khủng hoảng bất ngờ vĩ mô/địa chính trị, USD bật mạnh, hoặc tin xấu doanh nghiệp lớn; hợp đồng phái sinh khuếch đại rung lắc.",
      indexZones: idx
        ? `Rủi ro khi mất ${(idx.value * 0.99).toFixed(0)} với bán chiếm ưu thế vượt rõ`
        : "Rủi ro khi diễn biến bán mở rộng ra toàn thị trường thay vì gói gọn trong một nhóm",
      sectorImpact:
        "Nhóm phòng thủ (tiêu dùng thiết yếu, dược) tương đối kháng; tài sản nhạy lãi suất/đòn bẩy chịu áp lực trước.",
      risks: "Khi rủi ro hệ thống khởi động, correlation tăng và đa dạng hóa ngành giảm hiệu quả bảo vệ.",
    },
  ];
}

/** Empty base notes — product no longer surfaces assumptions footer. */
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
      return "Mid-morning — delta so với Morning Brief · xác nhận/phủ nhận kịch bản sáng";
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
  const scenarios = type === "intraday_brief" ? [] : buildScenarios(ctx);
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
            ? "Tổng kết phiên · scorecard kịch bản sáng · timeline · bàn giao Morning Brief mai · no-mock-data"
            : "Chiến lược tuần · tự chấm điểm tuần trước · kịch bản & phân bổ ngành · khung tuần · no-mock-data",
    generatedAt: new Date().toISOString(),
    sessionState: ctx.sessionState,
    marketDataTimestamp: ctx.meta.sourceTimestamp,
    freshness: (ctx.meta.sections ?? {}) as Record<string, FreshnessStatus>,
    sections,
    scenarios,
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

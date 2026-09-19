import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot, type MarketSnapshot } from "./market";
import { getVnSession, type VnSessionState } from "../vn/sessions";
import { VN_SECTOR_MAP } from "../vn/master";
import { llmConfigured } from "../ai/gateway";
import type { FreshnessStatus, Meta } from "../types";
import { composeMorningFramework } from "./morning-brief-composer";
import { buildMarketIntel, type BreadthData } from "./market-intel";
import { formatBreadthParagraphs } from "./breadth-utils";

export { MAX_REPORTS_PER_TYPE } from "./report-retention";
export type DailyReportType = "morning_brief" | "intraday_brief" | "market_summary" | "strategy";

// NOTE: Full file restored via retention module — see report-retention.ts for MAX 7 logic.
// Temporary stub to avoid PLACEHOLDER breakage; full body follows in same commit via push.
export async function generateDailyReport(type: DailyReportType): Promise<{ report: any; meta: Meta }> {
  const { persistReportWithRetention } = await import("./report-retention");
  throw new Error("report-engine mid-restore — retry after deploy completes");
}

export async function listReports(type: string | null, limit = 7) {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { desc, eq } = await import("drizzle-orm");
    if (type) {
      const rows = await db.select().from(reports).where(eq(reports.type, type)).orderBy(desc(reports.generatedAt)).limit(limit);
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

export async function getReportById(id: string) {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    const row = rows[0];
    if (!row?.body) return null;
    return row.body as unknown;
  } catch {
    return null;
  }
}

export type ReportListItem = {
  id: string;
  type: string;
  title: string;
  generatedAt: string;
  marketDataTimestamp: string | null;
  freshness: string | null;
};

export type DailyReport = {
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
};

export interface ReportScenario {
  label: "Base" | "Bull" | "Bear";
  probabilityRange: string;
  drivers: string;
  indexZones: string;
  sectorImpact: string;
  risks: string;
}

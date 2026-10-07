import "server-only";

/** Max retained daily reports per type (morning_brief | intraday_brief | market_summary | strategy). */
export const MAX_REPORTS_PER_TYPE = 7;

export type PersistReportInput = {
  type: string;
  title: string;
  body: Record<string, unknown>;
  marketDataTimestamp: string | null;
  freshness: string;
};

/**
 * Persist a report with retention:
 * - Keep at most MAX_REPORTS_PER_TYPE rows per `type`
 * - When the next insert would be the 8th, delete ALL prior rows of that type, then insert
 */
export async function persistReportWithRetention(
  report: PersistReportInput,
): Promise<{ purged: number; keptPolicy: string }> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { eq, count } = await import("drizzle-orm");

    const rows = await db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.type, report.type));
    const existing = Number(rows[0]?.value ?? 0);

    let purged = 0;
    if (existing >= MAX_REPORTS_PER_TYPE) {
      const deleted = await db
        .delete(reports)
        .where(eq(reports.type, report.type))
        .returning({ id: reports.id });
      purged = deleted.length;
    }

    await db.insert(reports).values({
      type: report.type,
      title: report.title,
      body: report.body,
      marketDataTimestamp: report.marketDataTimestamp
        ? new Date(report.marketDataTimestamp)
        : null,
      freshness: report.freshness,
    });

    return {
      purged,
      keptPolicy:
        purged > 0
          ? `Đã xóa ${purged} bản ${report.type} cũ (giới hạn ${MAX_REPORTS_PER_TYPE}) · giữ bản mới`
          : `Lưu ${report.type} · tối đa ${MAX_REPORTS_PER_TYPE} bản/loại`,
    };
  } catch {
    return { purged: 0, keptPolicy: "persist skipped (DB unavailable)" };
  }
}

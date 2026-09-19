import "server-only";
import { eq, and } from "drizzle-orm";
import { databaseConfigured, db } from "../../db";
import { financialStatements } from "../../db/schema";
import type { FinancialPackage, NormalizedPeriod } from "./types";

/**
 * Best-effort persist of normalized BCTC periods into `financial_statements`.
 * Never throws to the request path — fire-and-forget from bulk/snapshot layers.
 */

function periodKey(p: NormalizedPeriod): { year: number; quarter: number | null; reportType: string } {
  const year = p.year ?? (p.period.match(/(\d{4})/) ? Number(p.period.match(/(\d{4})/)![1]) : new Date().getFullYear());
  const quarter =
    p.periodType === "year" || p.periodType === "ttm"
      ? null
      : p.quarter ?? (p.period.match(/Q([1-4])/i) ? Number(p.period.match(/Q([1-4])/i)![1]) : null);
  // Store one row per statement family for the period
  return { year, quarter, reportType: p.periodType === "ttm" ? "ttm" : p.periodType === "year" ? "annual" : "quarter" };
}

export async function persistFinancialPackage(pkg: FinancialPackage): Promise<{ written: number }> {
  if (!databaseConfigured()) return { written: 0 };
  const sym = pkg.symbol.toUpperCase();
  let written = 0;

  try {
    const periods = (pkg.periods ?? []).filter((p) => p.periodType !== "ttm" && Object.keys(p.metrics ?? {}).length > 0);
    for (const p of periods.slice(0, 16)) {
      const { year, quarter, reportType } = periodKey(p);
      const metrics = {
        ...p.metrics,
        period: p.period,
        periodType: p.periodType,
        fiscalDate: p.fiscalDate,
        statementScope: p.statementScope,
        auditStatus: p.auditStatus,
        confidence: p.confidence,
      };

      // Upsert-like: delete matching then insert (simple, no unique constraint beyond id)
      const existing = await db
        .select({ id: financialStatements.id })
        .from(financialStatements)
        .where(
          and(
            eq(financialStatements.symbol, sym),
            eq(financialStatements.periodYear, year),
            eq(financialStatements.reportType, reportType),
            quarter == null
              ? eq(financialStatements.periodQuarter, null as unknown as number)
              : eq(financialStatements.periodQuarter, quarter),
          ),
        )
        .limit(1)
        .catch(() => []);

      if (existing.length) {
        await db
          .update(financialStatements)
          .set({
            metrics,
            source: p.source || pkg.meta.primarySource,
            sourceTimestamp: p.fiscalDate ? new Date(p.fiscalDate) : null,
            ingestedAt: new Date(),
          })
          .where(eq(financialStatements.id, existing[0]!.id))
          .catch(() => undefined);
      } else {
        await db
          .insert(financialStatements)
          .values({
            symbol: sym,
            periodYear: year,
            periodQuarter: quarter,
            reportType,
            metrics,
            source: p.source || pkg.meta.primarySource,
            sourceTimestamp: p.fiscalDate ? new Date(p.fiscalDate) : null,
          })
          .catch(() => undefined);
      }
      written += 1;
    }
  } catch {
    return { written: 0 };
  }

  return { written };
}

/** Fire-and-forget wrapper — safe to call without await on hot paths. */
export function persistFinancialPackageAsync(pkg: FinancialPackage): void {
  void persistFinancialPackage(pkg).catch(() => undefined);
}

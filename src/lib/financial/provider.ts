import "server-only";
import { logSourceAttempt, logSourceResult } from "./monitor";
import type { FinancialSourceMeta, NormalizedPeriod, SourceRole } from "./types";

/**
 * Financial Provider Interface — Source Priority Engine.
 *
 * Providers are tried in ascending priority (1 = highest).
 * VNDIRECT DStock is PRIMARY for financial statements.
 * SSI is not part of this router (Market Data domain only).
 */

export interface FinancialProviderResult {
  periods: NormalizedPeriod[];
  latencyMs: number;
  sourceId: string;
  role: SourceRole;
  priority: number;
  note?: string;
}

export interface FinancialProvider {
  id: string;
  role: SourceRole;
  /** Lower number = tried first */
  priority: number;
  enabled: () => boolean;
  fetch: (symbol: string, opts?: { limitPeriods?: number }) => Promise<FinancialProviderResult | null>;
}

export type RouterOutcome = {
  periods: NormalizedPeriod[];
  sourceId: string;
  role: SourceRole;
  priority: number;
  sourcesAttempted: FinancialSourceMeta[];
  /** 0 = primary hit; 1+ = fell through to lower priority / cache semantics */
  fallbackLevel: 0 | 1 | 2 | 3 | 4;
  note: string | null;
};

export async function runSourceRouter(
  symbol: string,
  providers: FinancialProvider[],
  opts?: { limitPeriods?: number },
): Promise<RouterOutcome | null> {
  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  const sourcesAttempted: FinancialSourceMeta[] = [];
  let attemptIndex = 0;

  for (const p of ordered) {
    if (!p.enabled()) {
      sourcesAttempted.push({
        id: p.id,
        role: p.role,
        priority: p.priority,
        success: false,
        note: "not_configured",
      });
      continue;
    }
    attemptIndex += 1;
    logSourceAttempt(p.id, symbol);
    try {
      const r = await p.fetch(symbol, opts);
      if (r && r.periods.length) {
        logSourceResult(p.id, true, { ticker: symbol, latencyMs: r.latencyMs, message: r.note });
        sourcesAttempted.push({
          id: p.id,
          role: p.role,
          priority: p.priority,
          success: true,
          latencyMs: r.latencyMs,
          note: r.note,
        });
        const fallbackLevel = (attemptIndex <= 1 ? 0 : Math.min(4, attemptIndex - 1)) as
          | 0
          | 1
          | 2
          | 3
          | 4;
        return {
          periods: r.periods,
          sourceId: r.sourceId,
          role: r.role,
          priority: r.priority,
          sourcesAttempted,
          fallbackLevel,
          note:
            r.note ??
            (fallbackLevel === 0
              ? `Nguồn chính: ${r.sourceId}`
              : `Fallback level ${fallbackLevel} → ${r.sourceId}`),
        };
      }
      logSourceResult(p.id, false, { ticker: symbol, message: "empty" });
      sourcesAttempted.push({
        id: p.id,
        role: p.role,
        priority: p.priority,
        success: false,
        note: "empty",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 120) : "error";
      logSourceResult(p.id, false, { ticker: symbol, message: msg });
      sourcesAttempted.push({
        id: p.id,
        role: p.role,
        priority: p.priority,
        success: false,
        note: msg,
      });
    }
  }

  return null;
}

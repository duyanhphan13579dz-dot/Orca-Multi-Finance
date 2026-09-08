import "server-only";
import type { FinancialSourceMeta, NormalizedPeriod, SourceRole } from "./types";

/**
 * Financial Provider Interface — Phase 1 Source Priority Engine.
 * Providers are tried in ascending priority (1 = highest).
 * SSI Flashconnect will register as priority 1 when configured;
 * VNDirect is temporary primary (priority 2).
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
    try {
      const r = await p.fetch(symbol, opts);
      if (r && r.periods.length) {
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
      sourcesAttempted.push({
        id: p.id,
        role: p.role,
        priority: p.priority,
        success: false,
        note: "empty",
      });
    } catch (e) {
      sourcesAttempted.push({
        id: p.id,
        role: p.role,
        priority: p.priority,
        success: false,
        note: e instanceof Error ? e.message.slice(0, 120) : "error",
      });
    }
  }

  return null;
}

import "server-only";
import { logSourceAttempt, logSourceResult } from "./monitor";
import type { FinancialSourceMeta, NormalizedPeriod, SourceRole } from "./types";

/**
 * Financial Provider Interface — Source Priority Engine.
 *
 * Providers chạy song song (public-first), kết quả chọn theo priority thấp hơn
 * (1 = highest) khi có periods. VNDIRECT DStock = PRIMARY (không API key).
 * SSI không nằm trong router này (chỉ market data).
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
  /** Lower number = tried first / preferred */
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

/**
 * Parallel multi-source router:
 *  - Fire all enabled providers concurrently (budget ~12s each)
 *  - Prefer lowest priority number among successful results
 *  - Record every attempt for provenance / health UI
 */
export async function runSourceRouter(
  symbol: string,
  providers: FinancialProvider[],
  opts?: { limitPeriods?: number },
): Promise<RouterOutcome | null> {
  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  const sourcesAttempted: FinancialSourceMeta[] = [];

  const enabled = ordered.filter((p) => {
    if (p.enabled()) return true;
    sourcesAttempted.push({
      id: p.id,
      role: p.role,
      priority: p.priority,
      success: false,
      note: "not_configured",
    });
    return false;
  });

  if (!enabled.length) return null;

  type Hit = {
    provider: FinancialProvider;
    result: FinancialProviderResult;
  };

  const hits: Hit[] = [];

  await Promise.all(
    enabled.map(async (p) => {
      logSourceAttempt(p.id, symbol);
      const t0 = performance.now();
      try {
        const r = await Promise.race([
          p.fetch(symbol, opts),
          new Promise<null>((res) => setTimeout(() => res(null), 12_000)),
        ]);
        const latencyMs = Math.round(performance.now() - t0);
        if (r && r.periods.length) {
          logSourceResult(p.id, true, {
            ticker: symbol,
            latencyMs: r.latencyMs ?? latencyMs,
            message: r.note,
          });
          sourcesAttempted.push({
            id: p.id,
            role: p.role,
            priority: p.priority,
            success: true,
            latencyMs: r.latencyMs ?? latencyMs,
            note: r.note,
          });
          hits.push({ provider: p, result: r });
        } else {
          logSourceResult(p.id, false, { ticker: symbol, message: "empty" });
          sourcesAttempted.push({
            id: p.id,
            role: p.role,
            priority: p.priority,
            success: false,
            latencyMs,
            note: "empty",
          });
        }
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
    }),
  );

  if (!hits.length) return null;

  hits.sort((a, b) => a.provider.priority - b.provider.priority);
  const best = hits[0]!;
  const rank = ordered.findIndex((p) => p.id === best.provider.id);
  const fallbackLevel = (rank <= 0 ? 0 : Math.min(4, rank)) as 0 | 1 | 2 | 3 | 4;

  return {
    periods: best.result.periods,
    sourceId: best.result.sourceId,
    role: best.result.role,
    priority: best.result.priority,
    sourcesAttempted,
    fallbackLevel,
    note:
      best.result.note ??
      (fallbackLevel === 0
        ? `Nguồn chính: ${best.result.sourceId}`
        : `Fallback level ${fallbackLevel} → ${best.result.sourceId}`),
  };
}

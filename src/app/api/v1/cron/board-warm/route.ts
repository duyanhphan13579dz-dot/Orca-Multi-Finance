import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard } from "@/lib/services/stocks";
import { cronUnauthorized } from "@/lib/cron-auth";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { runGuarded, guardMeta } from "@/lib/data-engine/workers-guard";
import { putHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** Light board pre-warm — also writes hot last-good. */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();

  try {
    const market = await runGuarded(
      async () => getVnMarketBoard().catch(() => null),
      {
        label: "cron-board-warm",
        wallMs: Math.min(12_000, WORKERS_BUDGET.boardWallMs),
        maxSubrequests: 18,
        maxConcurrent: 2,
      },
    );

    const gm = guardMeta();
    if (!market || (!market.quotes.length && !market.indices.length)) {
      return unavailable("vn-board-warm", "Board warm failed — last-good may still serve UI");
    }

    putHot(
      "board",
      {
        indices: market.indices,
        quotes: market.quotes,
        universeSize: market.universeSize ?? market.quotes.length,
        sessionDate: market.sessionDate ?? null,
        count: market.quotes.length,
      },
      { source: market.meta.source, partial: market.meta.partial, note: market.meta.note },
    );

    return ok(
      {
        ok: true,
        quotes: market.quotes.length,
        indices: market.indices.length,
        universe: market.universeSize ?? market.quotes.length,
        sessionDate: market.sessionDate ?? null,
        source: market.meta.source,
        cached: market.meta.cached ?? false,
        stale: market.meta.stale ?? false,
        durationMs: Date.now() - t0,
        guard: gm,
      },
      {
        source: market.meta.source,
        cached: market.meta.cached,
        stale: market.meta.stale,
        note: market.meta.note,
      },
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return unavailable(
      "vn-board-warm",
      e instanceof Error ? e.message : "board warm error",
    );
  }
}

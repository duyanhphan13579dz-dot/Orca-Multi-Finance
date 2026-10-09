import { getVnMarketBoard, getVnQuotes } from "@/lib/services/stocks";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { getVnSession } from "@/lib/vn/sessions";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { putHot, getHot } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

export async function GET(req: Request) {
  try {
    ensureHeartbeatStarted();
    ensureSessionPollerStarted();
  } catch {
    /* */
  }

  const url = new URL(req.url);
  const symbolsParam = (url.searchParams.get("symbols") ?? "").trim();
  const board = (url.searchParams.get("board") ?? "").toLowerCase();
  const wantFull =
    board === "full" ||
    symbolsParam === "" ||
    symbolsParam.toLowerCase() === "all" ||
    symbolsParam === "*";

  const session = getVnSession();

  if (wantFull) {
    return safeApi({
      label: "vn-board",
      guard: {
        wallMs: WORKERS_BUDGET.boardWallMs,
        maxSubrequests: 22,
        maxConcurrent: 2,
      },
      produce: async () => {
        const fresh = await getHot<{
          indices: unknown[];
          quotes: unknown[];
          universeSize?: number;
          sessionDate?: string | null;
          count?: number;
        }>("board");
        if (fresh?.fresh && ((fresh.data.quotes?.length ?? 0) > 0 || (fresh.data.indices?.length ?? 0) > 0)) {
          return {
            data: { ...fresh.data, session },
            meta: {
              ...fresh.meta,
              note: `hot-fresh board · ${Math.round(fresh.ageMs / 1000)}s`,
            },
            headers: {
              "Cache-Control": "private, max-age=8, stale-while-revalidate=40",
              "X-Orca-Hot": "fresh",
            },
          };
        }

        const market = await getVnMarketBoard();
        if (!market || (!market.indices.length && !market.quotes.length)) return null;
        const data = {
          indices: market.indices,
          quotes: market.quotes,
          universeSize: market.universeSize ?? market.quotes.length,
          sessionDate: market.sessionDate ?? null,
          session,
          count: market.quotes.length,
        };
        putHot("board", data, {
          source: market.meta.source,
          partial: market.meta.partial,
          note: market.meta.note,
        });
        return {
          data,
          meta: {
            source: market.meta.source,
            sourceTimestamp: market.meta.sourceTimestamp,
            cached: market.meta.cached,
            stale: market.meta.stale,
            partial: market.meta.partial,
            note: market.meta.note,
          },
          headers: {
            "Cache-Control": market.meta.stale
              ? "private, max-age=8, stale-while-revalidate=60"
              : "private, max-age=10, stale-while-revalidate=40",
          },
        };
      },
      fallback: async () => {
        const snap = await getHot<{
          indices: unknown[];
          quotes: unknown[];
          universeSize?: number;
          sessionDate?: string | null;
          count?: number;
        }>("board");
        if (snap?.data && ((snap.data.quotes?.length ?? 0) > 0 || (snap.data.indices?.length ?? 0) > 0)) {
          return {
            data: { ...snap.data, session },
            meta: {
              ...snap.meta,
              note: `last-good board · age ${Math.round(snap.ageMs / 1000)}s`,
              partial: true,
              stale: true,
            },
          };
        }
        return {
          data: {
            indices: [],
            quotes: [],
            universeSize: 0,
            sessionDate: null,
            session,
            count: 0,
          },
          meta: {
            source: "board-shell",
            partial: true,
            stale: true,
            note: "shell — cron hot-warm sẽ đổ đầy",
          },
        };
      },
      unavailableSource: "vn-board",
      unavailableNote: "VN board tạm không khả dụng",
    });
  }

  const symbols = symbolsParam
    ? symbolsParam.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
    : LIQUID_BOARD.slice(0, 40);

  return safeApi({
    label: "vn-quotes",
    guard: {
      wallMs: Math.min(10_000, WORKERS_BUDGET.boardWallMs),
      maxSubrequests: 16,
      maxConcurrent: 2,
    },
    produce: async () => {
      const pack = await getVnQuotes(symbols);
      if (!pack?.quotes?.length) return null;
      return {
        data: {
          indices: null,
          quotes: pack.quotes,
          count: pack.quotes.length,
          session,
        },
        meta: pack.meta,
        headers: {
          "Cache-Control": "private, max-age=8, stale-while-revalidate=30",
        },
      };
    },
    fallback: async () => ({
      data: { indices: null, quotes: [], count: 0, session },
      meta: { source: "quotes-shell", partial: true, stale: true, note: "shell" },
    }),
    unavailableSource: "vn-quotes",
    unavailableNote: "Quotes tạm không khả dụng",
  });
}

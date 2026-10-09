import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard, getVnQuotes } from "@/lib/services/stocks";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { getVnSession } from "@/lib/vn/sessions";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/v1/stocks
 * Anti-break: runGuarded + last-good fallback + isolate cooldown.
 */
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
        const market = await getVnMarketBoard();
        if (!market || (!market.indices.length && !market.quotes.length)) return null;
        return {
          data: {
            indices: market.indices,
            quotes: market.quotes,
            universeSize: market.universeSize ?? market.quotes.length,
            sessionDate: market.sessionDate ?? null,
            session,
            count: market.quotes.length,
          },
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
            source: "empty-shell",
            partial: true,
            stale: true,
            note: "Board tạm trống — đang kết nối lại",
          },
        };
      },
      unavailableSource: "vn-market",
      unavailableNote: "Chưa kéo được thị trường VN — đang thử lại.",
    });
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);

  return safeApi({
    label: "vn-quotes",
    guard: { wallMs: 10_000, maxSubrequests: 18, maxConcurrent: 2 },
    produce: async () => {
      const quotes = await getVnQuotes(symbols);
      if (!quotes?.quotes?.length) return null;
      return {
        data: {
          indices: null,
          quotes: quotes.quotes,
          session,
          count: quotes.quotes.length,
        },
        meta: {
          source: quotes.meta?.source ?? "vndirect",
          cached: quotes.meta?.cached,
          stale: quotes.meta?.stale,
          partial: true,
        },
      };
    },
    fallback: async () => ({
      data: { indices: null, quotes: [], session, count: 0 },
      meta: { source: "empty-shell", partial: true, stale: true, note: "Quotes tạm trống" },
    }),
    unavailableSource: "vn-stocks",
    unavailableNote: "Bảng giá VN không khả dụng.",
  });
}

import { ok, unavailable } from "@/lib/envelope";
import { getVnIndices, getVnMarketBoard, getVnQuotes } from "@/lib/services/stocks";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { getVnSession } from "@/lib/vn/sessions";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * GET /api/v1/stocks
 * Workers-safe: prefer cached board; light fallthrough only.
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
    try {
      const market = await getVnMarketBoard();
      if (market && (market.indices.length || market.quotes.length)) {
        return ok(
          {
            indices: market.indices,
            quotes: market.quotes,
            universeSize: market.universeSize ?? market.quotes.length,
            sessionDate: market.sessionDate ?? null,
            session,
            count: market.quotes.length,
          },
          {
            source: market.meta.source,
            sourceTimestampMs: market.meta.sourceTimestamp
              ? Date.parse(market.meta.sourceTimestamp)
              : Date.now(),
            cached: market.meta.cached,
            stale: market.meta.stale,
            partial: market.meta.partial,
            note: market.meta.note,
          },
          {
            "Cache-Control": market.meta.stale
              ? "private, max-age=8, stale-while-revalidate=60"
              : "private, max-age=10, stale-while-revalidate=40",
          },
        );
      }
    } catch {
      /* fall through */
    }

    // Light fallthrough — avoid racing heavy index multi-source + 40 quotes
    const q = await getVnQuotes(LIQUID_BOARD.slice(0, 25)).catch(() => null);
    const quotes = q?.quotes ?? [];
    if (!quotes.length) {
      return unavailable(
        "vn-market",
        "Chưa kéo được thị trường VN từ nguồn công khai — đang thử lại.",
      );
    }
    return ok(
      {
        indices: [],
        quotes,
        universeSize: quotes.length || LIQUID_BOARD.length,
        sessionDate: null,
        session,
        count: quotes.length,
      },
      {
        source: q?.meta.source || "vn-partial",
        sourceTimestampMs: Date.now(),
        partial: true,
        degraded: true,
        note: "Partial board — liquid quotes only",
      },
      { "Cache-Control": "private, max-age=5, stale-while-revalidate=20" },
    );
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);

  const quotes = await getVnQuotes(symbols).catch(() => null);
  if (!quotes?.quotes?.length) {
    return unavailable("vn-stocks", "Bảng giá VN không khả dụng.");
  }
  const meta = quotes.meta;
  return ok(
    {
      indices: null,
      quotes: quotes.quotes,
      session,
      count: quotes.quotes.length,
    },
    {
      source: meta?.source ?? "vndirect",
      sourceTimestampMs: meta?.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : Date.now(),
      cached: meta?.cached,
      stale: meta?.stale,
      partial: true,
      note: "Quotes only (indices skipped to stay under Workers budget)",
    },
  );
}

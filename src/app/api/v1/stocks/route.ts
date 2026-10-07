import { ok, unavailable } from "@/lib/envelope";
import { getVnIndices, getVnMarketBoard, getVnQuotes } from "@/lib/services/stocks";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { getVnSession } from "@/lib/vn/sessions";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/stocks
 * Hardened: luôn cố trả partial board thay vì 502 khi một nhánh lỗi.
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
              ? "private, max-age=5, stale-while-revalidate=30"
              : "private, max-age=8, stale-while-revalidate=25",
          },
        );
      }
    } catch {
      /* fall through */
    }

    const [idx, q] = await Promise.all([
      getVnIndices().catch(() => null),
      getVnQuotes(LIQUID_BOARD.slice(0, 40)).catch(() => null),
    ]);
    const indices = idx?.items ?? [];
    const quotes = q?.quotes ?? [];
    if (!indices.length && !quotes.length) {
      return unavailable(
        "vn-market",
        "Chưa kéo được thị trường VN từ nguồn công khai — đang thử lại.",
      );
    }
    return ok(
      {
        indices,
        quotes,
        universeSize: quotes.length || LIQUID_BOARD.length,
        sessionDate: null,
        session,
        count: quotes.length,
      },
      {
        source: [idx?.meta.source, q?.meta.source].filter(Boolean).join("+") || "vn-partial",
        sourceTimestampMs: Date.now(),
        partial: true,
        degraded: true,
        note: "Partial board — một phần nguồn public",
      },
      { "Cache-Control": "private, max-age=5, stale-while-revalidate=20" },
    );
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 80);

  const [indices, quotes] = await Promise.all([
    getVnIndices().catch(() => null),
    getVnQuotes(symbols).catch(() => null),
  ]);
  if (!indices?.items?.length && !quotes?.quotes?.length) {
    return unavailable("vn-stocks", "Chỉ số và bảng giá VN không khả dụng.");
  }
  const meta = quotes?.meta ?? indices?.meta;
  return ok(
    {
      indices: indices?.items ?? null,
      quotes: quotes?.quotes ?? null,
      session,
      count: quotes?.quotes?.length ?? 0,
    },
    {
      source: meta?.source ?? "vndirect",
      sourceTimestampMs: meta?.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : Date.now(),
      cached: meta?.cached,
      stale: meta?.stale,
      degraded: !indices?.items?.length || !quotes?.quotes?.length,
      partial: !indices?.items?.length || !quotes?.quotes?.length,
      note: !indices?.items?.length
        ? "Indices không khả dụng"
        : !quotes?.quotes?.length
          ? "Quotes không khả dụng"
          : undefined,
    },
  );
}

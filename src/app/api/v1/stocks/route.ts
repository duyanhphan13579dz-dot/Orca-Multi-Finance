import { ok, unavailable } from "@/lib/envelope";
import { getVnIndices, getVnMarketBoard, getVnQuotes } from "@/lib/services/stocks";
import { getVnSession } from "@/lib/vn/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // Vercel: REST board SSI (100 securitiesSummary) cần ~2-5s

/**
 * GET /api/v1/stocks
 *  - ?board=full | ?symbols=all  → toàn bộ bảng giá phiên gần nhất + chỉ số + universe
 *  - ?symbols=VCB,FPT           → quotes theo danh sách + indices
 *  - (no params)                 → full market board
 */
export async function GET(req: Request) {
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
    const market = await getVnMarketBoard();
    if (!market) {
      return unavailable(
        "vn-market",
        "Chưa kéo được toàn bộ thị trường VN — VNDirect/VNStock tạm không phản hồi.",
      );
    }
    return ok(
      {
        indices: market.indices,
        quotes: market.quotes,
        universe: market.universe,
        sessionDate: market.sessionDate,
        session,
        count: market.quotes.length,
      },
      {
        source: market.meta.source,
        sourceTimestampMs: market.meta.sourceTimestamp ? Date.parse(market.meta.sourceTimestamp) : null,
        cached: market.meta.cached,
        stale: market.meta.stale,
        note: market.meta.note,
      },
    );
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 80);

  const [indices, quotes] = await Promise.all([getVnIndices(), getVnQuotes(symbols)]);
  if (!indices && !quotes) {
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
      source: meta?.source ?? "vnstock|vndirect",
      sourceTimestampMs: meta?.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : null,
      cached: meta?.cached,
      stale: meta?.stale,
      degraded: !indices || !quotes,
      partial: !indices || !quotes,
      note: !indices ? "Indices không khả dụng" : !quotes ? "Quotes không khả dụng" : undefined,
    },
  );
}

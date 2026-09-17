import { ok, badRequest, fail } from "@/lib/envelope";
import {
  analyzeJournalPortfolio,
  type JournalTradeInput,
} from "@/lib/services/journal-analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * POST /api/v1/journal/analyze
 * Body: { trades: JournalTradeInput[] }
 * Đánh giá danh mục từ nhật ký lệnh (stats + LLM nếu có key).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { trades?: JournalTradeInput[] } | null;
    const trades = Array.isArray(body?.trades) ? body!.trades : null;
    if (!trades || trades.length === 0) {
      return badRequest("Cần ít nhất 1 lệnh trong trades[]");
    }
    if (trades.length > 300) return badRequest("Tối đa 300 lệnh mỗi lần phân tích");

    const cleaned: JournalTradeInput[] = trades.map((t) => ({
      assetType: String(t.assetType ?? "stock").slice(0, 20),
      symbol: String(t.symbol ?? "").toUpperCase().slice(0, 20),
      side: t.side === "short" ? "short" : "long",
      entry: Number(t.entry),
      exit: t.exit != null && t.exit !== "" ? Number(t.exit) : null,
      stopLoss: t.stopLoss != null && t.stopLoss !== "" ? Number(t.stopLoss) : null,
      takeProfit: t.takeProfit != null && t.takeProfit !== "" ? Number(t.takeProfit) : null,
      size: t.size != null && t.size !== "" ? Number(t.size) : null,
      leverage: t.leverage != null && t.leverage !== "" ? Number(t.leverage) : null,
      strategy: String(t.strategy ?? "").slice(0, 80),
      emotion: String(t.emotion ?? "").slice(0, 40),
      notes: String(t.notes ?? "").slice(0, 200),
      openedAt: typeof t.openedAt === "number" ? t.openedAt : undefined,
      closedAt: typeof t.closedAt === "number" ? t.closedAt : null,
    }));

    const { result, meta } = await analyzeJournalPortfolio(cleaned);
    return ok(result, meta);
  } catch (e) {
    console.error("[journal-analyze]", e);
    return fail("JOURNAL_ANALYZE_FAILED", e instanceof Error ? e.message : "failed", 500);
  }
}

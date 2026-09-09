import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getNewsSentiment } from "@/lib/services/news-sentiment";
import type { NewsArticle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES = new Set(["market", "corporate", "macro", "crypto", "forex", "commodities", "general"]);

/**
 * GET /api/v1/news/sentiment?category=market&symbol=HPG&limit=40&llm=1
 * Lexicon scoring on RSS titles/summaries + optional LLM synthesis.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const symbol = url.searchParams.get("symbol") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 80);
  const llmParam = url.searchParams.get("llm");
  const withLlm = llmParam == null ? true : llmParam === "1" || llmParam === "true";

  if (category && !CATEGORIES.has(category)) return badRequest("Category không hợp lệ");

  const r = await getNewsSentiment({
    category: (category as NewsArticle["category"] | null) ?? undefined,
    symbol,
    limit,
    withLlm,
  });
  if (!r) return unavailable("news-sentiment", "Không tổng hợp được sentiment tin tức — kiểm tra nguồn RSS /system.");
  return ok(r.data, r.meta);
}

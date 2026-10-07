import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getNews } from "@/lib/services/news";
import type { NewsArticle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES = new Set(["market", "corporate", "macro", "crypto", "forex", "commodities", "general"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const symbol = url.searchParams.get("symbol") ?? undefined;
  const sector = url.searchParams.get("sector") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 30) || 30, 80);
  if (category && !CATEGORIES.has(category)) return badRequest("Category không hợp lệ");
  const r = await getNews({
    category: (category as NewsArticle["category"] | null) ?? undefined,
    symbol,
    sector,
    limit,
  });
  if (!r) return unavailable("rss-news", "Tất cả nguồn tin đều không phản hồi — xem /system.");
  return ok({ articles: r.articles, errors: r.errors }, r.meta);
}

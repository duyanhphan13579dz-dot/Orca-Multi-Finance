import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { aggregateNews } from "../providers/news";
import type { Meta, NewsArticle } from "../types";

/**
 * News domain service — aggregates real RSS feeds, deduplicates, validates
 * timestamps (no stale article is ever presented as fresh), and tags symbols.
 */

export async function getNews(args: {
  category?: NewsArticle["category"];
  symbol?: string;
  sector?: string;
  limit?: number;
}): Promise<{ articles: NewsArticle[]; errors: string[]; meta: Meta } | null> {
  try {
    const res = await cached("news:aggregate", {
      ttlMs: 2 * 60_000,
      staleMs: 45 * 60_000,
      producer: aggregateNews,
    });
    let articles = res.value.articles;
    if (args.category) articles = articles.filter((a) => a.category === args.category);
    if (args.symbol) {
      const sym = args.symbol.toUpperCase();
      articles = articles.filter((a) => a.relatedSymbols.includes(sym) || a.relatedSymbols.some((s) => s.startsWith(sym)));
    }
    if (args.sector) articles = articles.filter((a) => a.relatedSector === args.sector);
    const limited = articles.slice(0, args.limit ?? 30);
    const latest = limited.length ? Math.max(...limited.map((a) => Date.parse(a.publishedAt))) : null;
    const meta = buildMeta({
      source: "RSS multi-feed (CafeF, VnExpress, VietnamBiz, CoinTelegraph)",
      sourceTimestampMs: latest,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.errors.length > 0,
      partial: res.value.errors.length > 0,
      note: res.value.errors.length ? `${res.value.errors.length}/${9} nguồn tin tạm lỗi — hiển thị phần còn lại` : undefined,
      slas: { liveSlaMs: 10 * 60_000, freshSlaMs: 3_600_000, delayedSlaMs: 6 * 3_600_000 },
    });
    void persist(limited);
    return { articles: limited, errors: res.value.errors, meta };
  } catch {
    return null;
  }
}

async function persist(articles: NewsArticle[]) {
  try {
    const { db } = await import("@/db");
    const { newsArticles } = await import("@/db/schema");
    for (const a of articles.slice(0, 30)) {
      await db
        .insert(newsArticles)
        .values({
          url: a.url,
          title: a.title,
          summary: a.summary,
          source: a.source,
          category: a.category,
          publishedAt: new Date(a.publishedAt),
          relatedSymbols: a.relatedSymbols,
          relatedSector: a.relatedSector,
        })
        .onConflictDoNothing({ target: newsArticles.url });
    }
  } catch {
    /* best-effort */
  }
}

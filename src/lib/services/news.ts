import "server-only";
import { cached, peekStale } from "../cache";
import { buildMeta } from "../freshness";
import { aggregateNews, FEEDS } from "../providers/news";
import type { Meta, NewsArticle } from "../types";

/**
 * News domain service — aggregates real RSS feeds, deduplicates, validates
 * timestamps (no stale article is ever presented as fresh), and tags symbols.
 *
 * Soft category filters never hard-drop the entire set: if keyword expansion
 * yields zero matches we keep the unfiltered pool so the UI never goes blank.
 */

const MACRO_SOFT_RE =
  /fed|ecb|boj|lạm phát|cpi|gdp|tỷ giá|lãi suất|nhnn|policy|vĩ mô|macro|inflation|interest rate|dollar|usd\/vnd|tín dụng|room ngoại|fomc|qt\s*e|qt\s*t|bảng cân đối|dự trữ ngoại hối|xuất nhập khẩu|cán cân thương mại/;

const MARKET_SOFT_RE =
  /vn-?index|hose|hnx|upcom|thanh khoản|khối ngoại|tự doanh|etf|bluechip|midcap|penny|độ rộng|breadth|gtgd|phiên giao dịch/;

const CORPORATE_SOFT_RE =
  /bctc|báo cáo tài chính|kết quả kinh doanh|cổ tức|phát hành|mua lại cổ phiếu|đại hội|đhđcđ|nội bộ|cổ đông lớn|sáp nhập|m&a/;

export async function getNews(args: {
  category?: NewsArticle["category"];
  symbol?: string;
  sector?: string;
  limit?: number;
}): Promise<{ articles: NewsArticle[]; errors: string[]; meta: Meta } | null> {
  try {
    const res = await cached("news:aggregate", {
      ttlMs: 90_000,
      staleMs: 2 * 60 * 60_000,
      producer: aggregateNews,
    });
    let articles = res.value.articles;

    if (args.category) {
      const cat = args.category;
      const filtered = articles.filter((a) => {
        if (a.category === cat) return true;
        const t = `${a.title} ${a.summary ?? ""}`.toLowerCase();
        if (cat === "macro") {
          return (
            (a.category === "general" || a.category === "market") && MACRO_SOFT_RE.test(t)
          );
        }
        if (cat === "market") {
          return (
            a.category === "corporate" ||
            a.category === "general" ||
            MARKET_SOFT_RE.test(t)
          );
        }
        if (cat === "corporate") {
          return a.category === "general" && CORPORATE_SOFT_RE.test(t);
        }
        return false;
      });
      if (filtered.length > 0) articles = filtered;
    }

    if (args.symbol) {
      const sym = args.symbol.toUpperCase();
      const hit = articles.filter(
        (a) =>
          a.relatedSymbols.includes(sym) ||
          a.relatedSymbols.some((s) => s.startsWith(sym)) ||
          a.title.toUpperCase().includes(sym),
      );
      if (hit.length > 0) articles = hit;
    }

    if (args.sector) {
      const sec = args.sector;
      const hit = articles.filter(
        (a) => a.relatedSector === sec || (a.relatedSector ?? "").includes(sec),
      );
      if (hit.length > 0) articles = hit;
    }

    const limited = articles.slice(0, args.limit ?? 40);
    const latest = limited.length
      ? Math.max(...limited.map((a) => Date.parse(a.publishedAt)))
      : null;
    const feedCount = FEEDS.length;
    const meta = buildMeta({
      source: `RSS multi-feed (${feedCount} nguồn)`,
      sourceTimestampMs: latest,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.errors.length > 0,
      partial: res.value.errors.length > 0,
      note: res.value.errors.length
        ? `${res.value.errors.length}/${feedCount} nguồn tin tạm lỗi — hiển thị phần còn lại`
        : undefined,
      slas: {
        liveSlaMs: 10 * 60_000,
        freshSlaMs: 3_600_000,
        delayedSlaMs: 6 * 3_600_000,
      },
    });
    void persist(limited);
    return { articles: limited, errors: res.value.errors, meta };
  } catch {
    const stale = peekStale<{ articles: NewsArticle[]; errors: string[] }>("news:aggregate");
    if (stale?.value?.articles?.length) {
      const limited = stale.value.articles.slice(0, args.limit ?? 40);
      const latest = limited.length
        ? Math.max(...limited.map((a) => Date.parse(a.publishedAt)))
        : null;
      return {
        articles: limited,
        errors: stale.value.errors ?? [],
        meta: buildMeta({
          source: `RSS multi-feed (stale cache)`,
          sourceTimestampMs: latest,
          cached: true,
          stale: true,
          degraded: true,
          partial: true,
          note: "Nguồn tin đang lỗi — đang hiển thị bản cache gần nhất",
          slas: {
            liveSlaMs: 10 * 60_000,
            freshSlaMs: 3_600_000,
            delayedSlaMs: 6 * 3_600_000,
          },
        }),
      };
    }
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

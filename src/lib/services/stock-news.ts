import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { dstockNewsUrl, getVndCompanyNews } from "../providers/vndirect-news";
import { getNews } from "./news";
import type { Meta, NewsArticle } from "../types";

const TTL_MS = 5 * 60_000;
const STALE_MS = 6 * 60 * 60_000;

export interface StockNewsResult {
  symbol: string;
  articles: NewsArticle[];
  sources: string[];
  sourceUrl: string;
  errors: string[];
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function byTimeDesc(a: NewsArticle, b: NewsArticle): number {
  return (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0);
}

/**
 * Tin theo mã: VNDirect DStock (company_news) là nguồn chính, chạy SONG SONG với tin RSS đã gắn mã
 * (CafeF/VietnamBiz/…) làm bổ sung và dự phòng. Một nguồn lỗi không làm hỏng nguồn còn lại.
 */
async function loadStockNews(sym: string, limit: number): Promise<StockNewsResult> {
  const errors: string[] = [];
  const [vnd, rss] = await Promise.allSettled([
    getVndCompanyNews(sym, Math.max(limit, 20)),
    Promise.race([
      getNews({ symbol: sym, limit: 40 }),
      new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
    ]),
  ]);
  const merged: NewsArticle[] = [];
  const sources: string[] = [];
  if (vnd.status === "fulfilled" && vnd.value.length) {
    merged.push(...vnd.value);
    sources.push("VNDirect DStock");
  } else {
    errors.push(`vndirect-news: ${vnd.status === "rejected" ? (vnd.reason instanceof Error ? vnd.reason.message : "failed") : "empty"}`);
  }
  if (rss.status === "fulfilled" && rss.value?.articles.length) {
    merged.push(...rss.value.articles);
    sources.push("RSS (CafeF/VietnamBiz/…)");
  } else if (rss.status === "rejected") {
    errors.push("rss-news: failed");
  }
  if (!merged.length) throw new Error(`Không có nguồn tin nào cho ${sym}: ${errors.join("; ")}`);

  const seen = new Set<string>();
  const articles = merged
    .sort(byTimeDesc)
    .filter((a) => {
      const k = norm(a.title).slice(0, 90);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, Math.max(1, limit));
  return { symbol: sym, articles, sources, sourceUrl: dstockNewsUrl(sym), errors };
}

export async function getStockNews(
  symbol: string,
  limit = 20,
): Promise<{ data: StockNewsResult; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const lim = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const res = await cached(`stock-news:${sym}:${lim}:v1`, { ttlMs: TTL_MS, staleMs: STALE_MS, producer: () => loadStockNews(sym, lim) });
    const latest = res.value.articles.map((a) => Date.parse(a.publishedAt ?? "") || 0).reduce((m, t) => Math.max(m, t), 0);
    const meta = buildMeta({
      source: res.value.sources.join(" + ") || "news",
      sourceTimestampMs: latest || null,
      hasData: res.value.articles.length > 0,
      degraded: res.value.errors.length > 0,
      cached: res.cached,
      stale: res.stale,
      note: `Tin doanh nghiệp ${sym} — nguồn chính VNDirect DStock (tin-tuc-ma), bổ sung RSS.`,
      slas: { liveSlaMs: -1, freshSlaMs: TTL_MS, delayedSlaMs: STALE_MS },
    });
    return { data: res.value, meta };
  } catch {
    return null;
  }
}

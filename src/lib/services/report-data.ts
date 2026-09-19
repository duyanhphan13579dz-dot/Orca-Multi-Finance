import "server-only";
import type { NewsArticle } from "../types";
import type { MarketSnapshot } from "./market";
import type { CrossAssetItem } from "./cross-asset";

/**
 * Report data helpers — merge market snapshot + market intel so composers
 * always see the richest available news / cross-asset context without
 * each composer re-implementing dedupe logic.
 */

export function mergeNewsArticles(
  ...lists: Array<NewsArticle[] | null | undefined>
): NewsArticle[] {
  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const list of lists) {
    for (const a of list ?? []) {
      const key = String(a.url || a.id || a.title || "")
        .toLowerCase()
        .trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  out.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return tb - ta;
  });
  return out;
}

/** Prefer intel news (deeper fetch) then snapshot news. */
export function resolveReportNews(
  snap: { news?: NewsArticle[] | null } | null | undefined,
  intel: { news?: NewsArticle[] | null } | null | undefined,
  limit = 24,
): NewsArticle[] {
  return mergeNewsArticles(intel?.news, snap?.news).slice(0, limit);
}

export interface CrossHighlight {
  symbol: string;
  name: string;
  changePercent: number | null;
  group: string | null;
}

export function pickCrossHighlights(
  items: CrossAssetItem[] | null | undefined,
  limit = 8,
): CrossHighlight[] {
  if (!items?.length) return [];
  return [...items]
    .filter((x) => x.changePercent != null && Number.isFinite(x.changePercent))
    .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))
    .slice(0, limit)
    .map((x) => ({
      symbol: String(x.key),
      name: x.label,
      changePercent: x.changePercent ?? null,
      group: x.unit ?? null,
    }));
}

/** Overlay richer intel news onto a shallow copy of the market snapshot. */
export function enrichSnapshotForReports(
  snap: MarketSnapshot,
  intel: { news?: NewsArticle[] | null } | null | undefined,
): MarketSnapshot {
  const news = resolveReportNews(snap, intel, 30);
  return {
    ...snap,
    news: news.length ? news : snap.news,
  };
}

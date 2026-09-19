import "server-only";
import { createHash } from "crypto";
import { httpText } from "../http";
import type { NewsArticle } from "../types";
import { ProviderError } from "./binance";

/**
 * News aggregation engine — real RSS ingestion with timestamp validation,
 * deduplication, symbol/sector tagging. Cadence handled by the service cache.
 */

export interface FeedDef {
  name: string;
  url: string;
  category: NewsArticle["category"];
  lang: "vi" | "en";
}

export const FEEDS: FeedDef[] = [
  { name: "CafeF — Thị trường", url: "https://cafef.vn/thi-truong-chung-khoan.rss", category: "market", lang: "vi" },
  { name: "CafeF — Doanh nghiệp", url: "https://cafef.vn/doanh-nghiep.rss", category: "corporate", lang: "vi" },
  { name: "CafeF — Vĩ mô", url: "https://cafef.vn/vi-mo-dau-tu.rss", category: "macro", lang: "vi" },
  { name: "CafeF — Bất động sản", url: "https://cafef.vn/bat-dong-san.rss", category: "market", lang: "vi" },
  { name: "CafeF — Tài chính quốc tế", url: "https://cafef.vn/tai-chinh-quoc-te.rss", category: "macro", lang: "vi" },
  { name: "VnExpress — Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss", category: "market", lang: "vi" },
  { name: "VietnamBiz — Tài chính", url: "https://vietnambiz.vn/rss/tai-chinh.rss", category: "market", lang: "vi" },
  { name: "VietnamBiz — Chứng khoán", url: "https://vietnambiz.vn/rss/chung-khoan.rss", category: "market", lang: "vi" },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss", category: "crypto", lang: "en" },
  // Phase 0 — Google News RSS (public, no key) for VN + policy + Fed coverage
  {
    name: "Google News — VN-Index",
    url: "https://news.google.com/rss/search?q=VN-Index+OR+VNINDEX+OR+%22ch%E1%BB%A9ng+kho%C3%A1n%22&hl=vi&gl=VN&ceid=VN:vi",
    category: "market",
    lang: "vi",
  },
  {
    name: "Google News — NHNN",
    url: "https://news.google.com/rss/search?q=NHNN+OR+%22Ng%C3%A2n+h%C3%A0ng+Nh%C3%A0+n%C6%B0%E1%BB%9Bc%22+OR+SBV&hl=vi&gl=VN&ceid=VN:vi",
    category: "macro",
    lang: "vi",
  },
  {
    name: "Google News — Fed",
    url: "https://news.google.com/rss/search?q=Federal+Reserve+OR+Fed+interest+rate+OR+FOMC&hl=en&gl=US&ceid=US:en",
    category: "macro",
    lang: "en",
  },
];

export const NEWS_PROVIDER = "rss-news";

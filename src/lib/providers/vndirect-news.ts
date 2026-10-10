import "server-only";
import { createHash } from "crypto";
import { vndirectJson } from "../financial/vndirect-http";
import type { NewsArticle } from "../types";

const VND_NEWS = "vndirect-news";

export const dstockNewsUrl = (symbol: string) =>
  `https://dstock.vndirect.com.vn/tin-tuc-ma/${encodeURIComponent(symbol)}`;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** newsDate "2026-10-09" (+ newsTime "14:05:00") theo giờ VN → ISO; không hợp lệ → null. */
export function vndNewsTime(date: unknown, time: unknown): string | null {
  const d = str(date)?.slice(0, 10);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = str(time);
  const hhmmss = t && /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? (t.length === 5 ? `${t}:00` : t) : "00:00:00";
  const ms = Date.parse(`${d}T${hhmmss}+07:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Chuẩn hoá một dòng /v4/news (chịu được thiếu/đổi tên trường). */
export function mapVndNewsRow(sym: string, row: Row): NewsArticle | null {
  const title = str(row.newsTitle) ?? str(row.title) ?? str(row.headline);
  if (!title) return null;
  const rawUrl = str(row.newsSourceLink) ?? str(row.newsUrl) ?? str(row.url) ?? str(row.link);
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : dstockNewsUrl(sym);
  const id = str(row.newsId) ?? str(row.id) ?? createHash("sha1").update(`${sym}|${title}`).digest("hex").slice(0, 16);
  return {
    id: `vnd-${id}`,
    title,
    url,
    source: str(row.newsSource) ?? str(row.source) ?? "VNDirect DStock",
    publishedAt: vndNewsTime(row.newsDate ?? row.date, row.newsTime ?? row.time),
    summary: str(row.newsDescription) ?? str(row.description) ?? str(row.summary),
    symbols: [sym],
    category: "corporate",
    relatedSymbols: [sym],
  };
}

/**
 * Tin doanh nghiệp theo mã (tương ứng https://dstock.vndirect.com.vn/tin-tuc-ma/{SYM}).
 * Dùng cùng API finfo với hồ sơ doanh nghiệp, có failover host qua vndirectJson.
 * Chưa kiểm chứng với API thật trong môi trường dựng (không có mạng) → ánh xạ trường chịu lỗi,
 * response rỗng/sai cấu trúc bị coi là host lỗi để service rơi sang nguồn dự phòng.
 */
export async function getVndCompanyNews(symbol: string, size = 20): Promise<NewsArticle[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return [];
  const n = Math.max(1, Math.min(50, Math.floor(size)));
  // Cú pháp q của finfo giữ nguyên ":" và "~" (như các endpoint khác trong repo); sym đã chỉ gồm A-Z0-9.
  const path = `/v4/news?q=newsType:company_news~locale:VN~code:${sym}&sort=newsDate:desc~newsTime:desc&size=${n}`;
  const { data } = await vndirectJson<{ data?: Row[] }>(path, {
    provider: VND_NEWS,
    timeoutMs: 6_000,
    retries: 1,
    accept: (v) => Array.isArray(v?.data),
  });
  const out: NewsArticle[] = [];
  for (const row of data.data ?? []) {
    const a = mapVndNewsRow(sym, row);
    if (a) out.push(a);
  }
  return out;
}

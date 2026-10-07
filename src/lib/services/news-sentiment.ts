import "server-only";
import { buildMeta } from "../freshness";
import { llmChat, llmConfigured } from "../ai/gateway";
import { getNews } from "./news";
import type { Meta, NewsArticle } from "../types";

export type NewsTone = "up" | "down" | "neutral";

export interface ArticleSentiment {
  id: string;
  score: number;
  tone: NewsTone;
  label: string;
  hits: string[];
}

export interface NewsSentimentAggregate {
  score: number;
  tone: NewsTone;
  label: string;
  articleCount: number;
  distribution: { bullish: number; bearish: number; neutral: number };
  byCategory: { category: string; score: number; count: number; tone: NewsTone }[];
  topBullish: { id: string; title: string; score: number }[];
  topBearish: { id: string; title: string; score: number }[];
  articles: ArticleSentiment[];
}

export interface NewsSentimentLlm {
  narrative: string;
  stance: "confirm" | "diverge" | "neutral";
  themes: string[];
  risks: string[];
  model: string;
  latencyMs: number;
}

export interface NewsSentimentResult {
  filter: { category?: string; symbol?: string };
  aggregate: NewsSentimentAggregate;
  llm: NewsSentimentLlm | null;
  llmStatus: "ok" | "unavailable" | "skipped" | "failed";
}

/** Weighted lexicon — Vietnamese financial press + English crypto/macro. */
const BULL: [RegExp, number, string][] = [
  [/\b(tăng mạnh|bứt phá|kỷ lục|vượt kỳ vọng|lãi kỷ lục|lợi nhuận đột biến)\b/i, 3, "tăng mạnh"],
  [/\b(tăng trưởng|tăng giá|phục hồi|khởi sắc|tích cực|lạc quan|cải thiện)\b/i, 2, "tích cực"],
  [/\b(lãi|lợi nhuận|doanh thu tăng|phê duyệt|mở rộng|ký kết|trúng thầu|cổ tức)\b/i, 1.5, "kết quả tốt"],
  [/\b(surge|rally|breakout|record high|beat estimates|bullish|upgrade)\b/i, 2.5, "bullish EN"],
  [/\b(growth|profit|gain|recovery|optimistic|expansion)\b/i, 1.5, "positive EN"],
  [/\b(hỗ trợ|đột phá|xung lực|dòng tiền mạnh)\b/i, 1.2, "hỗ trợ"],
];

const BEAR: [RegExp, number, string][] = [
  [/\b(sụt giảm|lao dốc|bán tháo|phá sản|vỡ nợ|cắt giảm mạnh|thua lỗ nặng)\b/i, 3, "sụt giảm"],
  [/\b(giảm giá|suy yếu|tiêu cực|bi quan|rủi ro|cảnh báo|điều chỉnh)\b/i, 2, "tiêu cực"],
  [/\b(lỗ|thua lỗ|doanh thu giảm|nợ xấu|chậm trả|kiện tụng|phạt|truy thu)\b/i, 1.5, "kết quả xấu"],
  [/\b(crash|plunge|selloff|default|bankruptcy|bearish|downgrade|recession)\b/i, 2.5, "bearish EN"],
  [/\b(loss|decline|risk|warning|lawsuit|fraud|investigation)\b/i, 1.5, "negative EN"],
  [/\b(áp lực|bán ròng|khối ngoại bán|thanh khoản kém)\b/i, 1.2, "áp lực"],
];

function clamp(n: number) {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function toneLabel(score: number): { tone: NewsTone; label: string } {
  if (score >= 25) return { tone: "up", label: "Tích cực" };
  if (score >= 8) return { tone: "up", label: "Hơi tích cực" };
  if (score <= -25) return { tone: "down", label: "Tiêu cực" };
  if (score <= -8) return { tone: "down", label: "Hơi tiêu cực" };
  return { tone: "neutral", label: "Trung lập" };
}

/** Recency weight: newer articles matter more (half-life ~18h). */
function recencyWeight(publishedAt: string): number {
  const ageH = Math.max(0, (Date.now() - Date.parse(publishedAt)) / 3_600_000);
  if (!Number.isFinite(ageH)) return 0.6;
  return Math.max(0.35, Math.exp(-ageH / 18));
}

export function scoreNewsText(title: string, summary: string | null): {
  score: number;
  tone: NewsTone;
  label: string;
  hits: string[];
} {
  const text = `${title} ${summary ?? ""}`;
  let raw = 0;
  const hits: string[] = [];

  for (const [re, w, tag] of BULL) {
    if (re.test(text)) {
      raw += w;
      hits.push(`+${tag}`);
    }
  }
  for (const [re, w, tag] of BEAR) {
    if (re.test(text)) {
      raw -= w;
      hits.push(`-${tag}`);
    }
  }

  // Title carries more weight than summary
  let titleBias = 0;
  for (const [re, w] of BULL) if (re.test(title)) titleBias += w * 0.35;
  for (const [re, w] of BEAR) if (re.test(title)) titleBias -= w * 0.35;
  raw += titleBias;

  const score = clamp(raw * 12);
  const { tone, label } = toneLabel(score);
  return { score, tone, label, hits: hits.slice(0, 6) };
}

export function scoreArticle(a: NewsArticle): ArticleSentiment {
  const s = scoreNewsText(a.title, a.summary);
  return { id: a.id, score: s.score, tone: s.tone, label: s.label, hits: s.hits };
}

export function aggregateNewsSentiment(articles: NewsArticle[]): NewsSentimentAggregate {
  if (!articles.length) {
    return {
      score: 0,
      tone: "neutral",
      label: "Không có tin",
      articleCount: 0,
      distribution: { bullish: 0, bearish: 0, neutral: 0 },
      byCategory: [],
      topBullish: [],
      topBearish: [],
      articles: [],
    };
  }

  const scored = articles.map((a) => {
    const s = scoreArticle(a);
    const w = recencyWeight(a.publishedAt);
    return { a, s, w };
  });

  let weighted = 0;
  let wSum = 0;
  const dist = { bullish: 0, bearish: 0, neutral: 0 };
  const catMap = new Map<string, { sum: number; w: number; count: number }>();

  for (const { a, s, w } of scored) {
    weighted += s.score * w;
    wSum += w;
    if (s.tone === "up") dist.bullish += 1;
    else if (s.tone === "down") dist.bearish += 1;
    else dist.neutral += 1;

    const c = catMap.get(a.category) ?? { sum: 0, w: 0, count: 0 };
    c.sum += s.score * w;
    c.w += w;
    c.count += 1;
    catMap.set(a.category, c);
  }

  const score = clamp(wSum > 0 ? weighted / wSum : 0);
  const { tone, label } = toneLabel(score);

  const byCategory = [...catMap.entries()]
    .map(([category, v]) => {
      const sc = clamp(v.w > 0 ? v.sum / v.w : 0);
      const tl = toneLabel(sc);
      return { category, score: sc, count: v.count, tone: tl.tone };
    })
    .sort((a, b) => b.count - a.count);

  const ranked = [...scored].sort((x, y) => y.s.score - x.s.score);
  const topBullish = ranked
    .filter((x) => x.s.score > 0)
    .slice(0, 5)
    .map((x) => ({ id: x.a.id, title: x.a.title, score: x.s.score }));
  const topBearish = ranked
    .filter((x) => x.s.score < 0)
    .sort((x, y) => x.s.score - y.s.score)
    .slice(0, 5)
    .map((x) => ({ id: x.a.id, title: x.a.title, score: x.s.score }));

  return {
    score,
    tone,
    label,
    articleCount: articles.length,
    distribution: dist,
    byCategory,
    topBullish,
    topBearish,
    articles: scored.map((x) => x.s),
  };
}

const SYS = `Bạn là chuyên gia phân tích sentiment tin tức tài chính của Orca Financial.
Tổng hợp NGẮN bằng tiếng Việt từ STRUCTURED CONTEXT (điểm quant + phân bố tin).
Quy tắc:
- Không invent tin hoặc số liệu ngoài context.
- Không khuyến nghị mua/bán.
- Trả JSON thuần:
{"narrative":"3-5 câu","stance":"confirm|diverge|neutral","themes":["chủ đề 1"],"risks":["rủi ro đọc tin 1"]}
- stance=confirm nếu khớp điểm quant; diverge nếu có mâu thuẫn (vd điểm tích cực nhưng nhiều tin rủi ro macro).`;

async function enrichLlm(
  agg: NewsSentimentAggregate,
  filter: NewsSentimentResult["filter"],
): Promise<{ llm: NewsSentimentLlm | null; status: NewsSentimentResult["llmStatus"] }> {
  if (!llmConfigured()) return { llm: null, status: "skipped" };

  const compact = {
    filter,
    score: agg.score,
    label: agg.label,
    distribution: agg.distribution,
    byCategory: agg.byCategory,
    topBullish: agg.topBullish.map((t) => t.title.slice(0, 120)),
    topBearish: agg.topBearish.map((t) => t.title.slice(0, 120)),
  };

  const first = await llmChat("analysis", {
    system: SYS,
    user: `STRUCTURED CONTEXT:\n${JSON.stringify(compact, null, 1).slice(0, 5500)}\n\nViết JSON sentiment tin tức.`,
    temperature: 0.25,
    maxTokens: 420,
    timeoutMs: 20_000,
  });
  if (!first) return { llm: null, status: "unavailable" };

  const parsed = parseLlm(first.text);
  if (!parsed) return { llm: null, status: "failed" };

  return {
    llm: { ...parsed, model: first.model, latencyMs: first.latencyMs },
    status: "ok",
  };
}

function parseLlm(text: string): Omit<NewsSentimentLlm, "model" | "latencyMs"> | null {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) raw = brace[0];
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const narrative = typeof j.narrative === "string" ? j.narrative.trim() : "";
    if (!narrative || narrative.length < 16) return null;
    const s = String(j.stance ?? "neutral").toLowerCase();
    const stance: NewsSentimentLlm["stance"] =
      s === "confirm" || s === "diverge" ? s : "neutral";
    const themes = Array.isArray(j.themes)
      ? j.themes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5)
      : [];
    const risks = Array.isArray(j.risks)
      ? j.risks.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3)
      : [];
    return { narrative: narrative.slice(0, 900), stance, themes, risks };
  } catch {
    return null;
  }
}

export async function getNewsSentiment(args: {
  category?: NewsArticle["category"];
  symbol?: string;
  limit?: number;
  withLlm?: boolean;
}): Promise<{ data: NewsSentimentResult; meta: Meta } | null> {
  const news = await getNews({
    category: args.category,
    symbol: args.symbol,
    limit: args.limit ?? 40,
  });
  if (!news) return null;

  const aggregate = aggregateNewsSentiment(news.articles);
  const filter = { category: args.category, symbol: args.symbol };

  let llm: NewsSentimentLlm | null = null;
  let llmStatus: NewsSentimentResult["llmStatus"] = "skipped";
  if (args.withLlm !== false && aggregate.articleCount > 0) {
    const r = await enrichLlm(aggregate, filter);
    llm = r.llm;
    llmStatus = r.status;
  }

  const data: NewsSentimentResult = { filter, aggregate, llm, llmStatus };
  const meta = buildMeta({
    source:
      llmStatus === "ok" && llm
        ? `news-lexicon+llm:${llm.model}`
        : "news-lexicon",
    sourceTimestampMs: news.meta.sourceTimestamp
      ? Date.parse(news.meta.sourceTimestamp)
      : Date.now(),
    cached: news.meta.cached,
    stale: news.meta.stale,
    degraded: news.meta.partial,
    note:
      llmStatus === "skipped"
        ? `Lexicon trên ${aggregate.articleCount} tin · LLM tắt/chưa cấu hình`
        : llmStatus === "ok"
          ? `Lexicon + LLM · ${aggregate.articleCount} tin`
          : `Lexicon · LLM tạm lỗi · ${aggregate.articleCount} tin`,
  });

  return { data, meta };
}

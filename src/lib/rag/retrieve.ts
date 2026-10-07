import "server-only";

import { desc } from "drizzle-orm";
import { databaseConfigured, db } from "../../db";
import { newsArticles, ragChunks } from "../../db/schema";
import { lexicalScore, tokenizeQuery } from "./chunk";
import { filterGuidesByBranch } from "./guides-corpus";
import type { RagBranch, RagPassage, RagRetrieveOpts, RagRetrieveResult } from "./types";

function detectBranch(question: string, explicit?: RagBranch): RagBranch {
  if (explicit) return explicit;
  const q = question.toLowerCase();
  if (/vàng|gold|dầu|oil|hàng hóa|commodity|cà phê/.test(q)) return "commodity";
  if (/ngành|sector|banking|ngân hàng|bất động sản|thép/.test(q)) return "industry";
  if (/cổ phiếu|mã |p\/e|p\/b|định giá|phân tích [a-z]{3}/i.test(question)) return "stock";
  if (/thị trường|vn-?index|vn30|khối ngoại|hose|hnx/.test(q)) return "market";
  return "general";
}

function boostSymbol(text: string, symbols: string[]): number {
  if (!symbols.length) return 0;
  const u = text.toUpperCase();
  let b = 0;
  for (const s of symbols) {
    if (s && u.includes(s.toUpperCase())) b += 0.35;
  }
  return Math.min(b, 0.7);
}

async function retrieveNews(tokens: string[], symbols: string[], limit: number): Promise<RagPassage[]> {
  if (!databaseConfigured()) return [];
  try {
    const rows = await db
      .select({
        id: newsArticles.id,
        title: newsArticles.title,
        summary: newsArticles.summary,
        source: newsArticles.source,
        url: newsArticles.url,
        publishedAt: newsArticles.publishedAt,
        relatedSymbols: newsArticles.relatedSymbols,
        relatedSector: newsArticles.relatedSector,
      })
      .from(newsArticles)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(80);

    const out: RagPassage[] = [];
    for (const r of rows) {
      const body = `${r.title}\n${r.summary ?? ""}`;
      const symList = Array.isArray(r.relatedSymbols)
        ? (r.relatedSymbols as unknown[]).map(String)
        : [];
      let score = lexicalScore(body, tokens) + boostSymbol(body, symbols);
      if (symbols.some((s) => symList.map((x) => x.toUpperCase()).includes(s.toUpperCase()))) {
        score += 0.4;
      }
      if (score < 0.12) continue;
      out.push({
        id: `news-${r.id}`,
        source: "news",
        title: r.title,
        content: (r.summary || r.title).slice(0, 600),
        symbol: symList[0] ?? null,
        sector: r.relatedSector,
        score,
        sourceTs: r.publishedAt?.toISOString?.() ?? null,
        url: r.url,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return [];
  }
}

async function retrieveDbChunks(tokens: string[], symbols: string[], limit: number): Promise<RagPassage[]> {
  if (!databaseConfigured()) return [];
  try {
    const rows = await db.select().from(ragChunks).orderBy(desc(ragChunks.createdAt)).limit(120);
    const out: RagPassage[] = [];
    for (const r of rows) {
      const body = `${r.title ?? ""}\n${r.content}`;
      let score = lexicalScore(body, tokens) + boostSymbol(body, symbols);
      if (r.symbol && symbols.some((s) => s.toUpperCase() === r.symbol!.toUpperCase())) score += 0.45;
      if (score < 0.1) continue;
      out.push({
        id: `db-${r.id}`,
        source: (r.source as RagPassage["source"]) || "note",
        title: r.title ?? r.source,
        content: r.content.slice(0, 800),
        symbol: r.symbol,
        sector: r.sector,
        score,
        sourceTs: r.sourceTs?.toISOString?.() ?? null,
        url: r.sourceUrl,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return [];
  }
}

/** Hybrid retrieve Phase A: guides + news + rag_chunks (lexical, no embedding). */
export async function retrieveRag(opts: RagRetrieveOpts): Promise<RagRetrieveResult> {
  const t0 = performance.now();
  const topK = Math.min(12, Math.max(2, opts.topK ?? 5));
  const symbols = (opts.symbols ?? []).map((s) => s.toUpperCase()).filter(Boolean);
  const branch = detectBranch(opts.question, opts.branch);
  const tokens = tokenizeQuery(opts.question);

  const includeGuides = opts.includeGuides !== false;
  const includeNews = opts.includeNews !== false;

  let guideHits = 0;
  let newsHits = 0;
  let dbHits = 0;
  const pool: RagPassage[] = [];

  if (includeGuides) {
    const guides = filterGuidesByBranch(branch).map((p) => {
      const score = lexicalScore(`${p.title}\n${p.content}`, tokens) + 0.05;
      return { ...p, score };
    });
    guides.sort((a, b) => b.score - a.score);
    const take = guides.filter((g) => g.score >= 0.08).slice(0, Math.max(2, Math.ceil(topK / 2)));
    const ensured = take.length ? take : guides.slice(0, 1);
    guideHits = ensured.length;
    pool.push(...ensured);
  }

  if (includeNews) {
    const news = await retrieveNews(tokens, symbols, topK);
    newsHits = news.length;
    pool.push(...news);
  }

  const dbParts = await retrieveDbChunks(tokens, symbols, topK);
  dbHits = dbParts.length;
  pool.push(...dbParts);

  const seen = new Set<string>();
  const merged: RagPassage[] = [];
  for (const p of pool.sort((a, b) => b.score - a.score)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
    if (merged.length >= topK) break;
  }

  return {
    passages: merged,
    meta: { guideHits, newsHits, dbHits, tookMs: Math.round(performance.now() - t0) },
  };
}

export function formatPassagesForPrompt(passages: RagPassage[]): string {
  if (!passages.length) return "(Không có đoạn tài liệu bổ sung.)";
  return passages
    .map((p, i) => {
      const head =
        `[${i + 1}] source=${p.source}` +
        (p.symbol ? ` symbol=${p.symbol}` : "") +
        (p.sourceTs ? ` ts=${p.sourceTs}` : "") +
        (p.url ? ` url=${p.url}` : "");
      return `${head}\n${p.title}\n${p.content}`;
    })
    .join("\n\n");
}

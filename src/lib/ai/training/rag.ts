import "server-only";

/**
 * Tầng 3 — RAG đa ngữ cảnh
 * Index snapshot, báo cáo, tin tức vào vector store (PGVector fallback in-memory)
 * Truy vấn trước khi gọi LLM để bổ sung context ngoài contract hiện tại
 */

export interface RagChunk {
  id: string;
  text: string;
  metadata: { source: string; type: string; timestamp: string; symbols?: string[] };
  embedding?: number[];
}

/**
 * Chunk đơn giản: tách theo đoạn, giới hạn 600 ký tự
 */
export function chunkText(text: string, maxLen = 600): string[] {
  const paras = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length <= maxLen) buf = buf ? buf + "\n\n" + p : p;
    else {
      if (buf) out.push(buf);
      if (p.length > maxLen) {
        for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
        buf = "";
      } else buf = p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * In-memory vector store cho prototype (thay bằng PGVector khi có extension)
 * Dùng cosine similarity trên embedding giả (hash) nếu chưa có embedding thật
 */
class InMemoryRag {
  private chunks: RagChunk[] = [];

  upsert(chunks: RagChunk[]) {
    for (const c of chunks) {
      const i = this.chunks.findIndex(x => x.id === c.id);
      if (i >= 0) this.chunks[i] = c; else this.chunks.push(c);
    }
    // giữ 2000 chunk mới nhất
    if (this.chunks.length > 2000) this.chunks = this.chunks.slice(-2000);
  }

  // simple keyword scorer thay embedding thật (đủ cho fallback, sau này thay bằng embedding)
  search(query: string, topK = 4): RagChunk[] {
    const q = query.toLowerCase();
    const scored = this.chunks.map(c => {
      const t = c.text.toLowerCase();
      let score = 0;
      for (const w of q.split(/\s+/).filter(w => w.length > 2)) if (t.includes(w)) score += 1;
      // boost theo recency
      const ageH = (Date.now() - new Date(c.metadata.timestamp).getTime()) / 3600000;
      const recency = Math.max(0, 1 - ageH / 72); // 72h decay
      return { c, score: score + recency * 0.5 };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK).map(x => x.c);
    return scored;
  }

  all() { return this.chunks; }
  count() { return this.chunks.length; }
}

export const ragStore = new InMemoryRag();

/**
 * Index snapshot hiện tại vào RAG
 */
export async function indexMarketSnapshot(snap: { headline: string; body: string[]; drivers?: unknown }): Promise<number> {
  const text = [snap.headline, ...snap.body].join("\n\n");
  const chunks = chunkText(text).map((t, i) => ({
    id: `snap-${Date.now()}-${i}`,
    text: t,
    metadata: { source: "market_snapshot", type: "pulse", timestamp: new Date().toISOString() },
  }));
  ragStore.upsert(chunks);
  return chunks.length;
}

export async function indexNews(articles: { title: string; summary?: string | null; source: string; publishedAt: string; id?: string }[]): Promise<number> {
  const chunks: RagChunk[] = [];
  for (const a of articles) {
    const text = `${a.title}\n\n${a.summary ?? ""}`.trim();
    for (const [i, c] of chunkText(text, 400).entries()) {
      chunks.push({ id: `news-${a.id ?? a.title.slice(0, 20)}-${i}`, text: c, metadata: { source: a.source, type: "news", timestamp: a.publishedAt } });
    }
  }
  ragStore.upsert(chunks);
  return chunks.length;
}

/**
 * Truy vấn RAG cho câu hỏi — trả về context bổ sung cho LLM
 */
export function retrieveForQuestion(question: string, topK = 3): string {
  const hits = ragStore.search(question, topK);
  if (!hits.length) return "";
  return hits.map(h => `[${h.metadata.source} ${new Date(h.metadata.timestamp).toLocaleDateString("vi-VN")}] ${h.text.slice(0, 600)}`).join("\n\n---\n\n");
}

import "server-only";
import type { Quote } from "../types";
import * as vndirect from "../providers/vndirect";
import { getVpsQuotes } from "../providers/vps";
import { getVietcapQuotes } from "../providers/vietcap";
import { getSsiIboardQuotes } from "../providers/ssi-iboard";
import { getPublicQuotes } from "../providers/public-vn-feed";
import { recordMarketSource, type MarketSourceId } from "../realtime/market-source-monitor";
import { isCircuitOpen } from "../health";

/**
 * Multi-source VN quotes — **chỉ nguồn công khai (public, không API key)**.
 *
 * | Source        | Endpoint (public)                                      |
 * |---------------|--------------------------------------------------------|
 * | vndirect      | api-finfo.vndirect.com.vn / finfo-api.vndirect.com.vn  |
 * | vps           | bgapidatafeed.vps.com.vn/getliststockdata              |
 * | ssi-iboard    | iboard-query.ssi.com.vn/stock/exchange/{hose|hnx|…}    |
 * | vietcap       | iq.vietcap.com.vn/api/iq-insight-service (public)      |
 * | public-vn     | gộp VPS + iBoard + Vietcap + Yahoo indices             |
 *
 * Không dùng SSI FastConnect (SSI_CONSUMER_* / SSI_FC_*) — API có credential,
 * không thuộc nhóm public. Credential SSI vẫn dùng ở orderbook/derivatives riêng.
 *
 * Tier 1 (song song): VNDirect + VPS + SSI iBoard
 * Tier 2 (song song, khi coverage thấp): Vietcap + public-vn
 * Tier 3 (last-resort gap): public-vn small batches
 *
 * MULTI_SOURCE_MODE=parallel|aggressive
 */

export type MultiQuoteResult = {
  quotes: Quote[];
  sources: string[];
  sourceTs: number | null;
  latencies: Record<string, number>;
  conflicts: number;
};

const PRICE_PRIORITY: Record<string, number> = {
  vndirect: 100,
  vps: 95,
  "ssi-iboard": 90,
  vietcap: 50,
  "public-vn": 30,
};

const rank = (src: string) => PRICE_PRIORITY[src] ?? 0;
const CONFLICT_PCT = 0.015;
const CONFLICT_ABS = 200;
const PRIMARY_COVERAGE_OK = 0.75;
const TIER1_TIMEOUT_MS = 4_500;
const TIER2_TIMEOUT_MS = 5_500;
const TIER2_BUDGET_MS = 7_000;
const TIER3_TIMEOUT_MS = 6_000;
/** Max symbols per provider call — large lists are chunked & run in parallel. */
const CHUNK_SIZE = 40;

type TaggedQuote = Quote & { _src: string; _latencyMs: number };
type SourceBatch = { src: string; quotes: Quote[]; latencyMs: number; ok: boolean };
type QuotePack = { quotes: Quote[]; sourceTs: number | null };

function multiSourceMode(): "parallel" | "aggressive" {
  const m = (process.env.MULTI_SOURCE_MODE ?? "parallel").toLowerCase().trim();
  return m === "aggressive" ? "aggressive" : "parallel";
}

async function asPack(fn: () => Promise<Quote[]>): Promise<QuotePack> {
  const quotes = await fn();
  return { quotes: quotes ?? [], sourceTs: quotes?.length ? Date.now() : null };
}

function chunkSymbols(syms: string[], size = CHUNK_SIZE): string[][] {
  if (syms.length <= size) return [syms];
  const out: string[][] = [];
  for (let i = 0; i < syms.length; i += size) out.push(syms.slice(i, i + size));
  return out;
}

/** Run a quote provider across symbol chunks in parallel, then merge. */
async function runChunkedSource(
  src: string,
  symbols: string[],
  fetchChunk: (chunk: string[]) => Promise<QuotePack>,
  timeoutMs: number,
  chunkSize = CHUNK_SIZE,
): Promise<SourceBatch> {
  const chunks = chunkSymbols(symbols, chunkSize);
  if (chunks.length <= 1) {
    return runSource(src, () => fetchChunk(symbols), timeoutMs);
  }
  const t0 = performance.now();
  const parts = await Promise.all(
    chunks.map((ch) =>
      runSource(`${src}:chunk`, () => fetchChunk(ch), timeoutMs).then((b) => b.quotes),
    ),
  );
  const merged: Quote[] = [];
  const seen = new Set<string>();
  for (const qs of parts) {
    for (const q of qs) {
      const s = String(q.symbol ?? "").toUpperCase();
      if (!s || seen.has(s) || !(Number(q.price) > 0)) continue;
      seen.add(s);
      merged.push(q);
    }
  }
  const latencyMs = Math.round(performance.now() - t0);
  const ok = merged.length > 0;
  recordMarketSource(src as MarketSourceId, ok, latencyMs);
  return { src, quotes: merged, latencyMs, ok };
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deadline")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function runSource(
  src: string,
  fn: () => Promise<QuotePack>,
  timeoutMs: number,
): Promise<SourceBatch> {
  if (isCircuitOpen(src) || isCircuitOpen(`sync:${src}`)) {
    return { src, quotes: [], latencyMs: 0, ok: false };
  }
  const t0 = performance.now();
  try {
    const r = await withDeadline(fn(), timeoutMs);
    const latencyMs = Math.round(performance.now() - t0);
    const quotes = (r.quotes ?? []).filter((q) => q && Number(q.price) > 0);
    const ok = quotes.length > 0;
    recordMarketSource(src as MarketSourceId, ok, latencyMs);
    return { src, quotes, latencyMs, ok };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - t0);
    recordMarketSource(src as MarketSourceId, false, latencyMs);
    void e;
    return { src, quotes: [], latencyMs, ok: false };
  }
}

function applyBatch(bySym: Map<string, TaggedQuote>, batch: SourceBatch): number {
  let conflicts = 0;
  for (const q of batch.quotes) {
    const sym = String(q.symbol ?? "").toUpperCase();
    if (!sym || !(Number(q.price) > 0)) continue;
    const tagged: TaggedQuote = {
      ...q,
      symbol: sym,
      _src: batch.src,
      _latencyMs: batch.latencyMs,
    };
    const prev = bySym.get(sym);
    if (!prev) {
      bySym.set(sym, tagged);
      continue;
    }
    const prevP = Number(prev.price);
    const nextP = Number(q.price);
    if (prevP > 0 && nextP > 0) {
      const diff = Math.abs(nextP - prevP);
      if (diff >= CONFLICT_ABS || diff / prevP >= CONFLICT_PCT) conflicts += 1;
    }
    if (rank(batch.src) >= rank(prev._src)) {
      bySym.set(sym, {
        ...prev,
        ...tagged,
        name: tagged.name ?? prev.name,
        volume: tagged.volume ?? prev.volume,
        quoteVolume: tagged.quoteVolume ?? prev.quoteVolume,
        open: tagged.open ?? prev.open,
        high: tagged.high ?? prev.high,
        low: tagged.low ?? prev.low,
        change: tagged.change ?? prev.change,
        changePercent: tagged.changePercent ?? prev.changePercent,
        referencePrice: tagged.referencePrice ?? prev.referencePrice,
        ceilingPrice: tagged.ceilingPrice ?? prev.ceilingPrice,
        floorPrice: tagged.floorPrice ?? prev.floorPrice,
        _src: batch.src,
        _latencyMs: batch.latencyMs,
      });
    } else {
      bySym.set(sym, {
        ...tagged,
        ...prev,
        name: prev.name ?? tagged.name,
        volume: prev.volume ?? tagged.volume,
        quoteVolume: prev.quoteVolume ?? tagged.quoteVolume,
        open: prev.open ?? tagged.open,
        high: prev.high ?? tagged.high,
        low: prev.low ?? tagged.low,
        change: prev.change ?? tagged.change,
        changePercent: prev.changePercent ?? tagged.changePercent,
        referencePrice: prev.referencePrice ?? tagged.referencePrice,
        ceilingPrice: prev.ceilingPrice ?? tagged.ceilingPrice,
        floorPrice: prev.floorPrice ?? tagged.floorPrice,
      });
    }
  }
  return conflicts;
}

function coverageOf(bySym: Map<string, TaggedQuote>, wanted: string[]): number {
  if (!wanted.length) return 1;
  let hit = 0;
  for (const s of wanted) if (bySym.has(s)) hit += 1;
  return hit / wanted.length;
}

function finish(
  bySym: Map<string, TaggedQuote>,
  usedSources: string[],
  latencies: Record<string, number>,
  batches: SourceBatch[],
  conflicts: number,
): MultiQuoteResult {
  const quotes: Quote[] = [];
  let sourceTs: number | null = null;
  for (const t of bySym.values()) {
    const { _src: _s, _latencyMs: _l, ...rest } = t;
    quotes.push(rest);
    const ts = typeof rest.timestamp === "number" ? rest.timestamp : null;
    if (ts && (sourceTs == null || ts > sourceTs)) sourceTs = ts;
  }
  if (sourceTs == null) {
    for (const b of batches) {
      if (b.ok && b.quotes.length) {
        sourceTs = Date.now();
        break;
      }
    }
  }
  return {
    quotes,
    sources: [...new Set(usedSources)],
    sourceTs,
    latencies,
    conflicts,
  };
}

async function runParallelTier(
  tasks: { src: string; p: Promise<SourceBatch> }[],
  bySym: Map<string, TaggedQuote>,
  wanted: string[],
  usedSources: string[],
  latencies: Record<string, number>,
  batches: SourceBatch[],
  opts: { budgetMs: number; exitCoverage: number },
): Promise<number> {
  let conflicts = 0;
  if (!tasks.length) return 0;

  await new Promise<void>((resolve) => {
    let pending = tasks.length;
    let settled = false;
    const hardStop = setTimeout(() => {
      settled = true;
      resolve();
    }, opts.budgetMs);

    for (const { src, p } of tasks) {
      void p.then((batch) => {
        batches.push(batch);
        latencies[src] = batch.latencyMs;
        if (batch.ok || batch.quotes.length) {
          if (!usedSources.includes(src)) usedSources.push(src);
          conflicts += applyBatch(bySym, batch);
        }
        pending -= 1;
        if (!settled && coverageOf(bySym, wanted) >= opts.exitCoverage) {
          settled = true;
          clearTimeout(hardStop);
          resolve();
        }
        if (!settled && pending <= 0) {
          settled = true;
          clearTimeout(hardStop);
          resolve();
        }
      });
    }
  });

  return conflicts;
}

export async function getMultiQuotes(symbols: string[]): Promise<MultiQuoteResult> {
  try {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!uniq.length) {
    return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
  }

  const bySym = new Map<string, TaggedQuote>();
  const latencies: Record<string, number> = {};
  const usedSources: string[] = [];
  const batches: SourceBatch[] = [];
  let conflicts = 0;
  const mode = multiSourceMode();

  // Tier 1: PUBLIC primary — song song + chunked (không API key)
  const tier1: { src: string; p: Promise<SourceBatch> }[] = [
    {
      src: "vndirect",
      p: runChunkedSource(
        "vndirect",
        uniq,
        (ch) => vndirect.getVndQuotes(ch),
        TIER1_TIMEOUT_MS,
      ),
    },
    {
      src: "vps",
      p: runChunkedSource(
        "vps",
        uniq,
        (ch) => asPack(() => getVpsQuotes(ch)),
        TIER1_TIMEOUT_MS,
      ),
    },
    {
      src: "ssi-iboard",
      p: runChunkedSource(
        "ssi-iboard",
        uniq,
        (ch) => asPack(() => getSsiIboardQuotes(ch)),
        TIER1_TIMEOUT_MS,
      ),
    },
  ];

  conflicts += await runParallelTier(tier1, bySym, uniq, usedSources, latencies, batches, {
    budgetMs: TIER1_TIMEOUT_MS + 800,
    // Early-exit when we have full coverage from any combination of tier1
    exitCoverage: 1,
  });

  // Always fill missing symbols — even when overall coverage looks "good"
  const missingAfterT1 = uniq.filter((s) => !bySym.has(s));
  const needBroadFallback =
    mode === "aggressive" || coverageOf(bySym, uniq) < PRIMARY_COVERAGE_OK;

  if (missingAfterT1.length > 0 || needBroadFallback) {
    // Tier 2: PUBLIC secondary — fill gaps (or full refresh in aggressive mode)
    const target =
      mode === "aggressive" || needBroadFallback
        ? uniq
        : missingAfterT1;

    const tier2: { src: string; p: Promise<SourceBatch> }[] = [
      {
        src: "vietcap",
        p: runChunkedSource(
          "vietcap",
          target,
          (ch) => getVietcapQuotes(ch),
          TIER2_TIMEOUT_MS,
          20,
        ),
      },
      {
        src: "public-vn",
        p: runChunkedSource(
          "public-vn",
          target,
          async (ch) => {
            const r = await getPublicQuotes(ch);
            return { quotes: r.quotes ?? [], sourceTs: r.sourceTs ?? Date.now() };
          },
          TIER2_TIMEOUT_MS,
        ),
      },
    ];

    conflicts += await runParallelTier(tier2, bySym, uniq, usedSources, latencies, batches, {
      budgetMs: TIER2_BUDGET_MS,
      exitCoverage: 0.98,
    });
  }

  // Tier 3: last-resort for still-missing — public-vn only, small batches
  const stillMissing = uniq.filter((s) => !bySym.has(s));
  if (stillMissing.length > 0 && stillMissing.length <= 80) {
    try {
      const batch = await runChunkedSource(
        "public-vn-gap",
        stillMissing,
        async (ch) => {
          const r = await getPublicQuotes(ch);
          return { quotes: r.quotes ?? [], sourceTs: r.sourceTs ?? Date.now() };
        },
        TIER3_TIMEOUT_MS,
      );
      // Normalize source id for ranking
      batch.src = "public-vn";
      batches.push(batch);
      latencies["public-vn-gap"] = batch.latencyMs;
      if (batch.ok) {
        usedSources.push("public-vn");
        conflicts += applyBatch(bySym, batch);
      }
    } catch {
      /* soft-fail */
    }
  }

  return finish(bySym, usedSources, latencies, batches, conflicts);
  } catch {
    return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
  }
}

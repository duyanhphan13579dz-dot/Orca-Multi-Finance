import "server-only";
import type { Quote } from "../types";
import * as vndirect from "../providers/vndirect";
import { getVpsQuotes } from "../providers/vps";
import { getVietcapQuotes } from "../providers/vietcap";
import { getSsiIboardQuotes } from "../providers/ssi-iboard";
import { getSsiQuotes, ssiFcConfigured } from "../providers/ssi-fcdata";
import { getPublicQuotes } from "../providers/public-vn-feed";
import { recordMarketSource, type MarketSourceId } from "../realtime/market-source-monitor";
import { isCircuitOpen } from "../health";

/**
 * Multi-source VN quotes — parallel tiers + priority merge (never average prices).
 *
 * Tier 1 (primary, song song): SSI FastConnect (nếu có credential) + VNDirect
 * Tier 2 (fallback, song song): VPS · SSI iBoard · Vietcap · public-vn
 *   — chỉ chạy khi coverage tier-1 < PRIMARY_COVERAGE_OK
 *   — early-exit khi coverage ≥ 0.98 hoặc hết budget
 *
 * Mode env (optional):
 *   MULTI_SOURCE_MODE=parallel   (default) — tier parallel
 *   MULTI_SOURCE_MODE=aggressive — luôn fan-out tier-2 (bù gap + cross-check conflict)
 */

export type MultiQuoteResult = {
  quotes: Quote[];
  sources: string[];
  sourceTs: number | null;
  latencies: Record<string, number>;
  conflicts: number;
};

/** Higher = preferred when two sources quote the same symbol. */
const PRICE_PRIORITY: Record<string, number> = {
  "ssi-fcdata": 110,
  vndirect: 100,
  vps: 90,
  "ssi-iboard": 80,
  vietcap: 40,
  "public-vn": 30,
};

const rank = (src: string) => PRICE_PRIORITY[src] ?? 0;
const CONFLICT_PCT = 0.015;
const CONFLICT_ABS = 200;
/** Fan-out tier-2 when tier-1 covers less than this fraction. */
const PRIMARY_COVERAGE_OK = 0.85;
const TIER1_TIMEOUT_MS = 4_500;
const TIER2_TIMEOUT_MS = 5_500;
const TIER2_BUDGET_MS = 7_000;

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
    const msg = e instanceof Error ? e.message : String(e);
    recordMarketSource(src as MarketSourceId, false, latencyMs);
    void msg;
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

/** Run many source tasks in parallel; merge as each completes; early-exit on coverage. */
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

  // ── Tier 1: primary sources in PARALLEL ──────────────────────────────────
  const tier1: { src: string; p: Promise<SourceBatch> }[] = [
    {
      src: "vndirect",
      p: runSource("vndirect", () => vndirect.getVndQuotes(uniq), TIER1_TIMEOUT_MS),
    },
  ];
  if (ssiFcConfigured()) {
    tier1.unshift({
      src: "ssi-fcdata",
      p: runSource(
        "ssi-fcdata",
        async () => {
          const r = await getSsiQuotes(uniq);
          if (Array.isArray(r)) return { quotes: r, sourceTs: r.length ? Date.now() : null };
          return r as QuotePack;
        },
        TIER1_TIMEOUT_MS,
      ),
    });
  }

  conflicts += await runParallelTier(tier1, bySym, uniq, usedSources, latencies, batches, {
    budgetMs: TIER1_TIMEOUT_MS + 500,
    exitCoverage: 1,
  });

  const needFallback =
    mode === "aggressive" || coverageOf(bySym, uniq) < PRIMARY_COVERAGE_OK;

  if (!needFallback) {
    return finish(bySym, usedSources, latencies, batches, conflicts);
  }

  // ── Tier 2: fallback sources in PARALLEL (fill gaps) ─────────────────────
  const missing = uniq.filter((s) => !bySym.has(s));
  const target = mode === "aggressive" || missing.length === 0 ? uniq : missing;

  const tier2: { src: string; p: Promise<SourceBatch> }[] = [
    { src: "vps", p: runSource("vps", () => asPack(() => getVpsQuotes(target)), TIER2_TIMEOUT_MS) },
    {
      src: "ssi-iboard",
      p: runSource("ssi-iboard", () => asPack(() => getSsiIboardQuotes(target)), TIER2_TIMEOUT_MS),
    },
    {
      src: "vietcap",
      p: runSource("vietcap", () => getVietcapQuotes(target), TIER2_TIMEOUT_MS),
    },
    {
      src: "public-vn",
      p: runSource(
        "public-vn",
        async () => {
          const r = await getPublicQuotes(target);
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

  return finish(bySym, usedSources, latencies, batches, conflicts);
}

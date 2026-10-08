import "server-only";
import { cached } from "../cache";
import { httpJson } from "../http";
import type { Quote } from "../types";
import { getVnSession } from "../vn/sessions";
import { ProviderError } from "./binance";

export const VNDIRECT_MQ = "vndirect";

/**
 * Full-board VN market quotes (DStock /v4/stock_prices) — one pass covers the whole
 * HOSE/HNX/UPCoM board, so multi-symbol callers no longer need one request per symbol.
 *
 * Connection rules:
 *  - 1 request per 500 rows, first page first, remaining pages in batches of 4
 *  - early exit when a caller supplies `wanted` and every symbol is already covered
 *  - completed full passes are cached (8s during session / 45s off-session)
 */

const PRIMARY_BASE = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

function vndBases(): string[] {
  const primary = PRIMARY_BASE();
  const alts = ["https://api-finfo.vndirect.com.vn", "https://finfo-api.vndirect.com.vn"];
  const out: string[] = [];
  for (const b of [primary, ...alts]) {
    const n = b.replace(/\/$/, "");
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

let lastGoodBase = 0;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type VndPriceRow = {
  code?: string;
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  nmVolume?: number;
  nmValue?: number;
  change?: number;
  changeRatio?: number;
  changePercent?: number;
  pctChange?: number;
  basicPrice?: number;
  ceilingPrice?: number;
  floorPrice?: number;
};

type Page<T> = { data?: T[]; totalPages?: number };

const VND_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "X-Requested-With": "XMLHttpRequest",
};

async function vndGet<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const bases = vndBases();
  let lastErr = "unreachable";
  for (let i = 0; i < bases.length; i++) {
    const idx = (lastGoodBase + i) % bases.length;
    const res = await httpJson<T>(`${bases[idx]}${path}`, {
      provider: VNDIRECT_MQ,
      timeoutMs,
      retries: 2,
      backoffBaseMs: 220,
      headers: VND_HEADERS,
    });
    if (res.ok && res.data != null) {
      lastGoodBase = idx;
      return res.data;
    }
    lastErr = res.error ?? "unreachable";
  }
  throw new ProviderError(`vndirect: ${lastErr}`, VNDIRECT_MQ);
}

function mapVndPriceRow(r: VndPriceRow): Quote | null {
  const symbol = String(r.code ?? "").toUpperCase();
  const price = num(r.close);
  if (!symbol || price == null || price <= 0) return null;
  return {
    symbol,
    assetClass: "stock",
    price,
    change: num(r.change),
    changePercent: num(r.changePercent) ?? num(r.changeRatio) ?? num(r.pctChange),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    volume: num(r.nmVolume),
    quoteVolume: num(r.nmValue),
    referencePrice: num(r.basicPrice),
    ceilingPrice: num(r.ceilingPrice),
    floorPrice: num(r.floorPrice),
    updatedAt: r.date ?? null,
  };
}

let _sessionDateCache: { date: string; until: number } | null = null;
async function getSessionDate(): Promise<string> {
  if (_sessionDateCache && Date.now() < _sessionDateCache.until) return _sessionDateCache.date;
  const payload = await vndGet<Page<{ date?: string }>>("/v4/stock_prices?size=1&sort=date:desc", 5_000);
  const d = payload.data?.[0]?.date;
  if (!d) throw new ProviderError("vndirect: no session date", VNDIRECT_MQ);
  const date = String(d).slice(0, 10);
  _sessionDateCache = { date, until: Date.now() + 60_000 };
  return date;
}

export type VndMarketQuotesPack = {
  quotes: Quote[];
  sourceTs: number | null;
  sessionDate: string;
  /** true when every page of the board was fetched (no early exit) */
  complete: boolean;
  pagesFetched: number;
};

/** Split a symbol list into transport-sized batches (default 40 per request). */
export function chunkSymbols(symbols: string[], size = 40): string[][] {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const step = Math.max(1, Math.floor(size));
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += step) out.push(uniq.slice(i, i + step));
  return out;
}

/** Index board rows by symbol and keep only the requested, valid quotes. */
export function pickQuotesFromSnapshot(quotes: Quote[], symbols: string[]): Quote[] {
  const want = new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean));
  if (!want.size) return [];
  const bySym = new Map<string, Quote>();
  for (const q of quotes ?? []) {
    const sym = String(q?.symbol ?? "").toUpperCase();
    if (!sym || !want.has(sym) || !(Number(q.price) > 0)) continue;
    bySym.set(sym, { ...q, symbol: sym });
  }
  return [...bySym.values()];
}

function coverage(picked: ReadonlySet<string>, wanted: ReadonlySet<string>): number {
  if (!wanted.size) return 1;
  let hit = 0;
  for (const s of wanted) if (picked.has(s)) hit += 1;
  return hit / wanted.size;
}

/** Page 1 first, then remaining pages in parallel batches of 4. Cap 8 pages. */
export async function fetchVndMarketQuotesParallel(
  sessionDate?: string,
  opts?: { wanted?: string[]; maxPages?: number },
): Promise<VndMarketQuotesPack> {
  const date = sessionDate ?? (await getSessionDate());
  const pageSize = 500;
  const MAX_PAGES = Math.min(Math.max(1, opts?.maxPages ?? 8), 8);
  const PAGE_TIMEOUT = 7_000;
  const wanted = new Set((opts?.wanted ?? []).map((s) => s.toUpperCase().trim()).filter(Boolean));
  const seen = new Set<string>();
  const quotes: Quote[] = [];
  let newest: number | null = null;
  let pagesFetched = 0;

  const ingest = (data: VndPriceRow[]) => {
    for (const r of data) {
      const q = mapVndPriceRow(r);
      if (!q) continue;
      const t = r.date ? Date.parse(`${r.date}T15:00:00+07:00`) : null;
      if (t != null && Number.isFinite(t) && (newest == null || t > newest)) newest = t;
      seen.add(q.symbol);
      quotes.push(q);
    }
  };

  const first = await vndGet<Page<VndPriceRow>>(
    `/v4/stock_prices?q=date:${date}~type:STOCK&size=${pageSize}&page=1`,
    PAGE_TIMEOUT,
  );
  pagesFetched += 1;
  ingest(first.data ?? []);
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Number(first.totalPages) || 1));

  const coveredEnough = () => wanted.size > 0 && coverage(seen, wanted) >= 1;

  if (totalPages > 1 && !coveredEnough()) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const BATCH = 4;
    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch = remaining.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map((page) =>
          vndGet<Page<VndPriceRow>>(
            `/v4/stock_prices?q=date:${date}~type:STOCK&size=${pageSize}&page=${page}`,
            PAGE_TIMEOUT,
          ),
        ),
      );
      for (const s of settled) {
        if (s.status === "fulfilled") {
          pagesFetched += 1;
          ingest(s.value.data ?? []);
        }
      }
      if (coveredEnough()) break;
    }
  }

  if (!quotes.length) throw new ProviderError("vndirect: empty market quotes", VNDIRECT_MQ);
  return {
    quotes,
    sourceTs: newest,
    sessionDate: date,
    complete: pagesFetched >= totalPages,
    pagesFetched,
  };
}

export type VndMarketSnapshot = VndMarketQuotesPack & {
  cached: boolean;
  stale: boolean;
  producedAt: number;
};

const SNAPSHOT_KEY = "vn:mkt:snapshot:v2";

/**
 * Above this symbol count the whole-board snapshot (page 1..N, cached) is cheaper
 * and better covered than one request per symbol.
 */
export const VND_SNAPSHOT_MIN_SYMBOLS = 20;

function snapshotTtl(): { ttlMs: number; staleMs: number } {
  let trading = false;
  try {
    trading = getVnSession().trading;
  } catch {
    trading = false;
  }
  return trading
    ? { ttlMs: 8_000, staleMs: 60_000 }
    : { ttlMs: 45_000, staleMs: 10 * 60_000 };
}

/** Does a cached board already satisfy what the caller asked for? */
export function snapshotSatisfies(pack: VndMarketQuotesPack, wanted: string[]): boolean {
  if (!wanted.length) return pack.complete === true;
  return pickQuotesFromSnapshot(pack.quotes, wanted).length >= wanted.length;
}

/**
 * Whole-board snapshot with shared cache.
 *
 * - `wanted` enables a coverage-driven early exit (fewer page requests) and the
 *   resulting leading slice is cacheable: the producer runs with the caller's scope.
 * - callers that need the *entire* board validate `complete === true`, so a narrower
 *   cached slice never masquerades as the full universe.
 * - the shared TTL is short (8s in session / 45s out), so scope churn is bounded.
 */
export async function getVndMarketSnapshot(opts?: {
  wanted?: string[];
  skipCache?: boolean;
}): Promise<VndMarketSnapshot> {
  const wanted = (opts?.wanted ?? []).map((s) => s.toUpperCase().trim()).filter(Boolean);
  const { ttlMs, staleMs } = snapshotTtl();
  const produce = () => fetchVndMarketQuotesParallel(undefined, wanted.length ? { wanted } : undefined);

  if (!opts?.skipCache) {
    try {
      const hit = await cached<VndMarketQuotesPack>(SNAPSHOT_KEY, {
        ttlMs,
        staleMs,
        producer: produce,
      });
      // `!hit.cached` = the producer just ran with this call's scope, which is the
      // best answer available; a cache hit must still prove it covers the request.
      if (!hit.cached || snapshotSatisfies(hit.value, wanted)) {
        return { ...hit.value, cached: hit.cached, stale: hit.stale, producedAt: hit.producedAt };
      }
    } catch {
      /* fall through to a direct fetch */
    }
  }

  const pack = await produce();
  await cached<VndMarketQuotesPack>(SNAPSHOT_KEY, {
    ttlMs,
    staleMs,
    softSwr: false,
    producer: async () => pack,
  }).catch(() => undefined);
  return { ...pack, cached: false, stale: false, producedAt: Date.now() };
}

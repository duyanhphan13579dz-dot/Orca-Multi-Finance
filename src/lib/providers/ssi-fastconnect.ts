import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * SSI FastConnect v3 — REST adapter (developers.ssi.com.vn).
 *
 * Base URL : https://api.ssi.com.vn           (env SSI_API_BASE_URL)
 * Auth     : POST /api/v3/auth/token          {apiKey, apiSecret[, otp, transactionId]}
 *            POST /api/v3/auth/refresh        {refreshToken}
 * Market   : GET  /api/v3/data/{ohlc, masterdata, indexList, indexSummary,
 *                                securitiesByBoard, securitiesSummary}
 *
 * PRIMARY provider for Vietnam equities when SSI_API_KEY + SSI_API_SECRET are
 * configured. Market data does NOT require OTP/PrivateKey — those are only
 * needed for the Trading group (see ./ssi-trading.ts).
 */

export const SSI_FASTCONNECT = "ssi-fastconnect";

const DEFAULT_BASE = "https://api.ssi.com.vn";
const BOARDS = ["HOSE", "HNX", "UPCOM"] as const;
/** Priority index codes — the actual code list is discovered from indexList. */
const CORE_INDEX_CODES = ["VNINDEX", "VN30", "VN100", "HNXINDEX", "HNX30", "UPCOMINDEX"] as const;

export function ssiBase(): string {
  return (process.env.SSI_API_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

export function ssiFastConfigured(): boolean {
  return Boolean(process.env.SSI_API_KEY?.trim() && process.env.SSI_API_SECRET?.trim());
}

/* ------------------------------ parsing ---------------------------------- */

export const fcNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse `YYYY/MM/DD` or `YYYY/MM/DD HH:mm:ss` in Asia/Ho_Chi_Minh (+07). */
export function parseFcDate(d: string | null | undefined, endOfDay = false): number | null {
  if (!d) return null;
  const s = String(d).trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) {
    // tolerate dd/MM/yyyy (legacy payloads) and ISO
    const alt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (alt) {
      const t = Date.parse(`${alt[3]}-${alt[2].padStart(2, "0")}-${alt[1].padStart(2, "0")}T15:00:00+07:00`);
      return Number.isFinite(t) ? t : null;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const [, y, mo, da, hh, mi, se] = m;
  if (hh != null) {
    const iso = `${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}T${hh.padStart(2, "0")}:${mi.padStart(2, "0")}:${(se ?? "0").padStart(2, "0")}+07:00`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }
  const time = endOfDay ? "15:00:00" : "00:00:00";
  const t = Date.parse(`${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}T${time}+07:00`);
  return Number.isFinite(t) ? t : null;
}

/** Format a Date as YYYY/MM/DD in VN timezone. */
export function fcDay(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}

export function fcDayTime(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function daysAgoFc(n: number): string {
  return fcDay(new Date(Date.now() - n * 86_400_000));
}

/* ------------------------------ auth ------------------------------------- */

export interface FcTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms */
  expiresAt: number;
  refreshExpiresAt: number | null;
}

type FcTokenResponse = {
  tokenType?: string;
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  code?: number | string;
  msg?: string;
};

let tokenCache: FcTokenBundle | null = null;
let tokenInflight: Promise<FcTokenBundle> | null = null;

async function postAuthToken(body: Record<string, unknown>): Promise<FcTokenBundle> {
  const res = await httpJson<FcTokenResponse>(`${ssiBase()}/api/v3/auth/token`, {
    provider: SSI_FASTCONNECT,
    method: "POST",
    timeoutMs: 12_000,
    retries: 1,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || res.data == null) {
    throw new ProviderError(
      `ssi-fastconnect auth: ${res.error ?? "unreachable"}${res.text ? ` (${res.text.slice(0, 140)})` : ""}`,
      SSI_FASTCONNECT,
    );
  }
  const b = res.data;
  if (!b.accessToken) {
    throw new ProviderError(`ssi-fastconnect auth: ${b.msg ?? b.code ?? "no accessToken"}`, SSI_FASTCONNECT);
  }
  const now = Date.now();
  const expiresAt = typeof b.expiresAt === "number" && b.expiresAt > now ? b.expiresAt : now + 3_500_000;
  return {
    accessToken: b.accessToken,
    refreshToken: b.refreshToken ?? null,
    expiresAt,
    refreshExpiresAt: typeof b.refreshExpiresAt === "number" ? b.refreshExpiresAt : null,
  };
}

async function postAuthRefresh(refreshToken: string): Promise<FcTokenBundle> {
  const res = await httpJson<FcTokenResponse>(`${ssiBase()}/api/v3/auth/refresh`, {
    provider: SSI_FASTCONNECT,
    method: "POST",
    timeoutMs: 12_000,
    retries: 1,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok || !res.data?.accessToken) {
    throw new ProviderError("ssi-fastconnect refresh: token expired", SSI_FASTCONNECT);
  }
  const b = res.data;
  const now = Date.now();
  return {
    accessToken: b.accessToken!,
    refreshToken: b.refreshToken ?? null,
    expiresAt: typeof b.expiresAt === "number" && b.expiresAt > now ? b.expiresAt : now + 3_500_000,
    refreshExpiresAt: typeof b.refreshExpiresAt === "number" ? b.refreshExpiresAt : null,
  };
}

function credentials() {
  const apiKey = process.env.SSI_API_KEY?.trim();
  const apiSecret = process.env.SSI_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new ProviderError("ssi-fastconnect: missing SSI_API_KEY / SSI_API_SECRET", SSI_FASTCONNECT);
  }
  return { apiKey, apiSecret };
}

async function fetchTokenBundle(): Promise<FcTokenBundle> {
  // 1) refresh path — cheaper, keeps one long-lived credential session
  if (tokenCache?.refreshToken && Date.now() < (tokenCache.refreshExpiresAt ?? Infinity)) {
    try {
      return await postAuthRefresh(tokenCache.refreshToken);
    } catch {
      /* fall through to full auth */
    }
  }
  // 2) full auth (data-only token — no OTP needed for Market Data)
  const { apiKey, apiSecret } = credentials();
  return postAuthToken({ apiKey, apiSecret });
}

/**
 * Access token for Market Data + data queries. Cached until ~60s before
 * `expiresAt`; single-flight to avoid token storms.
 */
export async function getFcAccessToken(): Promise<string> {
  return (await getFcAccessTokenBundle()).accessToken;
}

/** Token + expiry metadata (the WS engine reconnects before `expiresAt`). */
export async function getFcAccessTokenBundle(): Promise<FcTokenBundle> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache;
  if (!tokenInflight) {
    tokenInflight = (async () => {
      try {
        tokenCache = await fetchTokenBundle();
        return tokenCache;
      } finally {
        tokenInflight = null;
      }
    })();
  }
  return tokenInflight;
}

export function invalidateFcToken() {
  tokenCache = null;
}

/* --------------------------- request plumbing ----------------------------- */

type FcError = { code?: number | string; msg?: string };

async function fcFetch<T>(url: string, timeoutMs: number): Promise<T> {
  const doFetch = async (token: string) =>
    httpJson<T & FcError>(url, {
      provider: SSI_FASTCONNECT,
      timeoutMs,
      retries: 0,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

  const token = await getFcAccessToken();
  let res = await doFetch(token);

  if (!res.ok && (res.status === 401 || res.status === 403)) {
    invalidateFcToken();
    const token2 = await getFcAccessToken();
    res = await doFetch(token2);
  }

  if (!res.ok || res.data == null) {
    const body = res.text ? res.text.slice(0, 160) : "";
    throw new ProviderError(`ssi-fastconnect: ${res.error ?? res.status ?? "unreachable"} ${body}`.trim(), SSI_FASTCONNECT);
  }
  const data = res.data as T & FcError;
  // SSI error envelope: {code, msg}
  if (data && typeof data === "object" && !Array.isArray(data) && "msg" in data && "code" in data && Object.keys(data).length <= 2) {
    throw new ProviderError(`ssi-fastconnect: ${String(data.code)} ${data.msg}`, SSI_FASTCONNECT);
  }
  return data as T;
}

export async function fcGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  timeoutMs = 14_000,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${ssiBase()}${path}${qs.toString() ? `?${qs}` : ""}`;
  return fcFetch<T>(url, timeoutMs);
}

type Paged<T> = {
  pageSize?: number;
  pageIndex?: number;
  pagesCount?: number;
  itemsCount?: number;
  data?: T[];
};

/* ---------------------------- market data -------------------------------- */

export type FcSecurity = {
  symbol: string;
  symbolNameVi: string | null;
  symbolNameEn: string | null;
  board: string | null;
  icbCode: string | null;
  icbName: string | null;
  lotSize: number | null;
  listedShare: number | null;
};

type SecurityRow = {
  symbol?: string;
  symbolNameVi?: string;
  symbolNameEn?: string;
  board?: string;
  icbCode?: string;
  icbName?: string;
  lotSize?: string;
  listedShare?: string;
};

/** GET /api/v3/data/securitiesByBoard — exactly one of symbol | board | index. */
export async function getFcSecuritiesByBoard(
  filter: { board?: string; symbol?: string; index?: string },
): Promise<FcSecurity[]> {
  const rows = await fcGet<SecurityRow[]>("/api/v3/data/securitiesByBoard", {
    board: filter.board,
    symbol: filter.symbol,
    index: filter.index,
  });
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r) => ({
      symbol: String(r.symbol ?? "").toUpperCase(),
      symbolNameVi: r.symbolNameVi ?? null,
      symbolNameEn: r.symbolNameEn ?? null,
      board: r.board ? String(r.board).toUpperCase() : null,
      icbCode: r.icbCode ?? null,
      icbName: r.icbName ?? null,
      lotSize: fcNum(r.lotSize),
      listedShare: fcNum(r.listedShare),
    }))
    .filter((x) => x.symbol);
}

/** Universe across all 3 boards (cached by caller). */
export async function getFcUniverse(): Promise<
  { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]
> {
  const out: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[] = [];
  await Promise.all(
    BOARDS.map(async (board) => {
      try {
        const rows = await getFcSecuritiesByBoard({ board });
        for (const r of rows) {
          out.push({
            symbol: r.symbol,
            name: r.symbolNameVi ?? r.symbolNameEn,
            exchange: r.board ?? board,
            industry: r.icbName,
          });
        }
      } catch {
        /* skip board */
      }
    }),
  );
  if (!out.length) throw new ProviderError("ssi-fastconnect: empty securitiesByBoard universe", SSI_FASTCONNECT);
  return out;
}

export type FcSummaryRow = {
  symbol: string;
  tradingDate: string | null;
  tradingDateMs: number | null;
  priceChange: number | null;
  priceChangePercentage: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  average: number | null;
  totalMatch: number | null;
  totalMatchValue: number | null;
  totalForeignBuy: number | null;
  totalForeignSell: number | null;
  remainForeignRoom: number | null;
  totalForeignRoom: number | null;
};

type SummaryApiRow = {
  symbol?: string;
  tradingDate?: string;
  priceChange?: string;
  priceChangePercentage?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  average?: string;
  totalMatch?: string;
  totalMatchValue?: string;
  totalForeignBuy?: string;
  totalForeignSell?: string;
  remainForeignRoom?: string;
  totalForeignRoom?: string;
};

/**
 * GET /api/v3/data/securitiesSummary — daily trading summary for one symbol
 * (or index). `from`/`to` are YYYY/MM/DD.
 */
export async function getFcSecuritiesSummary(
  target: { symbol?: string; index?: string },
  from: string,
  to: string,
  opts?: { pageIndex?: number; pageSize?: number },
): Promise<FcSummaryRow[]> {
  const body = await fcGet<Paged<SummaryApiRow>>("/api/v3/data/securitiesSummary", {
    symbol: target.symbol,
    index: target.index,
    from,
    to,
    pageIndex: opts?.pageIndex ?? 1,
    pageSize: opts?.pageSize ?? 100,
  });
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(body) ? (body as unknown as SummaryApiRow[]) : [];
  return rows
    .map((r) => ({
      symbol: String(r.symbol ?? target.symbol ?? "").toUpperCase(),
      tradingDate: r.tradingDate ?? null,
      tradingDateMs: parseFcDate(r.tradingDate ?? null, true),
      priceChange: fcNum(r.priceChange),
      priceChangePercentage: fcNum(r.priceChangePercentage),
      open: fcNum(r.open),
      high: fcNum(r.high),
      low: fcNum(r.low),
      close: fcNum(r.close),
      average: fcNum(r.average),
      totalMatch: fcNum(r.totalMatch),
      totalMatchValue: fcNum(r.totalMatchValue),
      totalForeignBuy: fcNum(r.totalForeignBuy),
      totalForeignSell: fcNum(r.totalForeignSell),
      remainForeignRoom: fcNum(r.remainForeignRoom),
      totalForeignRoom: fcNum(r.totalForeignRoom),
    }))
    .filter((x) => x.close != null);
}

export type FcMasterRow = {
  symbol: string;
  exchange: string | null;
  tradingDate: string | null;
  ceiling: number | null;
  floor: number | null;
  refPrice: number | null;
};

/** GET /api/v3/data/masterdata — ceiling/floor/ref for all symbols (paged). */
export async function getFcMasterData(opts?: {
  from?: string;
  to?: string;
  maxPages?: number;
}): Promise<{ rows: FcMasterRow[]; tradingDate: string | null }> {
  const pageSize = 1000;
  const maxPages = opts?.maxPages ?? 4;
  const out: FcMasterRow[] = [];
  let pagesCount = 1;
  let dateSeen: string | null = null;

  for (let page = 1; page <= Math.min(maxPages, pagesCount || 1); page++) {
    const body = await fcGet<Paged<{ symbol?: string; exchange?: string; tradingDate?: string; ceiling?: string; floor?: string; refPrice?: string }>>(
      "/api/v3/data/masterdata",
      { from: opts?.from, to: opts?.to, pageIndex: page, pageSize },
      18_000,
    );
    if (body.pagesCount && body.pagesCount > 0) pagesCount = body.pagesCount;
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const r of rows) {
      const sym = String(r.symbol ?? "").toUpperCase();
      if (!sym) continue;
      if (r.tradingDate) dateSeen = r.tradingDate;
      out.push({
        symbol: sym,
        exchange: r.exchange ? String(r.exchange).toUpperCase() : null,
        tradingDate: r.tradingDate ?? null,
        ceiling: fcNum(r.ceiling),
        floor: fcNum(r.floor),
        refPrice: fcNum(r.refPrice),
      });
    }
    if (rows.length < pageSize) break;
  }

  if (!out.length) throw new ProviderError("ssi-fastconnect: empty masterdata", SSI_FASTCONNECT);
  return { rows: out, tradingDate: dateSeen };
}

let masterCache: { expiresAt: number; bySym: Map<string, FcMasterRow>; tradingDate: string | null } | null = null;
let masterInflight: Promise<{ bySym: Map<string, FcMasterRow>; tradingDate: string | null }> | null = null;

/** Cached master data lookup (15 min TTL — changes once per day). */
export async function getFcMasterMap(): Promise<{
  bySym: Map<string, FcMasterRow>;
  tradingDate: string | null;
}> {
  if (masterCache && masterCache.expiresAt > Date.now()) {
    return { bySym: masterCache.bySym, tradingDate: masterCache.tradingDate };
  }
  if (!masterInflight) {
    masterInflight = (async () => {
      try {
        const { rows, tradingDate } = await getFcMasterData();
        const bySym = new Map(rows.map((r) => [r.symbol, r]));
        masterCache = { expiresAt: Date.now() + 15 * 60_000, bySym, tradingDate };
        return { bySym, tradingDate };
      } finally {
        masterInflight = null;
      }
    })();
  }
  return masterInflight;
}

function summaryToQuote(r: FcSummaryRow, master?: FcMasterRow): Quote | null {
  if (r.close == null || r.close <= 0) return null;
  return {
    symbol: r.symbol,
    assetClass: "stock",
    price: r.close,
    change: r.priceChange,
    changePercent: r.priceChangePercentage,
    open: r.open,
    high: r.high,
    low: r.low,
    volume: r.totalMatch,
    quoteVolume: r.totalMatchValue,
    referencePrice: master?.refPrice ?? null,
    ceilingPrice: master?.ceiling ?? null,
    floorPrice: master?.floor ?? null,
    updatedAt: r.tradingDateMs != null ? new Date(r.tradingDateMs).toISOString() : r.tradingDate,
  };
}

/** Small worker pool — SSI enforces per-key rate limits (X-RATELIMIT-*). */
async function mapPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 8,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** Quotes for a symbol list — securitiesSummary(today) + masterdata bands. */
export async function getFcQuotes(symbols: string[], max = 40): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, max);
  if (!uniq.length) return { quotes: [], sourceTs: null };

  const today = fcDay();
  const master = await getFcMasterMap().catch(() => ({ bySym: new Map<string, FcMasterRow>(), tradingDate: null }));

  const results = await mapPool(uniq, (s) =>
    getFcSecuritiesSummary({ symbol: s }, today, today, { pageSize: 5 }),
  );

  const quotes: Quote[] = [];
  let newest: number | null = null;
  results.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const rows = res.value;
    if (!rows.length) return;
    const latest = rows.reduce((a, b) => ((a.tradingDateMs ?? 0) >= (b.tradingDateMs ?? 0) ? a : b));
    const q = summaryToQuote(latest, master.bySym.get(uniq[i]));
    if (!q) return;
    quotes.push(q);
    if (latest.tradingDateMs != null && (newest == null || latest.tradingDateMs > newest)) newest = latest.tradingDateMs;
  });

  if (!quotes.length) throw new ProviderError("ssi-fastconnect: empty securitiesSummary batch", SSI_FASTCONNECT);
  return { quotes, sourceTs: newest };
}

/** Latest session quote for one symbol (with ceiling/floor/ref). */
export async function getFcQuote(symbol: string): Promise<{ quote: Quote; sourceTs: number | null }> {
  const { quotes, sourceTs } = await getFcQuotes([symbol]);
  const q = quotes[0];
  if (!q) throw new ProviderError(`ssi-fastconnect: no quote for ${symbol}`, SSI_FASTCONNECT);
  return { quote: q, sourceTs };
}

/* ------------------------------- indices --------------------------------- */

export type FcIndexRow = {
  index: string;
  indexName: string | null;
  board: string | null;
};

/** GET /api/v3/data/indexList — all indices, optionally filtered by board. */
export async function getFcIndexList(board?: string): Promise<FcIndexRow[]> {
  const rows = await fcGet<{ index?: string; indexName?: string; board?: string }[]>("/api/v3/data/indexList", {
    board,
  });
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r) => ({
      index: String(r.index ?? "").toUpperCase(),
      indexName: r.indexName ?? null,
      board: r.board ? String(r.board).toUpperCase() : null,
    }))
    .filter((x) => x.index);
}

let indexListCache: { expiresAt: number; rows: FcIndexRow[] } | null = null;

export async function getFcIndexListCached(): Promise<FcIndexRow[]> {
  if (indexListCache && indexListCache.expiresAt > Date.now()) return indexListCache.rows;
  const rows = await getFcIndexList();
  if (rows.length) indexListCache = { expiresAt: Date.now() + 24 * 3_600_000, rows };
  return rows;
}

export type FcIndexSummary = {
  index: string;
  name: string | null;
  tradingDate: string | null;
  tradingDateMs: number | null;
  indexValue: number | null;
  indexChange: number | null;
  indexChangePercentage: number | null;
  totalMatch: number | null;
  totalMatchValue: number | null;
  advances: number | null;
  declines: number | null;
  noChange: number | null;
};

type IndexSummaryApiRow = {
  tradingDate?: string;
  totalTrade?: string;
  totalTradeValue?: string;
  totalMatch?: string;
  totalMatchValue?: string;
  totalDeal?: string;
  totalDealValue?: string;
  indexChange?: string;
  indexChangePercentage?: string;
  indexValue?: string;
  totalAdvanceStock?: string;
  totalCeilingStock?: string;
  totalDeclineStock?: string;
  totalFloorStock?: string;
  totalNoChangeStock?: string;
};

/** GET /api/v3/data/indexSummary — by index code (one trading date). */
export async function getFcIndexSummary(index: string, tradingDate?: string): Promise<FcIndexSummary | null> {
  const rows = await fcGet<IndexSummaryApiRow[]>("/api/v3/data/indexSummary", {
    index,
    tradingDate,
  });
  const list = Array.isArray(rows) ? rows : [];
  const r = list[0];
  if (!r) return null;
  const value = fcNum(r.indexValue);
  if (value == null) return null;
  return {
    index: index.toUpperCase(),
    name: null,
    tradingDate: r.tradingDate ?? null,
    tradingDateMs: parseFcDate(r.tradingDate ?? null, true),
    indexValue: value,
    indexChange: fcNum(r.indexChange),
    indexChangePercentage: fcNum(r.indexChangePercentage),
    totalMatch: fcNum(r.totalMatch),
    totalMatchValue: fcNum(r.totalMatchValue),
    advances: fcNum(r.totalAdvanceStock),
    declines: fcNum(r.totalDeclineStock),
    noChange: fcNum(r.totalNoChangeStock),
  };
}

/** Map SSI index codes → platform-canonical codes (VNINDEX/VN30/HNX/UPCOM…). */
export const FC_INDEX_CANONICAL: Record<string, string> = {
  VNINDEX: "VNINDEX",
  VN30: "VN30",
  VN100: "VN100",
  HNXINDEX: "HNX",
  "HNX-INDEX": "HNX",
  HNX: "HNX",
  HNX30: "HNX30",
  UPCOMINDEX: "UPCOM",
  "UPCOM-INDEX": "UPCOM",
  UPCOM: "UPCOM",
};

/** Resolve priority index codes against the live indexList (tolerant aliases). */
export async function resolveFcIndexCodes(): Promise<{ code: string; canonical: string; name: string | null }[]> {
  const aliases: Record<string, string[]> = {
    VNINDEX: ["VNINDEX", "VN-INDEX"],
    VN30: ["VN30"],
    VN100: ["VN100"],
    HNXINDEX: ["HNXINDEX", "HNX-INDEX", "HNX"],
    HNX30: ["HNX30"],
    UPCOMINDEX: ["UPCOMINDEX", "UPCOM-INDEX", "UPCOM"],
  };
  let list: FcIndexRow[] = [];
  try {
    list = await getFcIndexListCached();
  } catch {
    /* offline discovery — fall back to core codes */
  }
  const out: { code: string; canonical: string; name: string | null }[] = [];
  for (const core of CORE_INDEX_CODES) {
    const candidates = aliases[core] ?? [core];
    const hit = list.find((r) => candidates.includes(r.index));
    const code = hit ? hit.index : core;
    out.push({ code, canonical: FC_INDEX_CANONICAL[code] ?? code, name: hit?.indexName ?? null });
  }
  return out;
}

/** Index quotes for the core VN indices (codes normalized to platform-canonical). */
export async function getFcIndices(codes?: string[]): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const resolved = await resolveFcIndexCodes();
  const wantedNorm = codes?.length ? codes.map((c) => (FC_INDEX_CANONICAL[c.toUpperCase()] ?? c).toUpperCase()) : null;
  const wanted = wantedNorm
    ? resolved.filter((r) => wantedNorm.includes(r.canonical))
    : resolved;

  const results = await mapPool(wanted, (w) => getFcIndexSummary(w.code), 4);
  const items: IndexQuote[] = [];
  let newest: number | null = null;
  results.forEach((res, i) => {
    if (res.status !== "fulfilled" || !res.value) return;
    const s = res.value;
    items.push({
      code: wanted[i].canonical,
      name: wanted[i].name ?? wanted[i].canonical,
      value: s.indexValue ?? 0,
      change: s.indexChange ?? 0,
      changePercent: s.indexChangePercentage ?? 0,
      volume: s.totalMatch,
      updatedAt: s.tradingDateMs != null ? new Date(s.tradingDateMs).toISOString() : s.tradingDate,
    });
    if (s.tradingDateMs != null && (newest == null || s.tradingDateMs > newest)) newest = s.tradingDateMs;
  });

  if (!items.length) throw new ProviderError("ssi-fastconnect: empty indexSummary", SSI_FASTCONNECT);
  return { items, sourceTs: newest };
}

/* --------------------------------- OHLC ---------------------------------- */

type OhlcApiRow = {
  symbol?: string;
  tradingDate?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  value?: string;
};

export type FcTimeFrame = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "1d";

/**
 * GET /api/v3/data/ohlc — OHLCV bars. Daily covers full listing history;
 * intraday covers the last 12 months. Pages transparently (max 4 pages).
 */
export async function getFcOhlc(
  symbol: string,
  opts?: { from?: string; to?: string; timeFrame?: FcTimeFrame; pageIndex?: number; pageSize?: number },
): Promise<OhlcvBar[]> {
  const intraday = opts?.timeFrame != null && opts.timeFrame !== "1d";
  const from = opts?.from ?? (intraday ? `${daysAgoFc(30)} 00:00:00` : daysAgoFc(400));
  const to = opts?.to ?? (intraday ? fcDayTime() : fcDay());
  const pageSize = opts?.pageSize ?? 1000;

  const rows: OhlcApiRow[] = [];
  const maxPages = opts?.pageIndex ? 1 : 4;
  for (let page = opts?.pageIndex ?? 1; page <= (opts?.pageIndex ?? maxPages); page++) {
    const body = await fcGet<Paged<OhlcApiRow>>("/api/v3/data/ohlc", {
      symbol: symbol.toUpperCase(),
      from,
      to,
      timeFrame: opts?.timeFrame,
      pageIndex: page,
      pageSize,
    });
    const pageRows = Array.isArray(body.data) ? body.data : Array.isArray(body) ? (body as unknown as OhlcApiRow[]) : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    if (opts?.pageIndex) break; // explicit single-page request
  }
  const bars = rows
    .map((r): OhlcvBar | null => {
      const t = parseFcDate(r.tradingDate ?? null, !intraday);
      const o = fcNum(r.open);
      const h = fcNum(r.high);
      const l = fcNum(r.low);
      const c = fcNum(r.close);
      if (t == null || o == null || h == null || l == null || c == null) return null;
      return { time: t, open: o, high: h, low: l, close: c, volume: fcNum(r.volume) ?? 0 };
    })
    .filter((x): x is OhlcvBar => x != null)
    .sort((a, b) => a.time - b.time);

  if (!bars.length) throw new ProviderError(`ssi-fastconnect: empty ohlc for ${symbol}`, SSI_FASTCONNECT);
  return bars;
}

/** Daily OHLCV convenience wrapper (drop-in for the legacy DailyOhlc path). */
export async function getFcDailyOhlc(symbol: string, opts?: { fromDate?: string; toDate?: string }): Promise<OhlcvBar[]> {
  return getFcOhlc(symbol, { from: opts?.fromDate, to: opts?.toDate, timeFrame: "1d", pageSize: 1000 });
}

/* -------------------------------- probe ---------------------------------- */

export async function probeSsiFastConnect(): Promise<{ configured: boolean; ok: boolean; message: string }> {
  if (!ssiFastConfigured()) {
    return { configured: false, ok: false, message: "SSI_API_KEY / SSI_API_SECRET chưa được cấu hình" };
  }
  try {
    await getFcAccessToken();
    return { configured: true, ok: true, message: "auth/token OK (FastConnect v3)" };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : "auth failed" };
  }
}

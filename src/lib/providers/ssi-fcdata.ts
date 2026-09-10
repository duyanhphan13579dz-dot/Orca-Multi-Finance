import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * SSI FastConnect Data (FC Data) — full market REST adapter.
 * PrivateKey not required (FC Trading only).
 */

export const SSI_FCDATA = "ssi-fcdata";

const DEFAULT_BASE = "https://fc-data.ssi.com.vn";
const MARKETS = ["HOSE", "HNX", "UPCOM"] as const;
const CORE_INDICES = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VN100"] as const;

function baseUrl(): string {
  return (process.env.SSI_FC_DATA_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

export function ssiFcConfigured(): boolean {
  return Boolean(process.env.SSI_FC_CONSUMER_ID?.trim() && process.env.SSI_FC_CONSUMER_SECRET?.trim());
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseSsiDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = String(d).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const t = Date.parse(d);
    return Number.isFinite(t) ? t : null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const t = Date.parse(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T15:00:00+07:00`,
  );
  return Number.isFinite(t) ? t : null;
}

function formatSsiDate(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

function daysAgoSsi(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return formatSsiDate(d);
}

export function ssiToday(): string {
  return formatSsiDate();
}

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

let tokenCache: TokenBundle | null = null;
let tokenInflight: Promise<string> | null = null;

type AccessTokenResponse = {
  status?: number | string;
  message?: string;
  data?: {
    accessToken?: string;
    access_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    expiresIn?: number;
    expires_in?: number;
  };
  accessToken?: string;
  access_token?: string;
};

async function fetchAccessToken(): Promise<TokenBundle> {
  const consumerID = process.env.SSI_FC_CONSUMER_ID?.trim();
  const consumerSecret = process.env.SSI_FC_CONSUMER_SECRET?.trim();
  if (!consumerID || !consumerSecret) {
    throw new ProviderError("ssi-fcdata: missing SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET", SSI_FCDATA);
  }

  const url = `${baseUrl()}/api/v2/Market/AccessToken`;
  const res = await httpJson<AccessTokenResponse>(url, {
    provider: SSI_FCDATA,
    method: "POST",
    timeoutMs: 12_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      consumerID,
      consumerSecret,
      ConsumerID: consumerID,
      ConsumerSecret: consumerSecret,
    }),
  });

  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-fcdata auth: ${res.error ?? "unreachable"}`, SSI_FCDATA);
  }

  const body = res.data;
  const data = body.data ?? body;
  const access =
    (typeof data === "object" && data && "accessToken" in data
      ? (data as { accessToken?: string }).accessToken
      : undefined) ??
    (typeof data === "object" && data && "access_token" in data
      ? (data as { access_token?: string }).access_token
      : undefined) ??
    body.accessToken ??
    body.access_token;

  if (!access) {
    throw new ProviderError(
      `ssi-fcdata auth: no accessToken (${body.message ?? body.status ?? "empty"})`,
      SSI_FCDATA,
    );
  }

  const expiresIn =
    (typeof data === "object" && data && "expiresIn" in data
      ? Number((data as { expiresIn?: number }).expiresIn)
      : NaN) ||
    (typeof data === "object" && data && "expires_in" in data
      ? Number((data as { expires_in?: number }).expires_in)
      : NaN) ||
    3000;

  const refresh =
    (typeof data === "object" && data && "refreshToken" in data
      ? (data as { refreshToken?: string }).refreshToken
      : undefined) ??
    (typeof data === "object" && data && "refresh_token" in data
      ? (data as { refresh_token?: string }).refresh_token
      : undefined);

  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
}

export async function getSsiAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    try {
      tokenCache = await fetchAccessToken();
      return tokenCache.accessToken;
    } finally {
      tokenInflight = null;
    }
  })();
  return tokenInflight;
}

export function invalidateSsiToken() {
  tokenCache = null;
}

async function ssiGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  timeoutMs = 14_000,
): Promise<T> {
  const token = await getSsiAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${baseUrl()}${path}${qs.toString() ? `?${qs}` : ""}`;

  const res = await httpJson<T>(url, {
    provider: SSI_FCDATA,
    timeoutMs,
    retries: 0,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok && (res.status === 401 || String(res.error).includes("401"))) {
    invalidateSsiToken();
    const token2 = await getSsiAccessToken();
    const res2 = await httpJson<T>(url, {
      provider: SSI_FCDATA,
      timeoutMs,
      retries: 0,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token2}`,
      },
    });
    if (!res2.ok || res2.data == null) {
      throw new ProviderError(`ssi-fcdata: ${res2.error ?? "unauthorized"}`, SSI_FCDATA);
    }
    return res2.data;
  }

  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-fcdata: ${res.error ?? "unreachable"}`, SSI_FCDATA);
  }
  return res.data;
}

type SsiEnvelope<T> = {
  status?: number | string;
  message?: string;
  totalRecord?: number;
  data?: T;
};

type DailyOhlcRow = {
  Symbol?: string;
  Market?: string;
  TradingDate?: string;
  Time?: string | null;
  Open?: string | number;
  High?: string | number;
  Low?: string | number;
  Close?: string | number;
  Volume?: string | number;
  Value?: string | number;
};

export async function getSsiDailyOhlc(
  symbol: string,
  opts?: { fromDate?: string; toDate?: string; pageSize?: number },
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase();
  const fromDate = opts?.fromDate ?? daysAgoSsi(400);
  const toDate = opts?.toDate ?? formatSsiDate();
  const pageSize = opts?.pageSize ?? 1000;

  const body = await ssiGet<SsiEnvelope<DailyOhlcRow[]>>("/api/v2/Market/DailyOhlc", {
    Symbol: sym,
    symbol: sym,
    FromDate: fromDate,
    fromDate,
    ToDate: toDate,
    toDate,
    PageIndex: 1,
    pageIndex: 1,
    PageSize: pageSize,
    pageSize,
    Ascending: true,
    ascending: true,
  });

  const rows = Array.isArray(body.data) ? body.data : [];
  const bars = rows
    .map((r): OhlcvBar | null => {
      const t = parseSsiDate(r.TradingDate ?? null);
      const o = num(r.Open);
      const h = num(r.High);
      const l = num(r.Low);
      const c = num(r.Close);
      if (t == null || o == null || h == null || l == null || c == null) return null;
      return { time: t, open: o, high: h, low: l, close: c, volume: num(r.Volume) ?? 0 };
    })
    .filter((x): x is OhlcvBar => x != null)
    .sort((a, b) => a.time - b.time);

  if (!bars.length) throw new ProviderError(`ssi-fcdata: empty DailyOhlc for ${sym}`, SSI_FCDATA);
  return bars;
}

type DailyStockPriceRow = {
  TradingDate?: string;
  Tradingdate?: string;
  Symbol?: string;
  Price?: string | number;
  OpenPrice?: string | number;
  Openprice?: string | number;
  HighestPrice?: string | number;
  Highestprice?: string | number;
  LowestPrice?: string | number;
  Lowestprice?: string | number;
  ClosePrice?: string | number;
  Closeprice?: string | number;
  AveragePrice?: string | number;
  TotalVol?: string | number;
  Totalmatchvol?: string | number;
  TotalVal?: string | number;
  Totalmatchval?: string | number;
  Change?: string | number;
  Pricechange?: string | number;
  PerChange?: string | number;
  Perpricechange?: string | number;
  CeilingPrice?: string | number;
  Ceilingprice?: string | number;
  FloorPrice?: string | number;
  Floorprice?: string | number;
  RefPrice?: string | number;
  Refprice?: string | number;
  BasicPrice?: string | number;
};

function rowToQuote(r: DailyStockPriceRow, fallbackSym?: string): Quote | null {
  const price = num(r.ClosePrice) ?? num(r.Closeprice) ?? num(r.Price);
  if (price == null || price <= 0) return null;
  const sym = String(r.Symbol ?? fallbackSym ?? "").toUpperCase();
  if (!sym) return null;
  return {
    symbol: sym,
    assetClass: "stock",
    price,
    change: num(r.Change) ?? num(r.Pricechange),
    changePercent: num(r.PerChange) ?? num(r.Perpricechange),
    open: num(r.OpenPrice) ?? num(r.Openprice),
    high: num(r.HighestPrice) ?? num(r.Highestprice),
    low: num(r.LowestPrice) ?? num(r.Lowestprice),
    volume: num(r.TotalVol) ?? num(r.Totalmatchvol),
    quoteVolume: num(r.TotalVal) ?? num(r.Totalmatchval),
    referencePrice: num(r.RefPrice) ?? num(r.Refprice) ?? num(r.BasicPrice),
    ceilingPrice: num(r.CeilingPrice) ?? num(r.Ceilingprice),
    floorPrice: num(r.FloorPrice) ?? num(r.Floorprice),
    updatedAt: r.TradingDate ?? r.Tradingdate ?? null,
  };
}

export async function getSsiDailyStockPrice(
  symbol: string,
  opts?: { fromDate?: string; toDate?: string },
): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const sym = symbol.toUpperCase();
  const fromDate = opts?.fromDate ?? formatSsiDate();
  const toDate = opts?.toDate ?? formatSsiDate();

  const body = await ssiGet<SsiEnvelope<DailyStockPriceRow[]>>("/api/v2/Market/DailyStockPrice", {
    Symbol: sym,
    symbol: sym,
    FromDate: fromDate,
    fromDate,
    ToDate: toDate,
    toDate,
    PageIndex: 1,
    pageIndex: 1,
    PageSize: 50,
    pageSize: 50,
  });

  const rows = Array.isArray(body.data) ? body.data : [];
  let newest: number | null = null;
  const quotes: Quote[] = [];
  for (const r of rows) {
    const q = rowToQuote(r, sym);
    if (!q) continue;
    const t = parseSsiDate(q.updatedAt);
    if (t != null && (newest == null || t > newest)) newest = t;
    quotes.push(q);
  }

  if (!quotes.length) throw new ProviderError(`ssi-fcdata: empty DailyStockPrice for ${sym}`, SSI_FCDATA);
  return { quotes, sourceTs: newest };
}

const dayBoardCache = new Map<
  string,
  { expiresAt: number; bySym: Map<string, Quote>; sourceTs: number | null }
>();
const dayBoardInflight = new Map<
  string,
  Promise<{ bySym: Map<string, Quote>; sourceTs: number | null }>
>();

async function fetchMarketDayPage(
  market: string,
  fromDate: string,
  toDate: string,
  pageIndex: number,
): Promise<DailyStockPriceRow[]> {
  const body = await ssiGet<SsiEnvelope<DailyStockPriceRow[]>>(
    "/api/v2/Market/DailyStockPrice",
    {
      Market: market,
      market,
      FromDate: fromDate,
      fromDate,
      ToDate: toDate,
      toDate,
      PageIndex: pageIndex,
      pageIndex,
      PageSize: 1000,
      pageSize: 1000,
    },
    18_000,
  );
  return Array.isArray(body.data) ? body.data : [];
}

async function loadDayBoard(fromDate: string, toDate: string): Promise<{
  bySym: Map<string, Quote>;
  sourceTs: number | null;
}> {
  const key = `${fromDate}|${toDate}`;
  const hit = dayBoardCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { bySym: hit.bySym, sourceTs: hit.sourceTs };

  const inflight = dayBoardInflight.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    const bySym = new Map<string, Quote>();
    let newest: number | null = null;

    await Promise.all(
      MARKETS.map(async (market) => {
        try {
          const pages = await Promise.all([
            fetchMarketDayPage(market, fromDate, toDate, 1),
            fetchMarketDayPage(market, fromDate, toDate, 2).catch(() => [] as DailyStockPriceRow[]),
          ]);
          for (const rows of pages) {
            for (const r of rows) {
              const q = rowToQuote(r);
              if (!q) continue;
              const prev = bySym.get(q.symbol);
              const t = parseSsiDate(q.updatedAt) ?? 0;
              const pt = prev?.updatedAt ? parseSsiDate(prev.updatedAt) ?? 0 : 0;
              if (!prev || t >= pt) bySym.set(q.symbol, q);
              if (t > 0 && (newest == null || t > newest)) newest = t;
            }
          }
        } catch {
          /* skip market */
        }
      }),
    );

    dayBoardCache.set(key, {
      expiresAt: Date.now() + 12_000,
      bySym,
      sourceTs: newest,
    });
    return { bySym, sourceTs: newest };
  })();

  dayBoardInflight.set(key, p);
  try {
    return await p;
  } finally {
    dayBoardInflight.delete(key);
  }
}

export async function getSsiQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return { quotes: [], sourceTs: null };

  const today = formatSsiDate();
  const board = await loadDayBoard(today, today);
  const quotes: Quote[] = [];
  const missing: string[] = [];

  for (const s of uniq) {
    const q = board.bySym.get(s);
    if (q) quotes.push(q);
    else missing.push(s);
  }

  if (missing.length) {
    const chunk = missing.slice(0, 8);
    const results = await Promise.allSettled(chunk.map((s) => getSsiDailyStockPrice(s)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const sorted = [...r.value.quotes].sort((a, b) => {
        const ta = a.updatedAt ? parseSsiDate(a.updatedAt) ?? 0 : 0;
        const tb = b.updatedAt ? parseSsiDate(b.updatedAt) ?? 0 : 0;
        return tb - ta;
      });
      if (sorted[0]) quotes.push(sorted[0]);
    }
  }

  if (!quotes.length) throw new ProviderError("ssi-fcdata: empty quotes batch", SSI_FCDATA);
  return { quotes, sourceTs: board.sourceTs };
}

/** Full market board from SSI DailyStockPrice (all 3 floors). */
export async function getSsiFullBoard(): Promise<{
  quotes: Quote[];
  sessionDate: string;
  sourceTs: number | null;
}> {
  const today = formatSsiDate();
  const board = await loadDayBoard(today, today);
  if (!board.bySym.size) throw new ProviderError("ssi-fcdata: empty full board", SSI_FCDATA);
  return {
    quotes: [...board.bySym.values()],
    sessionDate: today,
    sourceTs: board.sourceTs,
  };
}

type DailyIndexRow = {
  IndexCode?: string;
  Indexcode?: string;
  IndexName?: string;
  IndexValue?: string | number;
  Change?: string | number;
  RatioChange?: string | number;
  Totalmatchvol?: string | number;
  Totalvol?: string | number;
  TotalQtty?: string | number;
  TradingDate?: string;
  "Trading Date"?: string;
  Time?: string;
};

export async function getSsiIndices(
  codes: string[] = [...CORE_INDICES],
): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const today = formatSsiDate();
  const uniq = [...new Set(codes.map((c) => c.toUpperCase()))];

  const results = await Promise.allSettled(
    uniq.map(async (code) => {
      const body = await ssiGet<SsiEnvelope<DailyIndexRow[]>>("/api/v2/Market/DailyIndex", {
        IndexId: code,
        indexId: code,
        FromDate: today,
        fromDate: today,
        ToDate: today,
        toDate: today,
        PageIndex: 1,
        pageIndex: 1,
        PageSize: 5,
        pageSize: 5,
        Ascending: false,
        ascending: false,
      });
      const rows = Array.isArray(body.data) ? body.data : [];
      const r = rows[0];
      if (!r) return null;
      const value = num(r.IndexValue);
      if (value == null) return null;
      const idxCode = String(r.IndexCode ?? r.Indexcode ?? code).toUpperCase();
      const updated =
        r.TradingDate ?? (r as { "Trading Date"?: string })["Trading Date"] ?? today;
      return {
        item: {
          code: idxCode,
          name: r.IndexName ?? idxCode,
          value,
          change: num(r.Change) ?? 0,
          changePercent: num(r.RatioChange) ?? 0,
          volume: num(r.Totalmatchvol) ?? num(r.Totalvol) ?? num(r.TotalQtty),
          updatedAt: updated,
        } satisfies IndexQuote,
        ts: parseSsiDate(updated),
      };
    }),
  );

  const items: IndexQuote[] = [];
  let newest: number | null = null;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    items.push(r.value.item);
    if (r.value.ts != null && (newest == null || r.value.ts > newest)) newest = r.value.ts;
  }

  if (!items.length) throw new ProviderError("ssi-fcdata: empty DailyIndex", SSI_FCDATA);
  return { items, sourceTs: newest };
}

type SecuritiesRow = {
  market?: string;
  Market?: string;
  symbol?: string;
  Symbol?: string;
  StockName?: string;
  StockEnName?: string;
};

export async function getSsiUniverse(): Promise<
  { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]
> {
  const out: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[] =
    [];

  await Promise.all(
    MARKETS.map(async (market) => {
      try {
        for (let page = 1; page <= 5; page++) {
          const body = await ssiGet<SsiEnvelope<SecuritiesRow[]>>("/api/v2/Market/Securities", {
            Market: market,
            market,
            PageIndex: page,
            pageIndex: page,
            PageSize: 1000,
            pageSize: 1000,
          });
          const rows = Array.isArray(body.data) ? body.data : [];
          if (!rows.length) break;
          for (const r of rows) {
            const symbol = String(r.symbol ?? r.Symbol ?? "").toUpperCase();
            if (!symbol) continue;
            out.push({
              symbol,
              name: r.StockName ?? r.StockEnName ?? null,
              exchange: String(r.market ?? r.Market ?? market).toUpperCase(),
              industry: null,
            });
          }
          if (rows.length < 1000) break;
        }
      } catch {
        /* skip */
      }
    }),
  );

  if (!out.length) throw new ProviderError("ssi-fcdata: empty Securities universe", SSI_FCDATA);
  return out;
}

type IndexListRow = {
  IndexCode?: string;
  IndexName?: string;
  ExchangeCode?: string;
};

export async function getSsiIndexList(): Promise<{ code: string; name: string | null }[]> {
  const body = await ssiGet<SsiEnvelope<IndexListRow[]>>("/api/v2/Market/IndexList", {
    Exchange: "HOSE",
    exchange: "HOSE",
    PageIndex: 1,
    pageIndex: 1,
    PageSize: 100,
    pageSize: 100,
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows
    .map((r) => ({
      code: String(r.IndexCode ?? "").toUpperCase(),
      name: r.IndexName ?? null,
    }))
    .filter((x) => x.code);
}

export async function probeSsiFcData(): Promise<{
  configured: boolean;
  ok: boolean;
  message: string;
}> {
  if (!ssiFcConfigured()) {
    return { configured: false, ok: false, message: "SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET chưa set" };
  }
  try {
    await getSsiAccessToken();
    return { configured: true, ok: true, message: "Auth token OK" };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      message: e instanceof Error ? e.message : "auth failed",
    };
  }
}

import "server-only";
import { httpJson } from "../http";
import { ssiConsumerId, ssiConsumerSecret, ssiCredentialsConfigured } from "./ssi-credentials";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * SSI FastConnect Data (FC Data) — full market REST adapter.
 * Credentials: SSI_API_KEY+SSI_API_SECRET or SSI_FC_CONSUMER_ID+SSI_FC_CONSUMER_SECRET
 */

export const SSI_FCDATA = "ssi-fcdata";

const DEFAULT_BASE = "https://fc-data.ssi.com.vn";
const MARKETS = ["HOSE", "HNX", "UPCOM"] as const;
const CORE_INDICES = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VN100"] as const;

function baseUrl(): string {
  return (process.env.SSI_FC_DATA_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

export function ssiFcConfigured(): boolean {
  return ssiCredentialsConfigured();
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
  // Official SSI FC Data body: only consumerID + consumerSecret (camelCase).
  const consumerID = ssiConsumerId().trim();
  const consumerSecret = ssiConsumerSecret().trim();
  if (!consumerID || !consumerSecret) {
    throw new ProviderError(
      "ssi-fcdata: missing credentials (set SSI_API_KEY + SSI_API_SECRET or SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET)",
      SSI_FCDATA,
    );
  }

  const url = `${baseUrl()}/api/v2/Market/AccessToken`;
  const res = await httpJson<AccessTokenResponse>(url, {
    provider: `${SSI_FCDATA}-auth`,
    method: "POST",
    timeoutMs: 12_000,
    retries: 0,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      consumerID,
      consumerSecret,
    }),
  });

  if (!res.ok || res.data == null) {
    let detail = res.error ?? "unreachable";
    if (res.text) {
      try {
        const parsed = JSON.parse(res.text) as { message?: string; status?: number };
        if (parsed?.message) detail = `${detail}: ${parsed.message}`;
      } catch {
        if (res.text.length < 200) detail = `${detail}: ${res.text}`;
      }
    }
    if (res.status === 400) {
      detail =
        `${detail} — kiểm tra ConsumerID/Secret là key FastConnect **Data** (không phải Trading), ` +
        `không khoảng trắng thừa, tạo key tại iBoard API service`;
    }
    throw new ProviderError(`ssi-fcdata auth: ${detail}`, SSI_FCDATA);
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
  Symbol?: string;
  TradingDate?: string;
  Open?: string | number;
  High?: string | number;
  Low?: string | number;
  Close?: string | number;
  Volume?: string | number;
  Change?: string | number;
  PerChange?: string | number;
  CeilingPrice?: string | number;
  FloorPrice?: string | number;
  RefPrice?: string | number;
  [k: string]: unknown;
};

function rowToQuote(r: DailyStockPriceRow, fallbackSym?: string): Quote | null {
  const last = num(r.Close);
  if (last == null) return null;
  const sym = String(r.Symbol ?? fallbackSym ?? "").toUpperCase();
  if (!sym) return null;
  const t = parseSsiDate(r.TradingDate ?? null) ?? Date.now();
  return {
    symbol: sym,
    price: last,
    change: num(r.Change),
    changePercent: num(r.PerChange),
    open: num(r.Open),
    high: num(r.High),
    low: num(r.Low),
    volume: num(r.Volume),
    source: SSI_FCDATA,
    asOf: new Date(t).toISOString(),
  } as Quote;
}

export async function getSsiDailyStockPrice(
  symbol: string,
): Promise<Quote[]> {
  const sym = symbol.toUpperCase();
  const body = await ssiGet<SsiEnvelope<DailyStockPriceRow[]>>("/api/v2/Market/DailyStockPrice", {
    Symbol: sym,
    symbol: sym,
    pageIndex: 1,
    PageIndex: 1,
    pageSize: 20,
    PageSize: 20,
    FromDate: ssiToday(),
    fromDate: ssiToday(),
    ToDate: ssiToday(),
    toDate: ssiToday(),
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  const quotes = rows.map((r) => rowToQuote(r, sym)).filter((x): x is Quote => x != null);
  if (!quotes.length) throw new ProviderError(`ssi-fcdata: empty DailyStockPrice for ${sym}`, SSI_FCDATA);
  return quotes;
}

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
  );
  return Array.isArray(body.data) ? body.data : [];
}

export async function getSsiQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const quotes: Quote[] = [];
  const chunkSize = 8;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const results = await Promise.allSettled(chunk.map((s) => getSsiDailyStockPrice(s)));
    for (const r of results) {
      if (r.status === "fulfilled") quotes.push(...r.value);
    }
  }
  if (!quotes.length) throw new ProviderError("ssi-fcdata: empty quotes batch", SSI_FCDATA);
  return { quotes, sourceTs: Date.now() };
}

export async function getSsiFullBoard(): Promise<{
  bySym: Map<string, Quote>;
  sourceTs: number;
}> {
  const bySym = new Map<string, Quote>();
  const today = ssiToday();
  for (const market of MARKETS) {
    try {
      const rows = await fetchMarketDayPage(market, today, today, 1);
      for (const r of rows) {
        const q = rowToQuote(r);
        if (q) bySym.set(q.symbol, q);
      }
    } catch {
      /* soft */
    }
  }
  if (!bySym.size) throw new ProviderError("ssi-fcdata: empty full board", SSI_FCDATA);
  return { bySym, sourceTs: Date.now() };
}

type DailyIndexRow = {
  IndexCode?: string;
  IndexName?: string;
  TradingDate?: string;
  IndexValue?: string | number;
  Change?: string | number;
  PerChange?: string | number;
  [k: string]: unknown;
};

export async function getSsiIndices(
  codes: string[] = [...CORE_INDICES],
): Promise<IndexQuote[]> {
  const items: IndexQuote[] = [];
  for (const code of codes) {
    try {
      const body = await ssiGet<SsiEnvelope<DailyIndexRow[]>>("/api/v2/Market/DailyIndex", {
        IndexId: code,
        indexId: code,
        FromDate: ssiToday(),
        fromDate: ssiToday(),
        ToDate: ssiToday(),
        toDate: ssiToday(),
        PageIndex: 1,
        pageIndex: 1,
        PageSize: 10,
        pageSize: 10,
      });
      const rows = Array.isArray(body.data) ? body.data : [];
      for (const r of rows) {
        const val = num(r.IndexValue);
        if (val == null) continue;
        items.push({
          code: String(r.IndexCode ?? code).toUpperCase(),
          name: r.IndexName != null ? String(r.IndexName) : code,
          value: val,
          change: num(r.Change),
          changePercent: num(r.PerChange),
          source: SSI_FCDATA,
          asOf: new Date().toISOString(),
        } as IndexQuote);
      }
    } catch {
      /* soft */
    }
  }
  if (!items.length) throw new ProviderError("ssi-fcdata: empty DailyIndex", SSI_FCDATA);
  return items;
}

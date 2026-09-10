import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * SSI FastConnect Data (FC Data) — market REST adapter.
 *
 * Docs:
 *   https://developers.ssi.com.vn/
 *   https://guide.ssi.com.vn/ssi-products/fastconnect-data/api-specs
 *
 * Env (set on Vercel when keys arrive):
 *   SSI_FC_CONSUMER_ID      (ConsumerID)
 *   SSI_FC_CONSUMER_SECRET  (ConsumerSecret)
 *   SSI_FC_DATA_BASE_URL    optional, default https://fc-data.ssi.com.vn
 *
 * Strategy: PRIMARY when configured; callers fall back to VNDirect.
 * No trading endpoints here — market data only.
 */

export const SSI_FCDATA = "ssi-fcdata";

const DEFAULT_BASE = "https://fc-data.ssi.com.vn";

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

/** Parse dd/mm/yyyy → epoch ms (session close +07). */
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
  const t = Date.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T15:00:00+07:00`);
  return Number.isFinite(t) ? t : null;
}

function formatSsiDate(d = new Date()): string {
  // VN calendar day
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

// ─── Token cache (process memory; fine for serverless warm instances) ─────────

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms when we should refresh (skew-safe) */
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

  // FC Data classic: POST Market/AccessToken with consumer credentials
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
      // alternate casings some client samples use
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
      `ssi-fcdata auth: no accessToken in response (${body.message ?? body.status ?? "empty"})`,
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
    3000; // SSI samples often ~1h; default conservative

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
    // refresh 60s early
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
}

async function getAccessToken(): Promise<string> {
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

/** Force drop cached token (e.g. after 401). */
export function invalidateSsiToken() {
  tokenCache = null;
}

async function ssiGet<T>(path: string, query: Record<string, string | number | boolean | undefined>, timeoutMs = 14_000): Promise<T> {
  const token = await getAccessToken();
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

  // One retry on unauthorized — token may have expired mid-flight
  if (!res.ok && (res.status === 401 || String(res.error).includes("401"))) {
    invalidateSsiToken();
    const token2 = await getAccessToken();
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

// ─── Public market helpers ────────────────────────────────────────────────────

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
  Symbol?: string;
  Price?: string | number;
  OpenPrice?: string | number;
  HighestPrice?: string | number;
  LowestPrice?: string | number;
  ClosePrice?: string | number;
  AveragePrice?: string | number;
  TotalVol?: string | number;
  TotalVal?: string | number;
  Change?: string | number;
  PerChange?: string | number;
  CeilingPrice?: string | number;
  FloorPrice?: string | number;
  RefPrice?: string | number;
  BasicPrice?: string | number;
};

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
  const quotes = rows
    .map((r): Quote | null => {
      const price = num(r.ClosePrice) ?? num(r.Price);
      if (price == null || price <= 0) return null;
      const t = parseSsiDate(r.TradingDate ?? null);
      if (t != null && (newest == null || t > newest)) newest = t;
      return {
        symbol: String(r.Symbol ?? sym).toUpperCase(),
        assetClass: "stock" as const,
        price,
        change: num(r.Change),
        changePercent: num(r.PerChange),
        open: num(r.OpenPrice),
        high: num(r.HighestPrice),
        low: num(r.LowestPrice),
        volume: num(r.TotalVol),
        quoteVolume: num(r.TotalVal),
        referencePrice: num(r.RefPrice) ?? num(r.BasicPrice),
        ceilingPrice: num(r.CeilingPrice),
        floorPrice: num(r.FloorPrice),
        updatedAt: r.TradingDate ?? null,
      };
    })
    .filter((x): x is Quote => x != null);

  if (!quotes.length) throw new ProviderError(`ssi-fcdata: empty DailyStockPrice for ${sym}`, SSI_FCDATA);
  return { quotes, sourceTs: newest };
}

export async function getSsiQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!uniq.length) return { quotes: [], sourceTs: null };

  const results = await Promise.allSettled(uniq.map((s) => getSsiDailyStockPrice(s)));
  const quotes: Quote[] = [];
  let newest: number | null = null;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    // take latest row per symbol
    const sorted = [...r.value.quotes].sort((a, b) => {
      const ta = a.updatedAt ? parseSsiDate(a.updatedAt) ?? 0 : 0;
      const tb = b.updatedAt ? parseSsiDate(b.updatedAt) ?? 0 : 0;
      return tb - ta;
    });
    if (sorted[0]) quotes.push(sorted[0]);
    if (r.value.sourceTs != null && (newest == null || r.value.sourceTs > newest)) newest = r.value.sourceTs;
  }
  if (!quotes.length) throw new ProviderError("ssi-fcdata: empty quotes batch", SSI_FCDATA);
  return { quotes, sourceTs: newest };
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

/** Health check used by readiness — does not throw if unconfigured. */
export async function probeSsiFcData(): Promise<{
  configured: boolean;
  ok: boolean;
  message: string;
}> {
  if (!ssiFcConfigured()) {
    return { configured: false, ok: false, message: "SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET chưa set" };
  }
  try {
    await getAccessToken();
    return { configured: true, ok: true, message: "Auth token OK" };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      message: e instanceof Error ? e.message : "auth failed",
    };
  }
}

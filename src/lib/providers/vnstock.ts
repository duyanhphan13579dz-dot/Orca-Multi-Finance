import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar, Quote } from "../types";
import { ProviderError } from "./binance";

/**
 * VNStock provider adapter — primary source for Vietnam equities.
 *
 * Contract is env-configurable (VNSTOCK_BASE_URL + VNSTOCK_API_KEY). The
 * adapter attempts the documented REST surfaces and normalizes flexible
 * field naming. If the provider is not configured or unreachable, it throws
 * ProviderError and the service layer marks data DEGRADED/UNAVAILABLE —
 * the platform never fabricates Vietnam market numbers.
 */

export const VNSTOCK = "vnstock";

function headers(): Record<string, string> {
  return env.vnstockApiKey ? { Authorization: `Bearer ${env.vnstockApiKey}`, "x-api-key": env.vnstockApiKey } : {};
}

function ensureConfigured() {
  if (!env.vnstockApiKey) throw new ProviderError("VNSTOCK_API_KEY not configured", VNSTOCK);
}

/* --------------------------------- helpers -------------------------------- */

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[,.\s]/g, (m) => (m === "," ? "" : m))) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function pick<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  return undefined;
}

function asArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["data", "items", "result", "rows"]) {
      if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    }
  }
  return [];
}

async function vnGet<T>(paths: string[]): Promise<T> {
  ensureConfigured();
  let lastErr = "unreachable";
  for (const p of paths) {
    const res = await httpJson<T>(`${env.vnstockBaseUrl}${p}`, { provider: VNSTOCK, headers: headers(), timeoutMs: 8_000, retries: 1 });
    if (res.ok && res.data != null) return res.data;
    lastErr = res.error ?? "unreachable";
  }
  throw new ProviderError(`vnstock: ${lastErr}`, VNSTOCK);
}

/* --------------------------------- indices -------------------------------- */

export async function getVnIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const payload = await vnGet<unknown>(["/v1/market/indices", "/v1/indices", "/api/v1/indices"]);
  const rows = asArray(payload);
  const items: IndexQuote[] = rows
    .map((r): IndexQuote | null => {
      const code = String(pick(r, ["code", "symbol", "indexCode", "index_code", "name"]) ?? "").toUpperCase();
      const value = num(pick(r, ["value", "price", "close", "indexValue", "index_value", "last"]));
      const change = num(pick(r, ["change", "priceChange", "pointChange"])) ?? 0;
      const changePercent = num(pick(r, ["changePercent", "change_percent", "pctChange", "percentChange"])) ?? 0;
      if (!code || value == null) return null;
      const updatedAt = pick<string>(r, ["updatedAt", "updated_at", "time", "timestamp", "tradingDate"]);
      return {
        code,
        name: code,
        value,
        change,
        changePercent,
        volume: num(pick(r, ["volume", "totalVolume", "total_volume"])) ?? null,
        updatedAt: updatedAt != null ? String(updatedAt) : null,
      };
    })
    .filter((x): x is IndexQuote => x !== null);
  if (!items.length) throw new ProviderError("vnstock: empty index payload", VNSTOCK);
  return { items, sourceTs: items[0]?.updatedAt ? Date.parse(items[0].updatedAt) : null };
}

/* ---------------------------------- quotes --------------------------------- */

export async function getVnQuotes(symbols: string[]): Promise<Quote[]> {
  const joined = symbols.join(",");
  const payload = await vnGet<unknown>([
    `/v1/market/quotes?symbols=${joined}`,
    `/v1/quotes?symbols=${joined}`,
    `/api/v1/quotes?symbols=${joined}`,
  ]);
  const rows = asArray(payload);
  const quotes = rows
    .map((r): Quote | null => {
      const symbol = String(pick(r, ["symbol", "code", "ticker"]) ?? "").toUpperCase();
      const price = num(pick(r, ["price", "last", "lastPrice", "close", "matchPrice", "match_price"]));
      if (!symbol || price == null) return null;
      return {
        symbol,
        assetClass: "stock",
        price,
        change: num(pick(r, ["change", "priceChange"])),
        changePercent: num(pick(r, ["changePercent", "change_percent", "pctChange"])),
        open: num(pick(r, ["open", "openPrice"])),
        high: num(pick(r, ["high", "highPrice"])),
        low: num(pick(r, ["low", "lowPrice"])),
        volume: num(pick(r, ["volume", "totalVolume", "nmVolume"])),
        quoteVolume: num(pick(r, ["value", "totalValue"])),
        referencePrice: num(pick(r, ["referencePrice", "reference_price", "ref_price", "refPrice"])),
        ceilingPrice: num(pick(r, ["ceilingPrice", "ceiling", "ceil_price", "highLimit"])),
        floorPrice: num(pick(r, ["floorPrice", "floor", "floor_price", "lowLimit"])),
        updatedAt: (pick<string>(r, ["updatedAt", "time", "timestamp"]) as string) ?? null,
      };
    })
    .filter((x): x is Quote => x != null);
  if (!quotes.length) throw new ProviderError("vnstock: empty quotes payload", VNSTOCK);
  return quotes;
}

/* ---------------------------------- OHLCV ---------------------------------- */

export async function getVnOhlcv(symbol: string, limit = 250): Promise<OhlcvBar[]> {
  const s = encodeURIComponent(symbol.toUpperCase());
  const payload = await vnGet<unknown>([
    `/v1/symbols/${s}/ohlcv?limit=${limit}`,
    `/v1/market/ohlcv/${s}?limit=${limit}`,
    `/api/v1/ohlcv/${s}?limit=${limit}`,
  ]);
  const rows = asArray(payload);
  const bars = rows
    .map((r): OhlcvBar | null => {
      const tRaw = pick(r, ["time", "date", "tradingDate", "timestamp", "t"]);
      const t = typeof tRaw === "number" ? (tRaw > 1e12 ? tRaw : tRaw * 1000) : Date.parse(String(tRaw ?? ""));
      const open = num(pick(r, ["open", "o"]));
      const high = num(pick(r, ["high", "h"]));
      const low = num(pick(r, ["low", "l"]));
      const close = num(pick(r, ["close", "c"]));
      if (!Number.isFinite(t) || open == null || high == null || low == null || close == null) return null;
      return { time: t, open, high, low, close, volume: num(pick(r, ["volume", "v"])) ?? 0 };
    })
    .filter((x): x is OhlcvBar => x != null)
    .sort((a, b) => a.time - b.time);
  if (!bars.length) throw new ProviderError("vnstock: empty ohlcv payload", VNSTOCK);
  return bars;
}

/* ------------------------------- stock universe ---------------------------- */

export async function getVnUniverse(exchange?: string): Promise<{ symbol: string; name: string | null; exchange: string | null; industry: string | null }[]> {
  const q = exchange ? `&exchange=${encodeURIComponent(exchange)}` : "";
  const payload = await vnGet<unknown>([`/v1/symbols?limit=2000${q}`, `/v1/market/symbols?limit=2000${q}`, `/api/v1/symbols?limit=2000${q}`]);
  return asArray(payload)
    .map((r) => ({
      symbol: String(pick(r, ["symbol", "code", "ticker"]) ?? "").toUpperCase(),
      name: (pick<string>(r, ["name", "companyName", "organName"]) as string) ?? null,
      exchange: (pick<string>(r, ["exchange", "market", "floor"]) as string)?.toUpperCase() ?? null,
      industry: (pick<string>(r, ["industry", "industryName", "sector"]) as string) ?? null,
    }))
    .filter((x) => x.symbol);
}

/* ------------------------------- financials -------------------------------- */

export type FinancialReportType = "income" | "balance" | "cashflow" | "ratios";

export async function getVnFinancials(symbol: string, report: FinancialReportType, period: "quarter" | "year", limit = 12): Promise<Record<string, unknown>[]> {
  const s = encodeURIComponent(symbol.toUpperCase());
  const payload = await vnGet<unknown>([
    `/v1/symbols/${s}/financials/${report}?period=${period}&limit=${limit}`,
    `/v1/financials/${s}/${report}?period=${period}&limit=${limit}`,
    `/api/v1/financials/${report}/${s}?period=${period}&limit=${limit}`,
  ]);
  const rows = asArray(payload);
  if (!rows.length) throw new ProviderError("vnstock: empty financials payload", VNSTOCK);
  return rows;
}

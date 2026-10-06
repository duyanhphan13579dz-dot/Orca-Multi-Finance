import "server-only";
import { httpJson } from "../http";
import type { DerivativeQuote, OhlcvBar } from "../types";

/**
 * DNSE OpenAPI — derivatives skeleton (env-gated).
 * Env: DNSE_API_KEY + DNSE_API_SECRET · optional DNSE_BEARER_TOKEN
 * Base: DNSE_OPENAPI_BASE_URL (default https://openapi.dnse.com.vn)
 */

export const DNSE_DER = "dnse-openapi-der";

export function dnseConfigured(): boolean {
  return Boolean(process.env.DNSE_API_KEY?.trim() && process.env.DNSE_API_SECRET?.trim());
}

function baseUrl(): string {
  return (process.env.DNSE_OPENAPI_BASE_URL ?? "https://openapi.dnse.com.vn").replace(/\/$/, "");
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function dnseHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const bearer = process.env.DNSE_BEARER_TOKEN?.trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const key = process.env.DNSE_API_KEY?.trim();
  if (key) headers["X-API-KEY"] = key;
  return headers;
}

function mapAnyQuote(symbol: string, raw: Record<string, unknown>): DerivativeQuote | null {
  const last =
    num(raw.matchPrice) ??
    num(raw.lastPrice) ??
    num(raw.last) ??
    num(raw.close) ??
    num(raw.Close) ??
    num(raw.price);
  if (last == null || last <= 0) return null;
  return {
    symbol: symbol.toUpperCase(),
    last,
    change: num(raw.change) ?? num(raw.priceChange),
    changePercent: num(raw.changePercent) ?? num(raw.percentChange),
    open: num(raw.open) ?? num(raw.Open),
    high: num(raw.high) ?? num(raw.High),
    low: num(raw.low) ?? num(raw.Low),
    volume: num(raw.volume) ?? num(raw.matchQtty) ?? num(raw.totalVolume),
    openInterest: num(raw.openInterest) ?? num(raw.oi) ?? num(raw.OI),
    settlement: num(raw.settlementPrice),
    mark: null,
    ceiling: num(raw.ceiling) ?? num(raw.ceilPrice),
    floor: num(raw.floor) ?? num(raw.floorPrice),
    reference: num(raw.refPrice) ?? num(raw.basicPrice),
    updatedAt: new Date().toISOString(),
    source: DNSE_DER,
  };
}

export async function fetchDnseDerivativeQuote(
  symbol: string,
): Promise<DerivativeQuote | null> {
  if (!dnseConfigured()) return null;
  const sym = symbol.toUpperCase();
  const headers = await dnseHeaders();
  const paths = [
    `/market-data/v1/quotes?symbol=${encodeURIComponent(sym)}`,
    `/price-api/v1/market/symbol/${encodeURIComponent(sym)}`,
    `/api/v1/market/derivative/${encodeURIComponent(sym)}`,
  ];
  for (const path of paths) {
    try {
      const res = await httpJson<Record<string, unknown> | { data?: Record<string, unknown> }>(
        `${baseUrl()}${path}`,
        { provider: DNSE_DER, timeoutMs: 8_000, retries: 0, headers },
      );
      if (!res.ok || res.data == null) continue;
      const data = res.data;
      const row = (data && "data" in data && data.data ? data.data : data) as Record<
        string,
        unknown
      >;
      if (row && typeof row === "object") {
        const q = mapAnyQuote(sym, row);
        if (q) return q;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

export async function fetchDnseDerivativeQuotes(
  symbols: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  if (!dnseConfigured()) return out;
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await fetchDnseDerivativeQuote(s);
        if (q) out.set(s.toUpperCase(), q);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export async function fetchDnseDerivativeOhlcv(
  _symbol: string,
  _days = 60,
): Promise<OhlcvBar[]> {
  if (!dnseConfigured()) return [];
  return [];
}

export async function probeDnseDer(): Promise<{
  configured: boolean;
  reachable: boolean;
  error: string | null;
  note: string;
}> {
  if (!dnseConfigured()) {
    return {
      configured: false,
      reachable: false,
      error: "Set DNSE_API_KEY + DNSE_API_SECRET (optional DNSE_BEARER_TOKEN)",
      note: "skeleton inactive",
    };
  }
  try {
    const q = await fetchDnseDerivativeQuote("VN30F1M");
    return {
      configured: true,
      reachable: q != null,
      error: q ? null : "Configured but no quote mapped — check path/signing",
      note: q ? `quote last=${q.last}` : "awaiting full HMAC signer / market-data path",
    };
  } catch (e) {
    return {
      configured: true,
      reachable: false,
      error: e instanceof Error ? e.message : "DNSE probe failed",
      note: "skeleton",
    };
  }
}

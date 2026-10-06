import "server-only";
import { httpJson } from "../http";
import type { DerivativeQuote, OhlcvBar } from "../types";

/**
 * TCBS OpenAPI — derivatives market skeleton (env-gated).
 * Env: TCBS_ACCESS_TOKEN or TCBS_API_KEY
 * Base: TCBS_OPENAPI_BASE_URL (default https://openapi.tcbs.com.vn)
 */

export const TCBS_DER = "tcbs-openapi-der";

export function tcbsConfigured(): boolean {
  return Boolean(process.env.TCBS_ACCESS_TOKEN?.trim() || process.env.TCBS_API_KEY?.trim());
}

function baseUrl(): string {
  return (process.env.TCBS_OPENAPI_BASE_URL ?? "https://openapi.tcbs.com.vn").replace(/\/$/, "");
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getTcbsToken(): Promise<string | null> {
  const ready = process.env.TCBS_ACCESS_TOKEN?.trim();
  if (ready) return ready;
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const apiKey = process.env.TCBS_API_KEY?.trim();
  if (!apiKey) return null;
  for (const path of ["/auth/v1/token", "/api/v1/auth/token", "/iflash/auth/token"]) {
    try {
      const httpRes = await httpJson<{
        accessToken?: string;
        access_token?: string;
        data?: { accessToken?: string; access_token?: string; expiresIn?: number };
        expiresIn?: number;
      }>(`${baseUrl()}${path}`, {
        provider: TCBS_DER,
        timeoutMs: 8_000,
        retries: 0,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, api_key: apiKey }),
      });
      if (!httpRes.ok || !httpRes.data) continue;
      const res = httpRes.data;
      const tok =
        res.accessToken ?? res.access_token ?? res.data?.accessToken ?? res.data?.access_token;
      if (tok) {
        const exp = (res.expiresIn ?? res.data?.expiresIn ?? 3000) * 1000;
        tokenCache = { token: tok, expiresAt: Date.now() + Math.max(60_000, exp - 60_000) };
        return tok;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

function mapAnyQuote(symbol: string, raw: Record<string, unknown>): DerivativeQuote | null {
  const last =
    num(raw.matchPrice) ?? num(raw.lastPrice) ?? num(raw.last) ?? num(raw.close) ?? num(raw.price);
  if (last == null || last <= 0) return null;
  return {
    symbol: symbol.toUpperCase(),
    last,
    change: num(raw.change),
    changePercent: num(raw.changePercent) ?? num(raw.percentChange),
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    volume: num(raw.volume) ?? num(raw.matchQtty),
    openInterest: num(raw.openInterest) ?? num(raw.oi),
    settlement: num(raw.settlementPrice),
    mark: null,
    ceiling: num(raw.ceilPrice) ?? num(raw.ceiling),
    floor: num(raw.floorPrice) ?? num(raw.floor),
    reference: num(raw.refPrice),
    updatedAt: new Date().toISOString(),
    source: TCBS_DER,
  };
}

export async function fetchTcbsDerivativeQuote(
  symbol: string,
): Promise<DerivativeQuote | null> {
  if (!tcbsConfigured()) return null;
  const token = await getTcbsToken();
  if (!token) return null;
  const sym = symbol.toUpperCase();
  const paths = [
    `/derivative/v1/market/quotes?symbols=${encodeURIComponent(sym)}`,
    `/tartarus/v1/tickerCommons?tickers=${encodeURIComponent(sym)}`,
    `/ananke/v1/securities?filter=symbol=${encodeURIComponent(sym)}`,
  ];
  for (const path of paths) {
    try {
      const httpRes = await httpJson<
        Record<string, unknown> | { data?: Record<string, unknown> | Record<string, unknown>[] }
      >(`${baseUrl()}${path}`, {
        provider: TCBS_DER,
        timeoutMs: 8_000,
        retries: 0,
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      if (!httpRes.ok || httpRes.data == null) continue;
      const data = httpRes.data;
      let row: Record<string, unknown> | null = null;
      if (data && typeof data === "object") {
        if (Array.isArray((data as { data?: unknown }).data)) {
          const arr = (data as { data: Record<string, unknown>[] }).data;
          row =
            arr.find((x) => String(x.symbol ?? x.Symbol ?? "").toUpperCase() === sym) ??
            arr[0] ??
            null;
        } else if (
          (data as { data?: unknown }).data &&
          typeof (data as { data: unknown }).data === "object"
        ) {
          row = (data as { data: Record<string, unknown> }).data;
        } else {
          row = data as Record<string, unknown>;
        }
      }
      if (row) {
        const q = mapAnyQuote(sym, row);
        if (q) return q;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

export async function fetchTcbsDerivativeQuotes(
  symbols: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  if (!tcbsConfigured()) return out;
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await fetchTcbsDerivativeQuote(s);
        if (q) out.set(s.toUpperCase(), q);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export async function fetchTcbsDerivativeOhlcv(
  _symbol: string,
  _days = 60,
): Promise<OhlcvBar[]> {
  if (!tcbsConfigured()) return [];
  return [];
}

export async function probeTcbsDer(): Promise<{
  configured: boolean;
  tokenOk: boolean;
  reachable: boolean;
  error: string | null;
  note: string;
}> {
  if (!tcbsConfigured()) {
    return {
      configured: false,
      tokenOk: false,
      reachable: false,
      error: "Set TCBS_ACCESS_TOKEN or TCBS_API_KEY",
      note: "skeleton inactive",
    };
  }
  try {
    const token = await getTcbsToken();
    if (!token) {
      return {
        configured: true,
        tokenOk: false,
        reachable: false,
        error: "Could not obtain JWT — set TCBS_ACCESS_TOKEN or fix auth path",
        note: "skeleton",
      };
    }
    const q = await fetchTcbsDerivativeQuote("VN30F1M");
    return {
      configured: true,
      tokenOk: true,
      reachable: q != null,
      error: q ? null : "Token ok but quote path not mapped yet for DER",
      note: q ? `quote last=${q.last}` : "awaiting §7 market path confirmation",
    };
  } catch (e) {
    return {
      configured: true,
      tokenOk: false,
      reachable: false,
      error: e instanceof Error ? e.message : "TCBS probe failed",
      note: "skeleton",
    };
  }
}

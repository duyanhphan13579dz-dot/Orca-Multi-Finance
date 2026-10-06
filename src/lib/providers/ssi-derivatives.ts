import "server-only";
import { httpJson } from "../http";
import {
  getSsiAccessToken,
  invalidateSsiToken,
  ssiFcConfigured,
  ssiToday,
} from "./ssi-fcdata";
import type { DerivativeQuote, OhlcvBar } from "../types";
import { ProviderError } from "./binance";

/**
 * SSI FastConnect Data — Derivatives (Market=DER).
 * Env: SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET (or SSI_API_KEY + SSI_API_SECRET)
 */

export const SSI_DERIVATIVES = "ssi-fcdata-der";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function baseUrl(): string {
  return (process.env.SSI_FC_DATA_BASE_URL ?? "https://fc-data.ssi.com.vn").replace(/\/$/, "");
}

type SsiEnvelope<T> = {
  status?: number | string;
  message?: string;
  totalRecord?: number;
  data?: T;
};

async function ssiGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  timeoutMs = 12_000,
): Promise<T> {
  const token = await getSsiAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${baseUrl()}${path}${qs.toString() ? `?${qs}` : ""}`;

  const doFetch = async (tok: string) =>
    httpJson<T>(url, {
      provider: SSI_DERIVATIVES,
      timeoutMs,
      retries: 0,
      headers: { Accept: "application/json", Authorization: `Bearer ${tok}` },
    });

  let res = await doFetch(token);
  if (!res.ok && (res.status === 401 || String(res.error).includes("401"))) {
    invalidateSsiToken();
    const token2 = await getSsiAccessToken();
    res = await doFetch(token2);
  }
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-der: ${res.error ?? "unreachable"}`, SSI_DERIVATIVES);
  }
  return res.data;
}

export type SsiDerSecurity = {
  symbol: string;
  name: string | null;
  underlying: string | null;
  maturityDate: string | null;
  lastTradingDate: string | null;
  multiplier: number | null;
  secType: string | null;
};

function parseMaturity(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && v > 1e11) return new Date(v).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 1e9) return new Date(v * 1000).toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

let secCache: { at: number; rows: SsiDerSecurity[] } | null = null;

export async function listSsiDerSecurities(force = false): Promise<SsiDerSecurity[]> {
  if (!force && secCache && Date.now() - secCache.at < 5 * 60_000) return secCache.rows;
  const all: SsiDerSecurity[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = await ssiGet<SsiEnvelope<Record<string, unknown>[]>>("/api/v2/Market/Securities", {
      market: "DER",
      Market: "DER",
      pageIndex: page,
      PageIndex: page,
      pageSize: 100,
      PageSize: 100,
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      const symbol = String(r.Symbol ?? r.symbol ?? "").toUpperCase();
      if (!symbol) continue;
      all.push({
        symbol,
        name: r.SymbolName != null ? String(r.SymbolName) : null,
        underlying: r.Underlying != null ? String(r.Underlying).toUpperCase() : null,
        maturityDate: parseMaturity(r.MaturityDate ?? r.maturityDate),
        lastTradingDate: parseMaturity(r.LastTradingDate ?? r.lastTradingDate),
        multiplier: num(r.ContractMultiplier ?? r.multiplier),
        secType: r.SecType != null ? String(r.SecType) : null,
      });
    }
    if (rows.length < 100) break;
  }
  secCache = { at: Date.now(), rows: all };
  return all;
}

export async function resolveSsiDerSymbol(alias: string): Promise<string> {
  const a = alias.toUpperCase();
  if (/^VN30F\d{4}$/i.test(a) || /^VN100F\d{4}$/i.test(a) || /^GB\d/i.test(a)) return a;

  const secs = await listSsiDerSecurities();
  const todayStr = new Date().toISOString().slice(0, 10);

  const rankContinuous = (alias: string): number | null => {
    if (alias.endsWith("F1M") || alias === "VN30F1M") return 0;
    if (alias.endsWith("F2M") || alias === "VN30F2M") return 1;
    if (alias.endsWith("F3M") || alias === "VN30F3M") return 2;
    if (alias.endsWith("F1Q") || alias === "VN30F1Q") return 3;
    if (alias.endsWith("F2Q")) return 4;
    return null;
  };

  const want = rankContinuous(a);
  if (want == null) {
    if (secs.some((s) => s.symbol === a)) return a;
    return a;
  }

  const underlying = a.startsWith("VN100") ? "VN100" : a.startsWith("GB") ? "GB" : "VN30";
  const candidates = secs
    .filter((s) => {
      const u = s.underlying ?? "";
      const okU =
        u.includes(underlying) ||
        s.symbol.startsWith(
          underlying === "VN30" ? "VN30F" : underlying === "VN100" ? "VN100F" : "GB",
        );
      if (!okU) return false;
      const mat = s.maturityDate ?? s.lastTradingDate;
      if (mat && mat < todayStr) return false;
      return (
        /^VN30F\d{4}$/i.test(s.symbol) ||
        /^VN100F\d{4}$/i.test(s.symbol) ||
        s.symbol.startsWith("GB")
      );
    })
    .sort((x, y) => {
      const mx = x.maturityDate ?? x.lastTradingDate ?? "9999";
      const my = y.maturityDate ?? y.lastTradingDate ?? "9999";
      return mx.localeCompare(my);
    });

  if (candidates[want]) return candidates[want].symbol;
  if (candidates[0]) return candidates[0].symbol;
  return a;
}

function mapPriceRow(symbol: string, r: Record<string, unknown>): DerivativeQuote | null {
  const last =
    num(r.Close) ??
    num(r.close) ??
    num(r.LastPrice) ??
    num(r.lastPrice) ??
    num(r.Last) ??
    num(r.last) ??
    num(r.Price) ??
    num(r.price);
  if (last == null || last <= 0) return null;

  let updatedAt: string | null = null;
  const tradingDate = r.TradingDate ?? r.tradingDate ?? r.Time ?? r.time;
  if (typeof tradingDate === "string" && tradingDate) {
    const m = tradingDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      updatedAt = new Date(
        `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T15:00:00+07:00`,
      ).toISOString();
    } else {
      const t = Date.parse(tradingDate);
      if (Number.isFinite(t)) updatedAt = new Date(t).toISOString();
    }
  }
  if (!updatedAt) updatedAt = new Date().toISOString();

  return {
    symbol: symbol.toUpperCase(),
    last,
    change: num(r.Change) ?? num(r.change) ?? num(r.PriceChange),
    changePercent:
      num(r.PerChange) ??
      num(r.perChange) ??
      num(r.ChangePercent) ??
      num(r.changePercent) ??
      num(r.PercentPriceChange),
    open: num(r.Open) ?? num(r.open),
    high: num(r.High) ?? num(r.high),
    low: num(r.Low) ?? num(r.low),
    volume:
      num(r.Volume) ??
      num(r.volume) ??
      num(r.TotalMatchVolume) ??
      num(r.MatchVolume) ??
      num(r.matchVolume),
    openInterest:
      num(r.OpenInterest) ?? num(r.openInterest) ?? num(r.OI) ?? num(r.oi) ?? num(r.Open_Interest),
    settlement: num(r.SettlementPrice) ?? num(r.settlementPrice),
    mark: null,
    ceiling: num(r.CeilingPrice) ?? num(r.ceilingPrice),
    floor: num(r.FloorPrice) ?? num(r.floorPrice),
    reference: num(r.RefPrice) ?? num(r.ReferencePrice) ?? num(r.referencePrice),
    updatedAt,
    source: SSI_DERIVATIVES,
  };
}

export async function fetchSsiDerQuote(aliasOrCode: string): Promise<DerivativeQuote | null> {
  if (!ssiFcConfigured()) return null;
  const resolved = await resolveSsiDerSymbol(aliasOrCode);
  const trySymbols = [...new Set([resolved, aliasOrCode.toUpperCase()])];

  for (const sym of trySymbols) {
    try {
      const body = await ssiGet<SsiEnvelope<Record<string, unknown>[]>>(
        "/api/v2/Market/DailyStockPrice",
        {
          Symbol: sym,
          symbol: sym,
          market: "DER",
          Market: "DER",
          pageIndex: 1,
          PageIndex: 1,
          pageSize: 20,
          PageSize: 20,
          FromDate: ssiToday(),
          fromDate: ssiToday(),
          ToDate: ssiToday(),
          toDate: ssiToday(),
        },
      );
      const rows = Array.isArray(body.data) ? body.data : [];
      for (const r of rows) {
        const rowSym = String(r.Symbol ?? r.symbol ?? sym).toUpperCase();
        const q = mapPriceRow(aliasOrCode.toUpperCase(), { ...r, Symbol: rowSym });
        if (q) {
          q.source = `${SSI_DERIVATIVES}:${sym}`;
          return q;
        }
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function fetchSsiDerQuotes(
  aliases: string[],
): Promise<Map<string, DerivativeQuote>> {
  const out = new Map<string, DerivativeQuote>();
  if (!ssiFcConfigured()) return out;
  await Promise.all(
    aliases.map(async (a) => {
      try {
        const q = await fetchSsiDerQuote(a);
        if (q) out.set(a.toUpperCase(), q);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export async function fetchSsiDerOhlcv(aliasOrCode: string, days = 60): Promise<OhlcvBar[]> {
  if (!ssiFcConfigured()) return [];
  const sym = await resolveSsiDerSymbol(aliasOrCode);
  const to = ssiToday();
  const fromDate = (() => {
    const d = new Date(Date.now() - days * 86_400_000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")}/${get("month")}/${get("year")}`;
  })();

  try {
    const body = await ssiGet<SsiEnvelope<Record<string, unknown>[]>>("/api/v2/Market/DailyOhlc", {
      Symbol: sym,
      symbol: sym,
      FromDate: fromDate,
      fromDate,
      ToDate: to,
      toDate: to,
      PageIndex: 1,
      pageIndex: 1,
      PageSize: Math.min(days + 10, 250),
      pageSize: Math.min(days + 10, 250),
      Ascending: true,
      ascending: true,
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    const bars: OhlcvBar[] = [];
    for (const r of rows) {
      const close = num(r.Close) ?? num(r.close);
      if (close == null) continue;
      let time = Date.now();
      const td = r.TradingDate ?? r.tradingDate;
      if (typeof td === "string") {
        const m = td.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          time = new Date(
            `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T15:00:00+07:00`,
          ).getTime();
        }
      }
      bars.push({
        time,
        open: num(r.Open) ?? num(r.open) ?? close,
        high: num(r.High) ?? num(r.high) ?? close,
        low: num(r.Low) ?? num(r.low) ?? close,
        close,
        volume: num(r.Volume) ?? num(r.volume),
      });
    }
    return bars.sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

export async function probeSsiDerFeed(): Promise<{
  configured: boolean;
  tokenOk: boolean;
  securitiesCount: number;
  sampleSymbols: string[];
  resolved: Record<string, string>;
  error: string | null;
}> {
  if (!ssiFcConfigured()) {
    return {
      configured: false,
      tokenOk: false,
      securitiesCount: 0,
      sampleSymbols: [],
      resolved: {},
      error:
        "Thiếu credentials: set SSI_FC_CONSUMER_ID + SSI_FC_CONSUMER_SECRET (hoặc SSI_API_KEY + SSI_API_SECRET)",
    };
  }
  try {
    await getSsiAccessToken();
    const secs = await listSsiDerSecurities(true);
    const resolved: Record<string, string> = {};
    for (const a of ["VN30F1M", "VN30F2M", "VN30F3M"]) {
      try {
        resolved[a] = await resolveSsiDerSymbol(a);
      } catch {
        resolved[a] = a;
      }
    }
    return {
      configured: true,
      tokenOk: true,
      securitiesCount: secs.length,
      sampleSymbols: secs.map((s) => s.symbol).slice(0, 15),
      resolved,
      error: null,
    };
  } catch (e) {
    return {
      configured: true,
      tokenOk: false,
      securitiesCount: 0,
      sampleSymbols: [],
      resolved: {},
      error: e instanceof Error ? e.message : "SSI DER probe failed",
    };
  }
}

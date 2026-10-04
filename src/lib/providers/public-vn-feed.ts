import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, Quote, OhlcvBar } from "../types";
import { getYahooQuote } from "./yahoo";
import { getVpsQuotes } from "./vps";
import { getSsiIboardQuotes } from "./ssi-iboard";
import { ProviderError } from "./binance";

/**
 * Public free VN market feeds — no API key.
 * Parallel race + merge so dashboard stays FRESH/LIVE when primary CTCK feeds fail.
 *
 *  Quotes:  VPS bgapidatafeed ∥ SSI iBoard
 *  Indices: Yahoo ∥ VPS index symbols
 *  OHLCV:   Entrade chart-api ∥ VPS histdatafeed (TradingView history)
 */

export const PUBLIC_VN = "public-vn-feed";

const YAHOO_INDEX_MAP: Record<string, string> = {
  VNINDEX: "^VNINDEX",
  VN30: "^VN30",
  HNX: "HNXI.VN",
  HNXINDEX: "HNXI.VN",
  HNX30: "HNX30.VN",
  UPCOM: "UPCOMINDEX.VN",
};

const UA = "Mozilla/5.0 (compatible; Orca-Multi-Finance/1.0)";

function mergeQuotes(batches: Array<{ quotes: Quote[]; sourceTs: number | null; source: string }>): {
  quotes: Quote[];
  sourceTs: number | null;
  sources: string[];
} {
  const bySym = new Map<string, Quote>();
  const used = new Set<string>();
  let newest: number | null = null;
  for (const batch of batches) {
    if (batch.sourceTs != null && (newest == null || batch.sourceTs > newest)) newest = batch.sourceTs;
    for (const q of batch.quotes) {
      const sym = q.symbol.toUpperCase();
      const prev = bySym.get(sym);
      if (!prev) {
        bySym.set(sym, q);
        used.add(batch.source);
        continue;
      }
      bySym.set(sym, {
        ...q,
        ...prev,
        name: prev.name ?? q.name,
        volume: prev.volume ?? q.volume,
        quoteVolume: prev.quoteVolume ?? q.quoteVolume,
        open: prev.open ?? q.open,
        high: prev.high ?? q.high,
        low: prev.low ?? q.low,
        referencePrice: prev.referencePrice ?? q.referencePrice,
        ceilingPrice: prev.ceilingPrice ?? q.ceilingPrice,
        floorPrice: prev.floorPrice ?? q.floorPrice,
      });
      used.add(batch.source);
    }
  }
  return { quotes: [...bySym.values()], sourceTs: newest, sources: [...used] };
}

/** Race VPS ∥ SSI iBoard — no API key. */
export async function getPublicQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
  sources?: string[];
}> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!uniq.length) return { quotes: [], sourceTs: null, sources: [] };

  const settled = await Promise.allSettled([
    getVpsQuotes(uniq).then((quotes) => ({
      quotes,
      sourceTs: quotes.length ? Date.now() : null,
      source: "vps" as const,
    })),
    getSsiIboardQuotes(uniq).then((quotes) => ({
      quotes,
      sourceTs: quotes.length ? Date.now() : null,
      source: "ssi-iboard" as const,
    })),
  ]);

  const batches: Array<{ quotes: Quote[]; sourceTs: number | null; source: string }> = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.quotes.length) {
      batches.push(s.value);
    }
  }
  if (!batches.length) {
    throw new ProviderError("public quotes: all sources empty", PUBLIC_VN);
  }
  batches.sort((a, b) => (a.source === "vps" ? -1 : b.source === "vps" ? 1 : 0));
  return mergeQuotes(batches);
}

export async function getPublicIndices(
  codes: string[] = ["VNINDEX", "VN30", "HNX", "UPCOM"],
): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const want = codes.map((c) => c.toUpperCase().replace("HNXINDEX", "HNX"));
  const byCode = new Map<string, IndexQuote>();
  let newest: number | null = null;

  const [yahooRows, vpsPack] = await Promise.all([
    Promise.all(
      codes.map(async (code) => {
        const ySym = YAHOO_INDEX_MAP[code.toUpperCase()] ?? `${code}.VN`;
        try {
          const q = await getYahooQuote(ySym);
          const ts = q.marketTime ?? Date.now();
          return {
            code: code.toUpperCase().replace("HNXINDEX", "HNX"),
            name: code.toUpperCase(),
            value: q.price,
            change: q.change ?? 0,
            changePercent: q.changePercent ?? 0,
            volume: null as number | null,
            updatedAt: ts ? new Date(ts).toISOString() : null,
            ts,
          };
        } catch {
          return null;
        }
      }),
    ),
    getVpsQuotes(want)
      .then((quotes) => ({ quotes, sourceTs: quotes.length ? Date.now() : null }))
      .catch(() => ({ quotes: [] as Quote[], sourceTs: null as number | null })),
  ]);

  for (const row of yahooRows) {
    if (!row) continue;
    if (newest == null || row.ts > newest) newest = row.ts;
    byCode.set(row.code, {
      code: row.code,
      name: row.name,
      value: row.value,
      change: row.change,
      changePercent: row.changePercent,
      volume: row.volume,
      updatedAt: row.updatedAt,
    });
  }

  for (const q of vpsPack.quotes) {
    const code = q.symbol.toUpperCase().replace("HNXINDEX", "HNX");
    if (!want.includes(code)) continue;
    const existing = byCode.get(code);
    if (!existing && q.price != null) {
      const ts = q.updatedAt ? Date.parse(String(q.updatedAt)) : Date.now();
      if (newest == null || ts > newest) newest = ts;
      byCode.set(code, {
        code,
        name: code,
        value: q.price,
        change: q.change ?? 0,
        changePercent: q.changePercent ?? 0,
        volume: q.volume ?? null,
        updatedAt: q.updatedAt ? String(q.updatedAt) : null,
      });
    } else if (existing) {
      if (existing.volume == null && q.volume != null) existing.volume = q.volume;
    }
  }

  const items = [...byCode.values()];
  if (!items.length) throw new ProviderError("public indices: empty", PUBLIC_VN);
  return { items, sourceTs: newest ?? vpsPack.sourceTs };
}

type TvOhlc = {
  s?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

function barsFromArrays(
  t: number[],
  o: number[],
  h: number[],
  l: number[],
  c: number[],
  v: number[] | undefined,
  limit: number,
): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < t.length; i++) {
    const open = o[i];
    const high = h[i];
    const low = l[i];
    const close = c[i];
    if (open == null || high == null || low == null || close == null) continue;
    if (!(close > 0)) continue;
    bars.push({
      time: t[i] * 1000,
      open,
      high,
      low,
      close,
      volume: v?.[i] ?? 0,
    });
  }
  return bars.slice(-limit);
}

async function fetchEntradeOhlcv(
  sym: string,
  from: number,
  to: number,
  kind: "stock" | "index",
  limit: number,
): Promise<OhlcvBar[]> {
  const path = kind === "index" ? "index" : "stock";
  const url =
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/${path}` +
    `?from=${from}&to=${to}&symbol=${encodeURIComponent(sym)}&resolution=1D`;
  const res = await httpJson<TvOhlc>(url, {
    provider: "entrade",
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok || !res.data?.t?.length) return [];
  const d = res.data;
  return barsFromArrays(d.t!, d.o ?? [], d.h ?? [], d.l ?? [], d.c ?? [], d.v, limit);
}

async function fetchVpsHistOhlcv(sym: string, from: number, to: number, limit: number): Promise<OhlcvBar[]> {
  const url =
    `https://histdatafeed.vps.com.vn/tradingview/history` +
    `?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${to}`;
  const res = await httpJson<TvOhlc>(url, {
    provider: "vps-hist",
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok || res.data?.s === "no_data" || !res.data?.t?.length) return [];
  const d = res.data;
  return barsFromArrays(d.t!, d.o ?? [], d.h ?? [], d.l ?? [], d.c ?? [], d.v, limit);
}

/**
 * Public OHLCV with parallel race:
 *  Entrade (DNSE) chart-api ∥ VPS histdatafeed
 * First non-empty with enough bars wins; otherwise longest series.
 */
export async function getPublicOhlcv(
  symbol: string,
  limit = 250,
  kind: "stock" | "index" = "stock",
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const now = Math.floor(Date.now() / 1000);
  const from = Math.floor(now - Math.max(limit, 30) * 86400 * 1.6);

  const settled = await Promise.allSettled([
    fetchEntradeOhlcv(sym, from, now, kind, limit),
    fetchVpsHistOhlcv(sym, from, now, limit),
  ]);

  const candidates: OhlcvBar[][] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.length >= 5) candidates.push(s.value);
  }
  if (!candidates.length) {
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.length) candidates.push(s.value);
    }
  }
  if (!candidates.length) {
    throw new ProviderError(`public ohlcv empty: ${sym}`, PUBLIC_VN);
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0]!.slice(-limit);
}

/** Liquid universe for board fallback (not full HOSE). */
export const LIQUID_BOARD = [
  "VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "STB", "HDB", "VIB", "TPB", "SHB", "MSB", "OCB", "LPB", "EIB", "SSB", "NAB",
  "VIC", "VHM", "VRE", "NVL", "PDR", "DXG", "KDH", "NLG", "DIG", "CEO", "HDG", "BCM", "KBC", "SZC", "IDC", "VGC",
  "HPG", "HSG", "NKG", "SMC", "HT1", "BCC",
  "FPT", "CMG", "ELC", "FOX",
  "VNM", "MSN", "SAB", "MCH", "QNS", "DBC", "MWG", "PNJ", "FRT", "DGW", "PET",
  "GAS", "PLX", "PVD", "PVS", "BSR", "OIL", "POW", "REE", "GEG", "PC1", "GEX", "NT2",
  "SSI", "VND", "HCM", "VCI", "SHS", "CTS", "BSI", "FTS", "VIX", "ORS",
  "GVR", "PHR", "DPR", "HAG", "BAF",
  "BVH", "BMI", "PVI", "MIG", "VJC", "HVN",
  "GMD", "VSC", "HAH", "DGC", "DPM", "DCM",
];

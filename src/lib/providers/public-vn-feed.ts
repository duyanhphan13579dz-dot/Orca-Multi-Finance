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
 *  Quotes:  VPS bgapidatafeed ∥ SSI iBoard (merge by symbol, prefer VPS price)
 *  Indices: Yahoo Finance (primary) + VPS index symbols when available
 *  OHLCV:   Entrade chart-api
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
    getVpsQuotes(uniq).then((r) => ({ ...r, source: "vps" as const })),
    getSsiIboardQuotes(uniq).then((r) => ({ ...r, source: "ssi-iboard" as const })),
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

  const [yahooRows, vps] = await Promise.all([
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
    getVpsQuotes(want).catch(() => ({ quotes: [] as Quote[], sourceTs: null as number | null })),
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

  for (const q of vps.quotes) {
    const code = q.symbol.toUpperCase().replace("HNXINDEX", "HNX");
    if (!want.includes(code)) continue;
    const existing = byCode.get(code);
    if (!existing && q.price != null) {
      const ts = q.updatedAt ? Date.parse(q.updatedAt) : Date.now();
      if (newest == null || ts > newest) newest = ts;
      byCode.set(code, {
        code,
        name: code,
        value: q.price,
        change: q.change ?? 0,
        changePercent: q.changePercent ?? 0,
        volume: q.volume ?? null,
        updatedAt: q.updatedAt ?? null,
      });
    } else if (existing) {
      if (existing.volume == null && q.volume != null) existing.volume = q.volume;
    }
  }

  const items = [...byCode.values()];
  if (!items.length) throw new ProviderError("public indices: empty", PUBLIC_VN);
  return { items, sourceTs: newest ?? vps.sourceTs };
}

type EntradeOhlc = {
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

export async function getPublicOhlcv(
  symbol: string,
  limit = 250,
  kind: "stock" | "index" = "stock",
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const now = Math.floor(Date.now() / 1000);
  const from = now - Math.max(limit, 30) * 86400 * 1.5;
  const path = kind === "index" ? "index" : "stock";
  const url =
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/${path}` +
    `?from=${Math.floor(from)}&to=${now}&symbol=${encodeURIComponent(sym)}&resolution=1D`;
  const res = await httpJson<EntradeOhlc>(url, {
    provider: "entrade",
    timeoutMs: 10_000,
    retries: 1,
    headers: { Accept: "application/json", "User-Agent": "Orca-Multi-Finance/1.0" },
  });
  if (!res.ok || !res.data?.t?.length) {
    throw new ProviderError(`entrade ohlcv ${sym}: ${res.error ?? "empty"}`, PUBLIC_VN);
  }
  const d = res.data;
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < d.t!.length; i++) {
    const o = d.o?.[i];
    const h = d.h?.[i];
    const l = d.l?.[i];
    const c = d.c?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({
      time: d.t![i] * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: d.v?.[i] ?? 0,
    });
  }
  return bars.slice(-limit);
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

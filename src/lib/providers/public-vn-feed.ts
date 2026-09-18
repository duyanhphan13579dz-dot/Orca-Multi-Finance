import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, Quote, OhlcvBar } from "../types";
import { getYahooQuote } from "./yahoo";
import { getVpsQuotes } from "./vps";
import { ProviderError } from "./binance";

/**
 * Public free VN market feeds — no API key.
 * Failover when VNDirect / SSI are down so dashboard stays FRESH/LIVE.
 *
 *  - VPS bgapidatafeed → realtime stock quotes
 *  - Yahoo Finance chart → VNINDEX / VN30 / HNX (may lag minutes)
 *  - Entrade chart-api → daily OHLCV stocks + indices
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

export async function getPublicQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
}> {
  return getVpsQuotes(symbols);
}

export async function getPublicIndices(
  codes: string[] = ["VNINDEX", "VN30", "HNX", "UPCOM"],
): Promise<{ items: IndexQuote[]; sourceTs: number | null }> {
  const items: IndexQuote[] = [];
  let newest: number | null = null;
  await Promise.all(
    codes.map(async (code) => {
      const ySym = YAHOO_INDEX_MAP[code.toUpperCase()] ?? `${code}.VN`;
      try {
        const q = await getYahooQuote(ySym);
        const ts = q.marketTime ?? Date.now();
        if (newest == null || ts > newest) newest = ts;
        items.push({
          code: code.toUpperCase().replace("HNXINDEX", "HNX"),
          name: code.toUpperCase(),
          value: q.price,
          change: q.change ?? 0,
          changePercent: q.changePercent ?? 0,
          volume: null,
          updatedAt: ts ? new Date(ts).toISOString() : null,
        });
      } catch {
        /* skip */
      }
    }),
  );
  if (!items.length) throw new ProviderError("public indices: empty", PUBLIC_VN);
  return { items, sourceTs: newest };
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
  "VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "STB", "HDB", "VIB", "TPB", "SHB", "MSB", "OCB", "LPB", "EIB",
  "VIC", "VHM", "VRE", "NVL", "PDR", "DXG", "KDH", "NLG", "DIG", "CEO", "HDG",
  "HPG", "HSG", "NKG", "SMC",
  "FPT", "CMG", "ELC",
  "VNM", "MSN", "SAB", "MCH", "QNS", "DBC",
  "MWG", "PNJ", "FRT", "DGW",
  "GAS", "PLX", "PVD", "PVS", "BSR", "OIL",
  "SSI", "VND", "HCM", "VCI", "SHS", "CTS", "BSI", "FTS",
  "REE", "POW", "GEG", "PC1", "GEX",
  "GVR", "PHR", "DPR",
  "BCM", "KBC", "SZC", "IDC",
  "BVH", "BMI", "PVI",
  "VJC", "HVN",
];

import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, Quote, OhlcvBar } from "../types";
import { getYahooQuote } from "./yahoo";
import { getVpsQuotes } from "./vps";
import { getSsiIboardQuotes } from "./ssi-iboard";
import { getVietcapQuotes } from "./vietcap";
import { ProviderError } from "./binance";

export const PUBLIC_VN = "public-vn";

const YAHOO_INDEX_MAP: Record<string, string> = {
  VNINDEX: "^VNINDEX",
  VN30: "^VN30",
  HNX: "^HNX",
  HNXINDEX: "^HNX",
  UPCOM: "^UPCOM",
};

function mergeQuotes(
  batches: Array<{ quotes: Quote[]; sourceTs: number | null; source: string }>,
): { quotes: Quote[]; sourceTs: number | null; sources?: string[] } {
  const bySym = new Map<string, Quote>();
  const used = new Set<string>();
  let newest: number | null = null;
  for (const batch of batches) {
    if (batch.sourceTs != null) {
      newest = newest == null ? batch.sourceTs : Math.max(newest, batch.sourceTs);
    }
    for (const q of batch.quotes) {
      const sym = String(q.symbol ?? "").toUpperCase();
      if (!sym || !(Number(q.price) > 0)) continue;
      const prev = bySym.get(sym);
      if (!prev) {
        bySym.set(sym, { ...q, symbol: sym });
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

/** Race VPS ∥ SSI iBoard ∥ Vietcap — no API key. */
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
    getVietcapQuotes(uniq.slice(0, 24)).then((r) => ({
      quotes: r.quotes,
      sourceTs: r.sourceTs,
      source: "vietcap" as const,
    })),
  ]);

  const batches: Array<{ quotes: Quote[]; sourceTs: number | null; source: string }> = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.quotes.length) {
      batches.push(s.value);
    }
  }
  if (!batches.length) {
    return { quotes: [], sourceTs: null, sources: [] };
  }
  const rank = (s: string) => (s === "vps" ? 0 : s === "ssi-iboard" ? 1 : 2);
  batches.sort((a, b) => rank(a.source) - rank(b.source));
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
            change: q.change,
            changePercent: q.changePercent,
            updatedAt: new Date(ts).toISOString(),
          } as IndexQuote;
        } catch {
          return null;
        }
      }),
    ),
    getVpsQuotes(want)
      .then((quotes) => quotes)
      .catch(() => [] as Quote[]),
  ]);

  for (const row of yahooRows) {
    if (!row || row.value == null) continue;
    byCode.set(row.code, row);
    newest = Date.now();
  }
  for (const q of vpsPack) {
    const code = String(q.symbol ?? "").toUpperCase().replace("HNXINDEX", "HNX");
    if (!want.includes(code) && !want.includes(q.symbol?.toUpperCase() ?? "")) continue;
    if (!(Number(q.price) > 0)) continue;
    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        name: q.name ?? code,
        value: q.price,
        change: q.change,
        changePercent: q.changePercent,
        updatedAt: q.updatedAt ?? new Date().toISOString(),
      });
      newest = Date.now();
    }
  }

  return { items: [...byCode.values()], sourceTs: newest };
}

async function fetchEntradeOhlcv(
  sym: string,
  from: number,
  to: number,
  kind: "stock" | "index",
  limit: number,
): Promise<OhlcvBar[]> {
  const host =
    kind === "index"
      ? "https://services.entrade.com.vn/chart-api/v2/index"
      : "https://services.entrade.com.vn/chart-api/v2/stock";
  const url =
    `${host}` +
    `?from=${from}&to=${to}&symbol=${encodeURIComponent(sym)}&resolution=1D`;
  const res = await httpJson<{
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
  }>(url, {
    provider: PUBLIC_VN,
    timeoutMs: 10_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.data?.t?.length) return [];
  const bars: OhlcvBar[] = [];
  const n = res.data.t.length;
  for (let i = 0; i < n; i++) {
    const time = (res.data.t[i] ?? 0) * 1000;
    const close = Number(res.data.c?.[i]);
    if (!(time > 0) || !(close > 0)) continue;
    bars.push({
      time,
      open: Number(res.data.o?.[i] ?? close),
      high: Number(res.data.h?.[i] ?? close),
      low: Number(res.data.l?.[i] ?? close),
      close,
      volume: Number(res.data.v?.[i] ?? 0),
    });
  }
  return bars.slice(-limit);
}

async function fetchVpsHistOhlcv(
  sym: string,
  from: number,
  to: number,
  limit: number,
): Promise<OhlcvBar[]> {
  const url =
    `https://histdatafeed.vps.com.vn/tradingview/history` +
    `?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${to}`;
  const res = await httpJson<{
    s?: string;
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
  }>(url, {
    provider: PUBLIC_VN,
    timeoutMs: 10_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || res.data?.s === "no_data" || !res.data?.t?.length) return [];
  const bars: OhlcvBar[] = [];
  const n = res.data.t.length;
  for (let i = 0; i < n; i++) {
    const time = (res.data.t[i] ?? 0) * 1000;
    const close = Number(res.data.c?.[i]);
    if (!(time > 0) || !(close > 0)) continue;
    bars.push({
      time,
      open: Number(res.data.o?.[i] ?? close),
      high: Number(res.data.h?.[i] ?? close),
      low: Number(res.data.l?.[i] ?? close),
      close,
      volume: Number(res.data.v?.[i] ?? 0),
    });
  }
  return bars.slice(-limit);
}

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

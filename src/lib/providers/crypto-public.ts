import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * Public crypto market feeds (no API key) — fallback when Binance is blocked.
 * - CoinCap v2 assets
 * - OKX spot tickers
 */

export const COINCAP = "coincap";
export const OKX_PUBLIC = "okx-public";

export type PublicCryptoRow = {
  symbol: string;
  baseAsset: string;
  price: number;
  changePercent: number | null;
  quoteVolume: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
};

const STABLE = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD"]);

function toUsdtSymbol(base: string): string | null {
  const b = base.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!b || STABLE.has(b) || b.length > 12) return null;
  return `${b}USDT`;
}

/** CoinCap top assets by rank — free public API */
export async function getCoinCapAssets(limit = 80): Promise<{
  rows: PublicCryptoRow[];
  sourceTs: number;
}> {
  const res = await httpJson<{
    data?: Array<{
      id?: string;
      symbol?: string;
      priceUsd?: string;
      changePercent24Hr?: string;
      volumeUsd24Hr?: string;
    }>;
  }>(`https://api.coincap.io/v2/assets?limit=${Math.min(100, Math.max(10, limit))}`, {
    provider: COINCAP,
    timeoutMs: 2_500,
    retries: 0,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.data?.data?.length) {
    throw new ProviderError(`coincap: ${res.error ?? "empty"}`, COINCAP);
  }
  const rows: PublicCryptoRow[] = [];
  const seen = new Set<string>();
  for (const a of res.data.data) {
    const base = String(a.symbol ?? "").toUpperCase();
    const symbol = toUsdtSymbol(base);
    if (!symbol || seen.has(symbol)) continue;
    const price = Number(a.priceUsd);
    if (!(price > 0)) continue;
    seen.add(symbol);
    const ch = Number(a.changePercent24Hr);
    const vol = Number(a.volumeUsd24Hr);
    rows.push({
      symbol,
      baseAsset: base,
      price,
      changePercent: Number.isFinite(ch) ? ch : null,
      quoteVolume: Number.isFinite(vol) ? vol : null,
      volume: null,
      high: null,
      low: null,
      open: null,
    });
  }
  if (!rows.length) throw new ProviderError("coincap: no mapped rows", COINCAP);
  return { rows, sourceTs: Date.now() };
}

/** OKX public spot tickers — USDT pairs only */
export async function getOkxSpotTickers(): Promise<{
  rows: PublicCryptoRow[];
  sourceTs: number;
}> {
  const res = await httpJson<{
    code?: string;
    data?: Array<{
      instId?: string;
      last?: string;
      open24h?: string;
      high24h?: string;
      low24h?: string;
      volCcy24h?: string;
      vol24h?: string;
      sodUtc0?: string;
    }>;
  }>("https://www.okx.com/api/v5/market/tickers?instType=SPOT", {
    provider: OKX_PUBLIC,
    timeoutMs: 7_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || !res.data?.data?.length) {
    throw new ProviderError(`okx: ${res.error ?? "empty"}`, OKX_PUBLIC);
  }
  const rows: PublicCryptoRow[] = [];
  for (const t of res.data.data) {
    const inst = String(t.instId ?? "").toUpperCase();
    if (!inst.endsWith("-USDT")) continue;
    const base = inst.replace(/-USDT$/, "");
    const symbol = `${base}USDT`;
    const price = Number(t.last);
    if (!(price > 0)) continue;
    const open = Number(t.open24h);
    const high = Number(t.high24h);
    const low = Number(t.low24h);
    const qVol = Number(t.volCcy24h);
    const vol = Number(t.vol24h);
    let changePercent: number | null = null;
    if (Number.isFinite(open) && open > 0) {
      changePercent = ((price - open) / open) * 100;
    }
    rows.push({
      symbol,
      baseAsset: base,
      price,
      changePercent,
      quoteVolume: Number.isFinite(qVol) ? qVol : null,
      volume: Number.isFinite(vol) ? vol : null,
      high: Number.isFinite(high) ? high : null,
      low: Number.isFinite(low) ? low : null,
      open: Number.isFinite(open) ? open : null,
    });
  }
  if (!rows.length) throw new ProviderError("okx: no USDT rows", OKX_PUBLIC);
  rows.sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  return { rows, sourceTs: Date.now() };
}

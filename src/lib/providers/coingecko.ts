import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * CoinGecko markets API — Pro key + internal proxy when configured.
 * Fallback when Binance is unreachable / geo-blocked.
 */

export const COINGECKO = "coingecko";

const TOP_IDS = [
  "bitcoin",
  "ethereum",
  "binancecoin",
  "solana",
  "ripple",
  "cardano",
  "dogecoin",
  "tron",
  "avalanche-2",
  "chainlink",
  "polkadot",
  "polygon-ecosystem-token",
  "litecoin",
  "bitcoin-cash",
  "near",
  "uniswap",
  "internet-computer",
  "aptos",
  "stellar",
  "filecoin",
] as const;

const ID_TO_SYMBOL: Record<string, string> = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  solana: "SOLUSDT",
  ripple: "XRPUSDT",
  cardano: "ADAUSDT",
  dogecoin: "DOGEUSDT",
  tron: "TRXUSDT",
  "avalanche-2": "AVAXUSDT",
  chainlink: "LINKUSDT",
  polkadot: "DOTUSDT",
  "polygon-ecosystem-token": "POLUSDT",
  litecoin: "LTCUSDT",
  "bitcoin-cash": "BCHUSDT",
  near: "NEARUSDT",
  uniswap: "UNIUSDT",
  "internet-computer": "ICPUSDT",
  aptos: "APTUSDT",
  stellar: "XLMUSDT",
  filecoin: "FILUSDT",
};

export type CoinGeckoSimpleRow = {
  symbol: string;
  baseAsset: string;
  price: number;
  changePercent: number | null;
  quoteVolume: number | null;
};

type SimplePricePayload = Record<
  string,
  { usd?: number; usd_24h_change?: number; usd_24h_vol?: number }
>;

function cgBase(): string {
  const base =
    process.env.COINGECKO_BASE_URL?.trim() ||
    "https://api.coingecko.com/api/v3";
  return base.replace(/\/$/, "");
}

function cgHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.COINGECKO_PRO_API_KEY?.trim();
  if (key) {
    h["x-cg-pro-api-key"] = key;
  }
  return h;
}

export async function getCoinGeckoSimplePrices(): Promise<{
  rows: CoinGeckoSimpleRow[];
  sourceTs: number;
  via: string;
}> {
  const ids = TOP_IDS.join(",");
  const base = cgBase();
  const url =
    `${base}/simple/price` +
    `?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const res = await httpJson<SimplePricePayload>(url, {
    provider: COINGECKO,
    timeoutMs: 8_000,
    retries: 1,
    headers: cgHeaders(),
  });
  if (!res.ok || !res.data) {
    throw new ProviderError(`coingecko: ${res.error ?? "unreachable"}`, COINGECKO);
  }
  const rows: CoinGeckoSimpleRow[] = [];
  for (const [id, v] of Object.entries(res.data)) {
    const symbol = ID_TO_SYMBOL[id];
    if (!symbol) continue;
    const price = Number(v.usd);
    if (!Number.isFinite(price) || price <= 0) continue;
    const ch = v.usd_24h_change;
    const vol = v.usd_24h_vol;
    rows.push({
      symbol,
      baseAsset: symbol.replace(/USDT$/, ""),
      price,
      changePercent: Number.isFinite(Number(ch)) ? Number(ch) : null,
      quoteVolume: Number.isFinite(Number(vol)) ? Number(vol) : null,
    });
  }
  if (!rows.length) throw new ProviderError("coingecko: empty payload", COINGECKO);
  return {
    rows,
    sourceTs: Date.now(),
    via: base.includes("coingecko.com") ? "public" : "proxy",
  };
}

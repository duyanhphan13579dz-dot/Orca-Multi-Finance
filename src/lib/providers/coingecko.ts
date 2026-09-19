import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * CoinGecko free public API — no key for basic endpoints.
 * Used as crypto market fallback when Binance is unreachable / geo-blocked.
 * https://api.coingecko.com/api/v3/simple/price
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

export async function getCoinGeckoSimplePrices(): Promise<{
  rows: CoinGeckoSimpleRow[];
  sourceTs: number;
}> {
  const ids = TOP_IDS.join(",");
  const url =
    `https://api.coingecko.com/api/v3/simple/price` +
    `?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const res = await httpJson<SimplePricePayload>(url, {
    provider: COINGECKO,
    timeoutMs: 8_000,
    retries: 1,
    headers: { Accept: "application/json" },
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
  return { rows, sourceTs: Date.now() };
}

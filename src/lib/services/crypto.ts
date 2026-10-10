import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getCoinGeckoSimplePrices } from "../providers/coingecko";
import { getCoinCapAssets, getOkxSpotTickers } from "../providers/crypto-public";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { analyzeSeries, detectPatterns } from "../technical";
import { validateQuote, logQualityEvent } from "../quality";
import { candleAggregator } from "../realtime/candles";
import { eventBus } from "../events";
import type { Meta, OhlcvBar, TechnicalSnapshot, CandlePattern } from "../types";
import { firstHealthy } from "../data-engine/resilience";

export interface CryptoMarketRow {
  symbol: string;
  baseAsset: string;
  assetClass: "crypto";
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  quoteVolume: number | null;
  trades24h: number | null;
  updatedAt: string | null;
}

export interface CryptoSummary {
  marketCount: number;
  advancers: number;
  decliners: number;
  avgChangePercent: number;
  totalQuoteVolume: number;
  btcChangePercent: number | null;
  ethChangePercent: number | null;
  fetchedAt: string;
}

export interface CryptoDetail {
  symbol: string;
  quote: CryptoMarketRow | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  funding: binance.FundingInfo | null;
  openInterest: { openInterest: number; time: number } | null;
}

export interface CryptoScreenerParams {
  sort?: "volume" | "gainers" | "losers";
  limit?: number;
  minQuoteVolume?: number;
  minChange?: number;
  maxChange?: number;
}

type AllMarket = {
  rows: CryptoMarketRow[];
  fetchedAt: number;
  overlaid: number;
  invalid: number;
  suspect: number;
  source: string;
};

type LastGood = { pack: AllMarket; at: number };

function lastGoodStore(): { current: LastGood | null } {
  const g = globalThis as typeof globalThis & { __orcaCryptoLast?: { current: LastGood | null } };
  if (!g.__orcaCryptoLast) g.__orcaCryptoLast = { current: null };
  return g.__orcaCryptoLast;
}

function remember(pack: AllMarket) {
  if (!pack.rows.length) return;
  lastGoodStore().current = { pack, at: Date.now() };
}

function recall(maxAgeMs = 30 * 60_000): AllMarket | null {
  const lg = lastGoodStore().current;
  if (!lg || Date.now() - lg.at > maxAgeMs) return null;
  return { ...lg.pack, source: `${lg.pack.source}+last-good` };
}

function toRow(t: binance.BinanceTicker24h): CryptoMarketRow | null {
  const price = Number(t.lastPrice);
  if (!(price > 0)) return null;
  const symbol = String(t.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return null;
  return {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    assetClass: "crypto",
    price,
    change: Number(t.priceChange) || null,
    changePercent: Number(t.priceChangePercent) || null,
    open: Number(t.openPrice) || null,
    high: Number(t.highPrice) || null,
    low: Number(t.lowPrice) || null,
    volume: Number(t.volume) || null,
    quoteVolume: Number(t.quoteVolume) || null,
    trades24h: Number(t.count) || null,
    updatedAt: t.closeTime ? new Date(t.closeTime).toISOString() : null,
  };
}

function fromPublic(p: {
  symbol: string;
  baseAsset: string;
  price: number;
  changePercent: number | null;
  quoteVolume: number | null;
  volume?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
}): CryptoMarketRow {
  const ch = p.changePercent;
  const open = p.open ?? (ch != null && p.price > 0 ? p.price / (1 + ch / 100) : null);
  return {
    symbol: p.symbol,
    baseAsset: p.baseAsset,
    assetClass: "crypto",
    price: p.price,
    change: open != null ? p.price - open : null,
    changePercent: ch,
    open,
    high: p.high ?? null,
    low: p.low ?? null,
    volume: p.volume ?? null,
    quoteVolume: p.quoteVolume,
    trades24h: null,
    updatedAt: new Date().toISOString(),
  };
}

async function loadBinanceMarkets(): Promise<AllMarket> {
  try {
    ensureBinanceWsStarted();
  } catch {
    /* */
  }
  const tickers = await binance.getAllSpotTickers();
  if (!tickers?.length) throw new Error("binance empty");

  // Fast pre-filter USDT pairs to avoid heavy parsing of 2,500+ instruments
  const usdtTickers = tickers.filter((t) => {
    const s = t.symbol;
    return typeof s === "string" && s.endsWith("USDT") && Number(t.lastPrice) > 0;
  });

  const rows: CryptoMarketRow[] = [];
  let invalid = 0;
  let suspect = 0;
  for (const t of usdtTickers) {
    const row = toRow(t);
    if (!row) {
      invalid += 1;
      continue;
    }
    const q = validateQuote(
      {
        price: row.price,
        open: row.open,
        high: row.high,
        low: row.low,
        changePercent: row.changePercent,
        volume: row.volume,
        updatedAt: row.updatedAt,
      },
      { assetClass: "crypto", sourceTimestampMs: t.closeTime || null },
    );
    if (q.status === "INVALID") {
      invalid += 1;
      continue;
    }
    if (q.status === "SUSPECT" || q.status === "STALE") {
      suspect += 1;
    }
    rows.push(row);
  }

  // Aggregate single quality log instead of 50+ DB subrequests in loop
  if (invalid > 0 || suspect > 0) {
    void logQualityEvent("binance", `crypto batch quality (invalid=${invalid}, suspect=${suspect} of ${usdtTickers.length})`, {
      status: invalid > 0 ? "SUSPECT" : "VALID",
      score: 0.9,
      flags: [{ check: "batch_quality", severity: "warn", message: `batch issues: invalid=${invalid}, suspect=${suspect}` }],
    });
  }

  let overlaid = 0;
  try {
    const live = binanceWs.getTickers(10_000);
    if (live.size) {
      const bySym = new Map(Array.from(live.values(), (x) => [String(x.symbol).toUpperCase(), x]));
      for (const row of rows) {
        const l = bySym.get(row.symbol);
        if (l?.price && l.price > 0) {
          row.price = l.price;
          overlaid += 1;
          eventBus.emit(`tick:${row.symbol}`, {
            symbol: row.symbol,
            price: l.price,
            ts: Date.now(),
            source: "binance",
          });
        }
      }
    }
  } catch {
    /* soft */
  }

  try {
    candleAggregator.subscribedSymbols();
  } catch {
    /* */
  }

  rows.sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  if (!rows.length) throw new Error("binance no valid rows");
  // Retain top 250 pairs by liquidity to prevent Worker memory spikes & huge JSON serialization
  const topRows = rows.slice(0, 250);
  return {
    rows: topRows,
    fetchedAt: Date.now(),
    overlaid,
    invalid,
    suspect,
    source: overlaid > 0 ? "binance+ws" : "binance",
  };
}

async function loadOkxMarkets(): Promise<AllMarket> {
  const pack = await getOkxSpotTickers();
  const rows = pack.rows.map(fromPublic);
  rows.sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  return {
    rows,
    fetchedAt: pack.sourceTs,
    overlaid: 0,
    invalid: 0,
    suspect: 0,
    source: "okx-public",
  };
}

async function loadCoinCapMarkets(): Promise<AllMarket> {
  const pack = await getCoinCapAssets(80);
  const rows = pack.rows.map(fromPublic);
  return {
    rows,
    fetchedAt: pack.sourceTs,
    overlaid: 0,
    invalid: 0,
    suspect: 0,
    source: "coincap",
  };
}

async function loadCoinGeckoMarkets(): Promise<AllMarket> {
  const pack = await getCoinGeckoSimplePrices();
  const rows = pack.rows.map((r) =>
    fromPublic({
      symbol: r.symbol,
      baseAsset: r.baseAsset,
      price: r.price,
      changePercent: r.changePercent,
      quoteVolume: r.quoteVolume,
    }),
  );
  return {
    rows,
    fetchedAt: pack.sourceTs,
    overlaid: 0,
    invalid: 0,
    suspect: 0,
    source: `coingecko:${pack.via}`,
  };
}

function summarize(rows: CryptoMarketRow[], fetchedAt: number): CryptoSummary {
  let advancers = 0;
  let decliners = 0;
  let sumPct = 0;
  let pctN = 0;
  let totalQuoteVolume = 0;
  let btcChangePercent: number | null = null;
  let ethChangePercent: number | null = null;
  for (const r of rows) {
    totalQuoteVolume += r.quoteVolume ?? 0;
    if (r.changePercent != null) {
      sumPct += r.changePercent;
      pctN += 1;
      if (r.changePercent > 0) advancers += 1;
      else if (r.changePercent < 0) decliners += 1;
    }
    if (r.symbol === "BTCUSDT") btcChangePercent = r.changePercent;
    if (r.symbol === "ETHUSDT") ethChangePercent = r.changePercent;
  }
  return {
    marketCount: rows.length,
    advancers,
    decliners,
    avgChangePercent: pctN ? sumPct / pctN : 0,
    totalQuoteVolume,
    btcChangePercent,
    ethChangePercent,
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

/** Crypto markets: Binance → OKX → CoinCap → CoinGecko → last-good */
export async function getCryptoMarkets(): Promise<{
  rows: CryptoMarketRow[];
  summary: CryptoSummary;
  meta: Meta;
} | null> {
  try {
    const res = await cached<AllMarket>("crypto:all:v2", {
      ttlMs: 12_000,
      staleMs: 15 * 60_000,
      softSwr: true,
      producer: async () => {
        try {
          const hit = await firstHealthy<AllMarket>(
            [
              { id: "binance", run: async () => loadBinanceMarkets() },
              { id: "okx-public", run: async () => loadOkxMarkets() },
              { id: "coingecko", run: async () => loadCoinGeckoMarkets() },
              { id: "coincap", run: async () => loadCoinCapMarkets() },
            ],
            { budgetMs: 10_000, perAttemptMs: 6_000, label: "crypto-markets" },
          );
          remember(hit.value);
          return hit.value;
        } catch {
          const lg = recall();
          if (lg) return lg;
          throw new Error("all crypto sources empty");
        }
      },
    });

    const pack = res.value;
    if (!pack?.rows?.length) {
      const lg = recall();
      if (!lg) return null;
      return {
        rows: lg.rows,
        summary: summarize(lg.rows, lg.fetchedAt),
        meta: buildMeta({
          source: lg.source,
          sourceTimestampMs: lg.fetchedAt,
          stale: true,
          partial: true,
          note: "crypto last-good",
        }),
      };
    }

    remember(pack);
    return {
      rows: pack.rows,
      summary: summarize(pack.rows, pack.fetchedAt),
      meta: buildMeta({
        source: pack.source,
        sourceTimestampMs: pack.fetchedAt,
        cached: res.cached,
        stale: res.stale,
        note:
          pack.invalid || pack.suspect
            ? `invalid=${pack.invalid}; suspect=${pack.suspect}; overlaid=${pack.overlaid}`
            : pack.overlaid
              ? `overlaid=${pack.overlaid}`
              : undefined,
      }),
    };
  } catch {
    const lg = recall();
    if (!lg) return null;
    return {
      rows: lg.rows,
      summary: summarize(lg.rows, lg.fetchedAt),
      meta: buildMeta({
        source: lg.source,
        sourceTimestampMs: lg.fetchedAt,
        stale: true,
        partial: true,
        note: "crypto last-good after error",
      }),
    };
  }
}

const YAHOO_INTERVAL: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "4h": "1h",
  "1d": "1d",
  "1w": "1wk",
};

const YAHOO_RANGE: Record<string, string> = {
  "5m": "5d",
  "15m": "1mo",
  "1h": "3mo",
  "4h": "6mo",
  "1d": "2y",
  "1w": "5y",
};

export async function getCryptoKlines(
  symbol: string,
  interval = "1h",
  limit = 200,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const pair = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  try {
    const bars = await binance.getKlines(pair, interval, limit);
    if (bars?.length) {
      return {
        bars,
        meta: buildMeta({
          source: "binance-klines",
          sourceTimestampMs: bars[bars.length - 1]?.time ?? Date.now(),
        }),
      };
    }
  } catch {
    /* fallback Yahoo */
  }

  try {
    const { getYahooChart } = await import("../providers/yahoo");
    const base = pair.replace(/USDT$/, "");
    const ySym = `${base}-USD`;
    const yInterval = YAHOO_INTERVAL[interval] ?? "60m";
    const yRange = YAHOO_RANGE[interval] ?? "3mo";
    const y = await getYahooChart(ySym, yInterval, yRange);
    const bars: OhlcvBar[] = (y.candles ?? [])
      .slice(-limit)
      .map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }))
      .filter((b) => b.close > 0);
    if (bars.length >= 5) {
      return {
        bars,
        meta: buildMeta({
          source: "yahoo-crypto",
          sourceTimestampMs: bars[bars.length - 1]?.time ?? Date.now(),
          partial: true,
          note: `Yahoo ${ySym} fallback`,
        }),
      };
    }
  } catch {
    /* */
  }
  return null;
}

export async function getCryptoDetail(
  symbol: string,
  interval = "1h",
): Promise<{ detail: CryptoDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const pair = sym.endsWith("USDT") ? sym : `${sym}USDT`;

  try {
    const quotePromise = (async (): Promise<CryptoMarketRow | null> => {
      try {
        const spot = await binance.getSpotTicker(pair);
        const row = toRow(spot);
        if (row) return row;
      } catch {
        /* fallback */
      }
      const markets = await getCryptoMarkets().catch(() => null);
      return markets?.rows.find((r) => r.symbol === pair) ?? null;
    })();

    const [quote, klinesPack, funding, oi] = await Promise.all([
      quotePromise,
      getCryptoKlines(pair, interval, 200).catch(() => null),
      binance.getFundingRate(pair).catch(() => null),
      binance.getOpenInterest(pair).catch(() => null),
    ]);
    const bars = klinesPack?.bars ?? [];
    let technical: TechnicalSnapshot | null = null;
    let patterns: CandlePattern[] = [];
    if (bars.length >= 20) {
      try {
        technical = analyzeSeries(bars);
        patterns = detectPatterns(bars);
      } catch {
        /* */
      }
    }
    try {
      const mark = binanceWs.getMark?.(pair, 120_000);
      if (mark?.markPrice && quote) quote.price = mark.markPrice;
    } catch {
      /* */
    }
    if (!quote && !bars.length) return null;
    const detail: CryptoDetail = {
      symbol: pair,
      quote,
      bars,
      technical,
      patterns,
      funding,
      openInterest: oi,
    };
    const sources = [
      quote ? "binance-spot" : null,
      klinesPack?.meta?.source,
      funding ? "binance-funding" : null,
    ].filter(Boolean);
    return {
      detail,
      meta: buildMeta({
        source: sources.join("+") || "crypto",
        sourceTimestampMs: bars.length ? bars[bars.length - 1]!.time : Date.now(),
        partial: !quote || bars.length < 20,
      }),
    };
  } catch {
    return null;
  }
}

export async function screenCrypto(
  params: CryptoScreenerParams,
): Promise<{ rows: CryptoMarketRow[]; meta: Meta } | null> {
  const m = await getCryptoMarkets();
  if (!m) return null;
  let rows = m.rows;
  if (params.minQuoteVolume != null) {
    rows = rows.filter((r) => (r.quoteVolume ?? 0) >= (params.minQuoteVolume ?? 0));
  }
  if (params.minChange != null) {
    rows = rows.filter((r) => (r.changePercent ?? 0) >= (params.minChange ?? 0));
  }
  if (params.maxChange != null) {
    rows = rows.filter((r) => (r.changePercent ?? 0) <= (params.maxChange ?? 0));
  }
  if (params.sort === "gainers") {
    rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  } else if (params.sort === "losers") {
    rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  } else {
    rows = [...rows].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  }
  return { rows: rows.slice(0, params.limit ?? 40), meta: m.meta };
}

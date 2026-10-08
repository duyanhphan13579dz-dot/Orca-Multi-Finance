import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { analyzeSeries, detectPatterns } from "../technical";
import { validateQuote, logQualityEvent } from "../quality";
import { candleAggregator } from "../realtime/candles";
import { eventBus } from "../events";
import type { Meta, OhlcvBar, TechnicalSnapshot, CandlePattern } from "../types";

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
}

type AllMarket = {
  rows: CryptoMarketRow[];
  fetchedAt: number;
  overlaid: number;
  invalid: number;
  suspect: number;
};

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

export async function getCryptoMarkets(): Promise<{ rows: CryptoMarketRow[]; summary: CryptoSummary; meta: Meta } | null> {
  try {
    const res = await cached<AllMarket>("crypto:all", {
      ttlMs: 12_000,
      staleMs: 10 * 60_000,
      producer: async () => {
        try {
          ensureBinanceWsStarted();
        } catch {
          /* */
        }
        const tickers = await binance.getAllSpotTickers();
        if (!tickers?.length) throw new Error("binance empty");

        const rows: CryptoMarketRow[] = [];
        let invalid = 0;
        let suspect = 0;
        for (const t of tickers) {
          const row = toRow(t);
          if (!row) {
            invalid += 1;
            continue;
          }
          const q = validateQuote(
            { price: row.price, open: row.open, high: row.high, low: row.low,
              changePercent: row.changePercent, volume: row.volume, updatedAt: row.updatedAt },
            { assetClass: "crypto", sourceTimestampMs: t.closeTime || null },
          );
          if (q.status === "INVALID") {
            invalid += 1;
            void logQualityEvent("binance", `crypto quote ${row.symbol}`, q);
            continue;
          }
          if (q.status === "SUSPECT" || q.status === "STALE") {
            suspect += 1;
            void logQualityEvent("binance", `crypto quote ${row.symbol}`, q);
          }
          rows.push(row);
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
        return {
          rows,
          fetchedAt: Date.now(),
          overlaid,
          invalid,
          suspect,
        };
      },
    });

    const pack = res.value;
    const rows = pack.rows;
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
    const summary: CryptoSummary = {
      marketCount: rows.length,
      advancers,
      decliners,
      avgChangePercent: pctN ? sumPct / pctN : 0,
      totalQuoteVolume,
      btcChangePercent,
      ethChangePercent,
      fetchedAt: new Date(pack.fetchedAt).toISOString(),
    };
    return {
      rows,
      summary,
      meta: buildMeta({
        source: pack.overlaid > 0 ? "binance+ws" : "binance",
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
    return null;
  }
}

export async function getCryptoKlines(
  symbol: string,
  interval = "1h",
  limit = 200,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const pair = sym.endsWith("USDT") ? sym : `${sym}USDT`;
  try {
    const klines = await binance.getKlines(pair, interval, limit);
    if (!klines?.length) return null;
    const bars: OhlcvBar[] = klines.map((k) => ({
      time: k.time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
    return {
      bars,
      meta: buildMeta({
        source: "binance-klines",
        sourceTimestampMs: bars[bars.length - 1]?.time ?? Date.now(),
      }),
    };
  } catch {
    return null;
  }
}

export async function getCryptoDetail(
  symbol: string,
  interval = "1h",
): Promise<{ detail: CryptoDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const pair = sym.endsWith("USDT") ? sym : `${sym}USDT`;

  try {
    const [markets, klinesPack, funding, oi] = await Promise.all([
      getCryptoMarkets().catch(() => null),
      getCryptoKlines(pair, interval, 200).catch(() => null),
      binance.getFundingRate(pair).catch(() => null),
      binance.getOpenInterest(pair).catch(() => null),
    ]);
    const quote = markets?.rows.find((r) => r.symbol === pair) ?? null;
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
    const detail: CryptoDetail = {
      symbol: pair,
      quote,
      bars,
      technical,
      patterns,
      funding,
      openInterest: oi,
    };
    return {
      detail,
      meta: buildMeta({
        source: quote ? "binance+klines" : "binance-klines",
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
  if (params.sort === "gainers") {
    rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  } else if (params.sort === "losers") {
    rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  } else {
    rows = [...rows].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  }
  return { rows: rows.slice(0, params.limit ?? 40), meta: m.meta };
}

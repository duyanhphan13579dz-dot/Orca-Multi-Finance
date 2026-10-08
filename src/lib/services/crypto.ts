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

export async function getCryptoMarkets(): Promise<{
  rows: CryptoMarketRow[];
  summary: CryptoSummary;
  meta: Meta;
} | null> {
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
        const tickers = await binance.getAllUsdtTickers();
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
          const q = validateQuote({
            symbol: row.symbol,
            price: row.price,
            changePercent: row.changePercent,
            volume: row.volume,
            quoteVolume: row.quoteVolume,
          });
          if (!q.ok) {
            invalid += 1;
            logQualityEvent({ kind: "quote_invalid", symbol: row.symbol, detail: q.reason });
            continue;
          }
          if (q.suspect) {
            suspect += 1;
            logQualityEvent({ kind: "quote_suspect", symbol: row.symbol, detail: q.reason });
          }
          rows.push(row);
        }

        let overlaid = 0;
        try {
          const subscribed = candleAggregator.subscribedSymbols();
          for (const row of rows) {
            const sym = row.symbol;
            const last = binanceWs.getLastPrice?.(sym) ?? null;
            if (last != null && last > 0) {
              row.price = last;
              overlaid += 1;
              eventBus.emit(`tick:${sym}`, {
                symbol: sym,
                price: last,
                ts: Date.now(),
                source: "binance",
              });
            }
          }
        } catch {
          /* soft */
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

export async function getCryptoDetail(
  symbol: string,
  interval = "1d",
  limit = 120,
): Promise<{
  quote: CryptoMarketRow | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  meta: Meta;
} | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  const pair = sym.endsWith("USDT") ? sym : `${sym}USDT`;

  try {
    const [markets, klines] = await Promise.all([
      getCryptoMarkets().catch(() => null),
      binance.getKlines(pair, interval, limit).catch(() => null),
    ]);
    const quote = markets?.rows.find((r) => r.symbol === pair) ?? null;
    const bars: OhlcvBar[] = (klines ?? []).map((k) => ({
      time: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
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
    return {
      quote,
      bars,
      technical,
      patterns,
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

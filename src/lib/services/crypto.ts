import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { candleAggregator } from "../realtime/candles";
import { marketStore, type StoredQuote } from "../realtime/market-store";
import { CHANNEL } from "../realtime/channels";
import { emitEvent } from "../realtime/event-envelope";
import { logQualityEvent, validateQuote } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import { filterAndSortRows } from "../engines/screener";
import type { CandlePattern, CryptoMarketRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/**
 * Crypto domain service — sits on top of the Binance provider adapter.
 * Market-wide data is fetched ONCE per refresh window (ticker/24hr covers the
 * entire spot market) and cached; detail views add klines + futures metrics.
 */

const LEVERAGED_RE = /(UP|DOWN|BULL|BEAR)USDT$/i;
const EXCLUDED_BASES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "EUR", "GBP", "TRY", "BRL"]);

interface AllMarket {
  rows: CryptoMarketRow[];
  fetchedAt: number;
  overlaid: number;
  invalid: number;
  suspect: number;
}

/** Phase 6 §7 — rebuild CryptoMarketRow from a stored (validated) quote. */
export function rowFromStoredQuote(q: StoredQuote, symbol: string): CryptoMarketRow | null {
  if (!Number.isFinite(q.price) || q.price <= 0) return null;
  const sym = symbol.toUpperCase();
  return {
    symbol: sym,
    baseAsset: sym.replace(/USDT$/, ""),
    assetClass: "crypto",
    price: q.price,
    change: q.change ?? null,
    changePercent: q.changePercent ?? null,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    volume: q.volume ?? null,
    quoteVolume: q.quoteVolume ?? null,
    trades24h: q.trades24h ?? null,
    previousClose: q.previousClose ?? null,
    updatedAt: new Date(q.ts).toISOString(),
  };
}

export function toRow(t: binance.BinanceTicker24h): CryptoMarketRow | null {
  if (!t.symbol.endsWith("USDT") || LEVERAGED_RE.test(t.symbol)) return null;
  const base = t.symbol.replace(/USDT$/, "");
  if (EXCLUDED_BASES.has(base)) return null;
  const price = Number(t.lastPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol: t.symbol,
    baseAsset: base,
    assetClass: "crypto",
    price,
    change: Number(t.priceChange),
    changePercent: Number(t.priceChangePercent),
    open: Number(t.openPrice),
    high: Number(t.highPrice),
    low: Number(t.lowPrice),
    volume: Number(t.volume),
    quoteVolume: Number(t.quoteVolume),
    trades24h: t.count ?? null,
    previousClose: t.prevClosePrice != null && Number.isFinite(Number(t.prevClosePrice)) ? Number(t.prevClosePrice) : null,
    updatedAt: t.closeTime ? new Date(t.closeTime).toISOString() : null,
  };
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

export async function getCryptoMarkets(): Promise<{ rows: CryptoMarketRow[]; summary: CryptoSummary; meta: Meta } | null> {
  try {
    const res = await cached<AllMarket>("crypto:all", {
      ttlMs: 12_000,
      staleMs: 10 * 60_000,
      producer: async () => {
        const tickers = await binance.getAllSpotTickers();
        let rows = tickers
          .map(toRow)
          .filter((r): r is CryptoMarketRow => r !== null)
          .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
        if (!rows.length) throw new Error("binance: no spot rows");

        // DATA QUALITY: validate quotes; drop INVALID, keep flagged SUSPECT + log
        let invalid = 0;
        let suspect = 0;
        rows = rows.filter((r) => {
          const q = validateQuote(r, { assetClass: "crypto", sourceTimestampMs: Date.now() });
          if (q.status === "INVALID") {
            invalid++;
            void logQualityEvent("binance-spot", r.symbol, q);
            return false;
          }
          if (q.status === "SUSPECT") suspect++;
          return true;
        });

        // REALTIME OVERLAY: centralized Binance WebSocket stream wins when live
        ensureBinanceWsStarted();
        const live = binanceWs.getTickers(10_000);
        let overlaid = 0;
        if (live.size) {
          for (const row of rows) {
            const ws = live.get(row.symbol);
            if (!ws) continue;
            row.price = ws.price;
            row.changePercent = ws.changePercent;
            row.volume = ws.volume;
            row.quoteVolume = ws.quoteVolume;
            row.updatedAt = new Date(ws.eventTime).toISOString();
            overlaid++;
          }
        }

        // SUBSCRIPTION MANAGER: feed the candle aggregation engine from REST
        // too — when WS is geo-blocked, subscribed charts keep forming candles
        // (marked DELAYED by the freshness SLA on the client).
        const subscribed = candleAggregator.subscribedSymbols();
        const fetchedAt = Date.now();
        if (subscribed.length && overlaid === 0) {
          const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
          for (const sym of subscribed) {
            const row = bySymbol.get(sym);
            if (!row) continue;
            emitEvent(CHANNEL.tick(sym), "tick", {
              symbol: sym,
              price: row.price,
              cumVolume: row.volume ?? 0,
              cumQuoteVolume: row.quoteVolume ?? 0,
              ts: fetchedAt,
            }, { assetType: "crypto", symbol: sym, ts: fetchedAt });
          }
        }
        return { rows, fetchedAt, overlaid, invalid, suspect };
      },
    });
    const { rows, fetchedAt } = res.value;
    const advancers = rows.filter((r) => (r.changePercent ?? 0) > 0).length;
    const decliners = rows.filter((r) => (r.changePercent ?? 0) < 0).length;
    const avg = rows.reduce((a, r) => a + (r.changePercent ?? 0), 0) / Math.max(rows.length, 1);
    const summary: CryptoSummary = {
      marketCount: rows.length,
      advancers,
      decliners,
      avgChangePercent: avg,
      totalQuoteVolume: rows.reduce((a, r) => a + (r.quoteVolume ?? 0), 0),
      btcChangePercent: rows.find((r) => r.baseAsset === "BTC")?.changePercent ?? null,
      ethChangePercent: rows.find((r) => r.baseAsset === "ETH")?.changePercent ?? null,
      fetchedAt: new Date(fetchedAt).toISOString(),
    };
    const meta = buildMeta({
      source: res.value.overlaid > 0 ? "binance-ws + binance" : "binance",
      sourceTimestampMs: fetchedAt,
      cached: res.cached,
      stale: res.stale,
      note: res.value.invalid > 0 || res.value.suspect > 0
        ? `Data quality: ${res.value.invalid} record INVALID (đã loại), ${res.value.suspect} SUSPECT (đã ghi log)`
        : undefined,
      slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
    });
    meta.qualityStatus = res.value.invalid > 0 || res.value.suspect > 0 ? "SUSPECT" : "VALID";
    return { rows, summary, meta };
  } catch {
    return null;
  }
}

export interface CryptoDetail {
  symbol: string;
  baseAsset: string;
  ticker: CryptoMarketRow;
  klines: OhlcvBar[];
  interval: string;
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  funding: binance.FundingInfo | null;
  openInterest: { openInterest: number; time: number } | null;
  fundingStatus: "ok" | "unavailable";
}

export async function getCryptoKlines(symbol: string, interval = "1h", limit = 200): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  try {
    // Phase 6 §7 — REALTIME MARKET STORE first: shared candles, no provider call
    // when a fresh series exists (write-through below). `cached()` still dedups
    // concurrent provider refreshes for many users.
    const stored = marketStore.getCandles("crypto", sym, interval);
    if (stored && stored.candles.length >= Math.min(limit, stored.limit) && Date.now() - stored.ingestedAt <= 25_000) {
      const meta = buildMeta({
        source: stored.source,
        sourceTimestampMs: stored.sourceTimestampMs ?? (stored.candles[stored.candles.length - 1]?.time ?? Date.now()),
        cached: true,
        note: "Dữ liệu từ Realtime Market Store (chung cho mọi user)",
        slas: { liveSlaMs: 120_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
      });
      return { bars: stored.candles as OhlcvBar[], meta };
    }
    const res = await cached(`crypto:klines:${sym}:${interval}:${limit}`, {
      ttlMs: 25_000,
      staleMs: 15 * 60_000,
      producer: async () => ({ bars: await binance.getKlines(sym, interval, limit), fetchedAt: Date.now() }),
    });
    const lastBar = res.value.bars[res.value.bars.length - 1];
    // Phase 6 §7 — write-through: next users read from the store, no provider call.
    marketStore.setCandles({
      assetType: "crypto",
      symbol: sym,
      timeframe: interval,
      intervalMs: intervalMsFor(interval),
      limit,
      candles: res.value.bars,
      source: "binance",
      sourceTimestampMs: lastBar?.time ?? Date.now(),
    });
    const meta = buildMeta({
      source: "binance",
      sourceTimestampMs: lastBar ? lastBar.time : res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      slas: { liveSlaMs: 120_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
    });
    return { bars: res.value.bars, meta };
  } catch {
    return null;
  }
}

/** binance interval → ms (chart-const TF_MS equivalent for klines API). */
function intervalMsFor(interval: string): number {
  const table: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
    "1w": 604_800_000, "1M": 2_592_000_000,
  };
  return table[interval] ?? 3_600_000;
}

export async function getCryptoDetail(symbol: string, interval = "1h"): Promise<{ detail: CryptoDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  // Phase 6 §7 — REALTIME MARKET STORE first cho ticker: quote chung, provider
  // chỉ được gọi khi store còn thiếu/stale (write-through dưới đây).
  const storedQ = marketStore.getQuote("crypto", sym);
  const storedFresh = storedQ != null && Date.now() - storedQ.ingestedAt <= 20_000;
  const tickerPromise = storedFresh
    ? Promise.resolve<binance.BinanceTicker24h | null>(null)
    : binance.getSpotTicker(sym).then((t) => {
        // write-through: quote mới nhất → store cho mọi user sau đó
        const row = toRow(t);
        if (row) {
          marketStore.setQuote({
            assetType: "crypto",
            symbol: sym,
            price: row.price,
            change: row.change,
            changePercent: row.changePercent,
            open: row.open,
            high: row.high,
            low: row.low,
            volume: row.volume,
            quoteVolume: row.quoteVolume,
            previousClose: row.previousClose,
            trades24h: row.trades24h,
            source: "binance",
            ts: row.updatedAt ? Date.parse(row.updatedAt) : Date.now(),
          });
        }
        return t;
      });
  const [tickerRes, klinesRes, fundingRes, oiRes] = await Promise.allSettled([
    tickerPromise,
    getCryptoKlines(sym, interval, 200),
    binance.getFundingRate(sym),
    binance.getOpenInterest(sym),
  ]);
  if (!storedFresh && tickerRes.status === "rejected") return null;
  const t = tickerRes.status === "fulfilled" ? tickerRes.value : null;
  const base = storedFresh && storedQ ? rowFromStoredQuote(storedQ, sym) : t ? toRow(t) : null;
  if (!base) return null;
  const bars = klinesRes.status === "fulfilled" && klinesRes.value ? klinesRes.value.bars : [];
  const technical = bars.length ? analyzeSeries(bars) : null;
  const patterns = bars.length ? detectPatterns(bars) : [];
  let funding = fundingRes.status === "fulfilled" ? fundingRes.value : null;
  // futures fallback: centralized !markPrice stream (when fapi REST is geo-blocked)
  if (!funding) {
    ensureBinanceWsStarted();
    const mark = binanceWs.getMark(sym, 120_000);
    if (mark) {
      funding = {
        symbol: sym,
        markPrice: mark.markPrice,
        indexPrice: mark.markPrice,
        fundingRate: mark.fundingRate,
        nextFundingTime: mark.eventTime,
      };
    }
  }
  const openInterest =
    oiRes.status === "fulfilled" ? { openInterest: oiRes.value.openInterest, time: oiRes.value.time } : null;
  const detail: CryptoDetail = {
    symbol: sym,
    baseAsset: sym.replace(/USDT$/, ""),
    ticker: base,
    klines: bars,
    interval,
    technical,
    patterns,
    funding,
    openInterest,
    fundingStatus: funding ? "ok" : "unavailable",
  };
  const meta = buildMeta({
    source: "binance",
    sourceTimestampMs: t?.closeTime ?? storedQ?.ts ?? Date.now(),
    note: funding ? undefined : "Dữ liệu futures (funding/OI) tạm thờ không khả dụng từ vị trí máy chủ",
    partial: !funding,
  });
  return { detail, meta };
}

/* -------------------------------- screener --------------------------------- */

export interface CryptoScreenerParams {
  minChange?: number;
  maxChange?: number;
  minQuoteVolume?: number;
  limit?: number;
  sort?: "volume" | "gainers" | "losers";
}

export async function screenCrypto(params: CryptoScreenerParams): Promise<{ rows: CryptoMarketRow[]; meta: Meta } | null> {
  const m = await getCryptoMarkets();
  if (!m) return null;
  const rows = filterAndSortRows(m.rows, params);
  return { rows, meta: m.meta };
}

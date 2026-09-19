import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { candleAggregator } from "../realtime/candles";
import { eventBus } from "../events";
import { logQualityEvent, validateQuote } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, CryptoMarketRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

const LEVERAGED_RE = /(UP|DOWN|BULL|BEAR)USDT$/i;
const EXCLUDED_BASES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "EUR", "GBP", "TRY", "BRL"]);

interface AllMarket {
  rows: CryptoMarketRow[];
  fetchedAt: number;
  overlaid: number;
  invalid: number;
  suspect: number;
}

function toRow(t: binance.BinanceTicker24h): CryptoMarketRow | null {
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
        const subscribed = candleAggregator.subscribedSymbols();
        const fetchedAt = Date.now();
        if (subscribed.length && overlaid === 0) {
          const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
          for (const sym of subscribed) {
            const row = bySymbol.get(sym);
            if (!row) continue;
            eventBus.emit(`tick:${sym}`, {
              symbol: sym,
              price: row.price,
              cumVolume: row.volume ?? 0,
              cumQuoteVolume: row.quoteVolume ?? 0,
              ts: fetchedAt,
            });
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
  } catch (primaryErr) {
    try {
      const { getCoinGeckoSimplePrices } = await import("../providers/coingecko");
      const cg = await getCoinGeckoSimplePrices();
      const rows: CryptoMarketRow[] = cg.rows.map((r) => ({
        symbol: r.symbol,
        baseAsset: r.baseAsset,
        assetClass: "crypto" as const,
        price: r.price,
        change: null,
        changePercent: r.changePercent,
        open: null,
        high: null,
        low: null,
        volume: null,
        quoteVolume: r.quoteVolume,
        trades24h: null,
        updatedAt: new Date(cg.sourceTs).toISOString(),
      }));
      const btc = rows.find((r) => r.symbol === "BTCUSDT");
      const eth = rows.find((r) => r.symbol === "ETHUSDT");
      const withCh = rows.filter((r) => r.changePercent != null);
      const advancers = withCh.filter((r) => (r.changePercent ?? 0) > 0).length;
      const decliners = withCh.filter((r) => (r.changePercent ?? 0) < 0).length;
      const avgChangePercent = withCh.length
        ? withCh.reduce((a, r) => a + (r.changePercent ?? 0), 0) / withCh.length
        : 0;
      const summary: CryptoSummary = {
        marketCount: rows.length,
        advancers,
        decliners,
        avgChangePercent,
        totalQuoteVolume: rows.reduce((a, r) => a + (r.quoteVolume ?? 0), 0),
        btcChangePercent: btc?.changePercent ?? null,
        ethChangePercent: eth?.changePercent ?? null,
        fetchedAt: new Date(cg.sourceTs).toISOString(),
      };
      const meta = buildMeta({
        source: "coingecko",
        sourceTimestampMs: cg.sourceTs,
        note: `Binance unavailable — fallback CoinGecko simple price (${rows.length} assets)`,
        partial: true,
        slas: { liveSlaMs: 120_000, freshSlaMs: 600_000, delayedSlaMs: 3_600_000 },
      });
      return { rows, summary, meta };
    } catch (fbErr) {
      console.warn("[getCryptoMarkets] binance+coingecko failed", primaryErr, fbErr);
      return null;
    }
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
    const res = await cached(`crypto:klines:${sym}:${interval}:${limit}`, {
      ttlMs: 25_000,
      staleMs: 15 * 60_000,
      producer: async () => ({ bars: await binance.getKlines(sym, interval, limit), fetchedAt: Date.now() }),
    });
    const lastBar = res.value.bars[res.value.bars.length - 1];
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

export async function getCryptoDetail(symbol: string, interval = "1h"): Promise<{ detail: CryptoDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const [tickerRes, klinesRes, fundingRes, oiRes] = await Promise.allSettled([
    binance.getSpotTicker(sym),
    getCryptoKlines(sym, interval, 200),
    binance.getFundingRate(sym),
    binance.getOpenInterest(sym),
  ]);
  if (tickerRes.status === "rejected") return null;
  const t = tickerRes.value;
  const base = toRow(t);
  if (!base) return null;
  const bars = klinesRes.status === "fulfilled" && klinesRes.value ? klinesRes.value.bars : [];
  const technical = bars.length ? analyzeSeries(bars) : null;
  const patterns = bars.length ? detectPatterns(bars) : [];
  let funding = fundingRes.status === "fulfilled" ? fundingRes.value : null;
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
    sourceTimestampMs: t.closeTime ?? Date.now(),
    note: funding ? undefined : "Dữ liệu futures (funding/OI) tạm thờ không khả dụng từ vị trí máy chủ",
    partial: !funding,
  });
  return { detail, meta };
}

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
  let rows = m.rows;
  if (params.minChange != null) rows = rows.filter((r) => (r.changePercent ?? 0) >= (params.minChange as number));
  if (params.maxChange != null) rows = rows.filter((r) => (r.changePercent ?? 0) <= (params.maxChange as number));
  if (params.minQuoteVolume != null) rows = rows.filter((r) => (r.quoteVolume ?? 0) >= (params.minQuoteVolume as number));
  if (params.sort === "gainers") rows = [...rows].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  if (params.sort === "losers") rows = [...rows].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  return { rows: rows.slice(0, params.limit ?? 40), meta: m.meta };
}

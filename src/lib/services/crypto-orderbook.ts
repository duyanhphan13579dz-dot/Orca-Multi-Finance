import "server-only";
import { getOrderBook, ProviderError, type OrderBook } from "../providers/binance";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import type { Meta } from "../types";

/**
 * Crypto ORDER BOOK service (Phase 6) — Binance public depth.
 * Shared cache (2s TTL / 60s stale) + dedup: N clients → 1 provider call.
 * Validation happens in the provider adapter; here we only shape + freshness.
 * Never fabricates levels — unavailable → null → route 502 JSON.
 */

export interface OrderBookResult {
  book: OrderBook;
  meta: Meta;
}

export async function getCryptoOrderBook(symbol: string, limit = 20): Promise<OrderBookResult | null> {
  try {
    const res = await cached(`crypto:orderbook:${symbol.toUpperCase()}:${limit}`, {
      ttlMs: 2_000,
      staleMs: 60_000,
      producer: () => getOrderBook(symbol.toUpperCase(), limit),
    });
    const meta = buildMeta({
      source: "binance-spot",
      sourceTimestampMs: res.value.sourceTimestampMs,
      cached: res.cached,
      stale: res.stale,
      slas: { liveSlaMs: 5_000, freshSlaMs: 30_000, delayedSlaMs: 5 * 60_000 },
    });
    return { book: res.value, meta };
  } catch (e) {
    if (!(e instanceof ProviderError)) {
      // unknown error — still do not leak
    }
    return null;
  }
}

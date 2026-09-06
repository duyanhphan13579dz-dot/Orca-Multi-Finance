/**
 * CHANNEL REGISTRY — single source of truth for event bus channel names.
 * Every module must build channels through these helpers so the gateway,
 * store and tests agree on naming (no ad-hoc strings).
 */

export const CHANNEL = {
  /** provider tick for a symbol — payload: Tick (realtime/candles) */
  tick: (symbol: string) => `tick:${symbol.toUpperCase()}`,
  /** raw kline frame — payload: { symbol, timeframe, candle } */
  kline: (symbol: string, timeframe: string) => `kline:${symbol.toUpperCase()}:${timeframe}`,
  /** live candle update — payload: { symbol, timeframe, candle, quality, transport } */
  candleUpdated: (symbol: string, timeframe: string) => `candle.updated:${symbol.toUpperCase()}:${timeframe}`,
  /** finalized candle — payload: { symbol, timeframe, candle, quality, transport } */
  candleClosed: (symbol: string, timeframe: string) => `candle.closed:${symbol.toUpperCase()}:${timeframe}`,
  /** market store quote write — payload: StoredQuote */
  quote: (symbol: string) => `market.quote:${symbol.toUpperCase()}`,
  /** VN index snapshot — payload: { items, session, checkedAt } */
  vnIndex: "vn.index.updated",
  /** gateway client-side event envelope */
  gateway: "gateway.event",
} as const;

/** Payload types the event model is aware of (documentation + casts). */
export type ChannelKind = "tick" | "kline" | "candle.updated" | "candle.closed" | "quote" | "vn.index" | "gateway";

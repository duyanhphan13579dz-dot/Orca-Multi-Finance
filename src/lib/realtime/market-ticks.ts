import "server-only";
import { eventBus } from "../events";
import { ensureSsiWsStarted, ssiWs } from "./ssi-ws";
import { ensureVndirectWsStarted, vndirectWs } from "./vndirect-ws";

export type MarketTickSource = "vndirect" | "ssi-fallback";

export interface MarketTick {
  symbol: string;
  price: number;
  cumVolume: number;
  cumQuoteVolume: number;
  ts: number;
  source: MarketTickSource;
  degraded: boolean;
}

type SsiQuote = { symbol: string; price: number; volume?: number | null; value?: number | null; eventTime: number };
type SsiIndex = { code: string; value: number; volume?: number; eventTime: number };
type VndirectTick = {
  symbol?: string;
  code?: string;
  price?: number;
  value?: number;
  volume?: number;
  eventTime?: number;
  ts?: number;
};

const PRIMARY_FRESH_MS = 30_000;

const INDEX_SET = new Set([
  "VNINDEX",
  "VN30",
  "HNX",
  "HNX30",
  "UPCOM",
  "VNXALL",
  "VN100",
  "HNXINDEX",
  "UPCOMINDEX",
  "VNI",
]);

function normalizeSym(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

class MarketTickRouter {
  private refs = new Map<string, number>();
  private offs = new Map<string, () => void>();
  private primarySeenAt = new Map<string, number>();

  subscribe(symbol: string): () => void {
    const sym = normalizeSym(symbol);
    if (!sym) return () => {};
    const count = this.refs.get(sym) ?? 0;
    this.refs.set(sym, count + 1);
    if (count === 0) this.attach(sym);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.refs.get(sym) ?? 1) - 1;
      if (next > 0) {
        this.refs.set(sym, next);
        return;
      }
      this.refs.delete(sym);
      this.offs.get(sym)?.();
      this.offs.delete(sym);
      this.primarySeenAt.delete(sym);
    };
  }

  private attach(sym: string) {
    ensureVndirectWsStarted();
    const isIndex = INDEX_SET.has(sym);
    const unwatchVnd = isIndex
      ? (() => {
          vndirectWs.ensureCoreIndices();
          return () => {};
        })()
      : vndirectWs.watchSymbol(sym);
    if (isIndex) vndirectWs.ensureCoreIndices();

    const offVndQuote = eventBus.on(`vndirect:quote:${sym}`, (payload) => {
      const tick = this.fromVndirect(payload as VndirectTick, sym);
      if (!tick) return;
      this.primarySeenAt.set(sym, tick.ts);
      this.publish(sym, tick);
    });
    const offVndIndex = eventBus.on(`vndirect:index:${sym}`, (payload) => {
      const tick = this.fromVndirect(payload as VndirectTick, sym);
      if (!tick) return;
      this.primarySeenAt.set(sym, tick.ts);
      this.publish(sym, tick);
    });

    ensureSsiWsStarted();
    let unwatchSsi: (() => void) | null = null;
    try {
      unwatchSsi = ssiWs.watchSymbol?.(sym) ?? null;
    } catch {
      unwatchSsi = null;
    }
    const offSsiQuote = eventBus.on(`ssi:quote:${sym}`, (payload) => {
      const tick = this.fromSsiQuote(payload as SsiQuote, sym);
      if (!tick || this.primaryIsFresh(sym, tick.ts)) return;
      this.publish(sym, tick);
    });
    const offSsiIndex = eventBus.on(`ssi:index:${sym}`, (payload) => {
      const tick = this.fromSsiIndex(payload as SsiIndex, sym);
      if (!tick || this.primaryIsFresh(sym, tick.ts)) return;
      this.publish(sym, tick);
    });

    this.offs.set(sym, () => {
      unwatchVnd();
      unwatchSsi?.();
      offVndQuote();
      offVndIndex();
      offSsiQuote();
      offSsiIndex();
    });
  }

  private primaryIsFresh(sym: string, ts: number): boolean {
    const seen = this.primarySeenAt.get(sym);
    return seen != null && ts >= seen && ts - seen <= PRIMARY_FRESH_MS;
  }

  private publish(sym: string, tick: MarketTick) {
    eventBus.emit(`market-tick:${sym}`, tick);
  }

  private fromVndirect(payload: VndirectTick, fallback: string): MarketTick | null {
    const symbol = normalizeSym(String(payload.symbol ?? payload.code ?? fallback));
    const price = Number(payload.price ?? payload.value);
    const ts = Number(payload.ts ?? payload.eventTime ?? Date.now());
    if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) return null;
    return {
      symbol,
      price,
      cumVolume: Math.max(0, Number(payload.volume ?? 0)),
      cumQuoteVolume: Math.max(0, Number(payload.value ?? 0)),
      ts,
      source: "vndirect",
      degraded: false,
    };
  }

  private fromSsiQuote(payload: SsiQuote, fallback: string): MarketTick | null {
    const symbol = normalizeSym(String(payload.symbol ?? fallback));
    const price = Number(payload.price);
    const ts = Number(payload.eventTime);
    if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) return null;
    return {
      symbol,
      price,
      cumVolume: Math.max(0, Number(payload.volume ?? 0)),
      cumQuoteVolume: Math.max(0, Number(payload.value ?? 0)),
      ts,
      source: "ssi-fallback",
      degraded: true,
    };
  }

  private fromSsiIndex(payload: SsiIndex, fallback: string): MarketTick | null {
    const symbol = normalizeSym(String(payload.code ?? fallback));
    const price = Number(payload.value);
    const ts = Number(payload.eventTime);
    if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) return null;
    return {
      symbol,
      price,
      cumVolume: Math.max(0, Number(payload.volume ?? 0)),
      cumQuoteVolume: 0,
      ts,
      source: "ssi-fallback",
      degraded: true,
    };
  }
}

const globalState = globalThis as typeof globalThis & { __orcaMarketTickRouter?: MarketTickRouter };
export const marketTickRouter = globalState.__orcaMarketTickRouter ?? new MarketTickRouter();
globalState.__orcaMarketTickRouter = marketTickRouter;

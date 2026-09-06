import "server-only";

/**
 * CENTRAL EVENT BUS — in-process pub/sub for realtime distribution.
 * Channels used by the chart engine:
 *   tick:{SYMBOL}              provider tick (price/volume/ts)
 *   candle.updated:{SYM}:{TF}  live current-candle update
 *   candle.closed:{SYM}:{TF}   finalized candle (persist/eligible)
 * Ready to be replaced/bridged by Redis pub/sub when scaling horizontally.
 */

export type BusHandler = (payload: unknown) => void;

class EventBus {
  private channels = new Map<string, Set<BusHandler>>();
  private any: BusHandler[] = [];

  on(channel: string, handler: BusHandler): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(handler);
    return () => this.off(channel, handler);
  }

  /** Observe every emitted channel (market store / gateway fan-out). */
  onAny(handler: BusHandler): () => void {
    this.any.push(handler);
    return () => {
      const i = this.any.indexOf(handler);
      if (i >= 0) this.any.splice(i, 1);
    };
  }

  off(channel: string, handler: BusHandler) {
    const set = this.channels.get(channel);
    set?.delete(handler);
    if (set && set.size === 0) this.channels.delete(channel);
  }

  emit(channel: string, payload: unknown) {
    const set = this.channels.get(channel);
    if (set) {
      for (const h of set) {
        try {
          h(payload);
        } catch {
          /* isolate handler failures */
        }
      }
    }
    for (const h of this.any) {
      try {
        h(payload);
      } catch {
        /* isolate handler failures */
      }
    }
  }

  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  stats() {
    return { channels: this.channels.size, subs: [...this.channels.values()].reduce((a, s) => a + s.size, 0) };
  }
}

const g = globalThis as typeof globalThis & { __orcaEventBus?: EventBus };
export const eventBus = g.__orcaEventBus ?? new EventBus();
g.__orcaEventBus = eventBus;

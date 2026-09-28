import "server-only";
import { getVnSession } from "../vn/sessions";

/**
 * Session-aware market data poller — keeps VN board/indices/liquid quotes warm
 * during continuous matching with the lowest practical latency on serverless.
 *
 * Cadence (Asia/Ho_Chi_Minh):
 *  - continuous session: ~8–12s
 *  - auction / pre-open / post: ~20s
 *  - lunch / closed: ~90–180s
 *
 * Boots VNDirect + SSI WS when trading; never blocks request path (unref interval).
 * Disable: ORCA_SESSION_POLLER_DISABLED=true
 */

const g = globalThis as typeof globalThis & {
  __orcaSessionPoller?: SessionPoller;
};

type PollStats = {
  started: boolean;
  ticks: number;
  lastAt: number | null;
  lastOk: boolean;
  lastDurationMs: number | null;
  lastQuotes: number;
  lastIndices: number;
  lastError: string | null;
  cadenceMs: number;
  session: string;
};

class SessionPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private ticks = 0;
  private lastAt: number | null = null;
  private lastOk = false;
  private lastDurationMs: number | null = null;
  private lastQuotes = 0;
  private lastIndices = 0;
  private lastError: string | null = null;

  start() {
    if (this.timer) return;
    if (process.env.ORCA_SESSION_POLLER_DISABLED === "true") return;
    this.timer = setInterval(() => void this.tick(), 4_000);
    this.timer.unref?.();
    void this.tick();
  }

  cadenceMs(): number {
    try {
      const s = getVnSession();
      if (s.trading) return 8_000;
      if (s.state === "opening_auction" || s.state === "closing_auction") return 12_000;
      if (s.state === "pre_open" || s.state === "post_trading") return 20_000;
      if (s.state === "lunch_break") return 45_000;
      return 120_000;
    } catch {
      return 90_000;
    }
  }

  private async tick() {
    if (this.running) return;
    const due = this.cadenceMs();
    if (this.lastAt != null && Date.now() - this.lastAt < due - 1_500) return;

    this.running = true;
    this.ticks += 1;
    const t0 = Date.now();
    try {
      try {
        const session = getVnSession();
        if (session.open || session.trading) {
          const { ensureVndirectWsStarted } = await import("./vndirect-ws");
          const { ensureSsiWsStarted } = await import("./ssi-ws");
          ensureVndirectWsStarted();
          ensureSsiWsStarted();
        }
      } catch {
        /* optional */
      }

      const { getVnMarketBoard, getVnIndices, getVnQuotes } = await import("../services/stocks");
      const { LIQUID_BOARD } = await import("../providers/public-vn-feed");

      const [board, indices, liquid] = await Promise.all([
        getVnMarketBoard().catch(() => null),
        getVnIndices().catch(() => null),
        getVnQuotes(LIQUID_BOARD.slice(0, 40)).catch(() => null),
      ]);

      this.lastQuotes = board?.quotes?.length ?? liquid?.quotes?.length ?? 0;
      this.lastIndices = board?.indices?.length ?? indices?.items?.length ?? 0;
      this.lastOk = this.lastQuotes > 0 || this.lastIndices > 0;
      this.lastError = this.lastOk ? null : "empty board/quotes";
      this.lastDurationMs = Date.now() - t0;
      this.lastAt = Date.now();
    } catch (e) {
      this.lastOk = false;
      this.lastError = e instanceof Error ? e.message : "poll failed";
      this.lastDurationMs = Date.now() - t0;
      this.lastAt = Date.now();
    } finally {
      this.running = false;
    }
  }

  stats(): PollStats {
    let session = "unknown";
    try {
      session = getVnSession().state;
    } catch {
      /* */
    }
    return {
      started: Boolean(this.timer),
      ticks: this.ticks,
      lastAt: this.lastAt,
      lastOk: this.lastOk,
      lastDurationMs: this.lastDurationMs,
      lastQuotes: this.lastQuotes,
      lastIndices: this.lastIndices,
      lastError: this.lastError,
      cadenceMs: this.cadenceMs(),
      session,
    };
  }
}

export const sessionPoller = g.__orcaSessionPoller ?? new SessionPoller();
g.__orcaSessionPoller = sessionPoller;

export function ensureSessionPollerStarted() {
  sessionPoller.start();
  return sessionPoller.stats();
}

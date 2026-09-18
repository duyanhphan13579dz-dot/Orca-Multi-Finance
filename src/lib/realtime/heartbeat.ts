import "server-only";
import { probeNetworkLatency } from "../network-latency";
import { getVnSession } from "../vn/sessions";

/**
 * Process-level heartbeat orchestrator.
 *
 * - Warms active network RTT samples (ops + circuit) without waiting for UI traffic
 * - Session-aware cadence: denser during continuous trading, sparse off-hours
 * - Single unref'd interval; disable with ORCA_HEARTBEAT_DISABLED=true
 *
 * Does not replace WS watchdogs (vndirect / ssi / binance).
 */

const g = globalThis as typeof globalThis & { __orcaHeartbeat?: Heartbeat };

const SESSION_MS = 45_000;
const OFFHOURS_MS = 120_000;
const TICK_MS = 15_000;

class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastProbeAt: number | null = null;
  private lastOk = 0;
  private lastFail = 0;
  private ticks = 0;

  start() {
    if (this.timer) return;
    if (process.env.ORCA_HEARTBEAT_DISABLED === "true") return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  private dueMs(): number {
    try {
      const s = getVnSession();
      return s.trading || s.open ? SESSION_MS : OFFHOURS_MS;
    } catch {
      return OFFHOURS_MS;
    }
  }

  private async tick() {
    if (this.running) return;
    const due = this.dueMs();
    if (this.lastProbeAt != null && Date.now() - this.lastProbeAt < due - 2_000) return;

    this.running = true;
    this.ticks += 1;
    try {
      const report = await probeNetworkLatency({ force: true, timeoutMs: 4_000 });
      this.lastProbeAt = Date.now();
      this.lastOk = report.summary.ok;
      this.lastFail = report.summary.fail;
    } catch {
      this.lastProbeAt = Date.now();
      this.lastFail += 1;
    } finally {
      this.running = false;
    }
  }

  stats() {
    return {
      started: Boolean(this.timer),
      ticks: this.ticks,
      lastProbeAt: this.lastProbeAt ? new Date(this.lastProbeAt).toISOString() : null,
      lastOk: this.lastOk,
      lastFail: this.lastFail,
      nextCadenceMs: this.dueMs(),
      sessionTrading: (() => {
        try {
          return getVnSession().trading;
        } catch {
          return false;
        }
      })(),
    };
  }
}

export const processHeartbeat = g.__orcaHeartbeat ?? new Heartbeat();
g.__orcaHeartbeat = processHeartbeat;

export function ensureHeartbeatStarted() {
  processHeartbeat.start();
}

import "server-only";
import { ensureBinanceWsStarted } from "./binance-ws";
import { ensureBiquoteCoreWatch, ensureBiquotePollStarted } from "./biquote-poll";

/**
 * Boot crypto WS + forex Biquote poll (core FX/metals/oil universe).
 * Safe to call from any API route; no-ops when WS policy disables sockets.
 */

let booted = false;

export function ensureCryptoForexRealtime(): void {
  if (booted) return;
  booted = true;
  try {
    ensureBinanceWsStarted();
  } catch {
    /* Workers may disable WS via policy */
  }
  try {
    ensureBiquotePollStarted();
    ensureBiquoteCoreWatch();
  } catch {
    /* */
  }
}

export async function ensureCryptoForexRealtimeAsync(): Promise<void> {
  ensureCryptoForexRealtime();
}

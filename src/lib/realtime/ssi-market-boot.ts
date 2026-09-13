import "server-only";
import { ensureSsiWsStarted, ssiWs } from "./ssi-ws";
import { ssiFcConfigured } from "../providers/ssi-fcdata";
import { env } from "../env";

/** VN30 + liquid names — preload when All stream data is granted on SSI Developer */
const LIQUID = [
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB", "TCB",
  "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
];

/**
 * Boot SSI market data after developer grants:
 * All api data + All stream data (+ optional trading scopes unused here).
 * Idempotent — safe on every stocks API hit.
 */
export function bootSsiMarketDataPipeline(): {
  ok: boolean;
  reason?: string;
  preloaded?: number;
  indices?: boolean;
} {
  if (!ssiFcConfigured()) return { ok: false, reason: "ssi_not_configured" };
  if (env.ssiWsDisabled) return { ok: false, reason: "ssi_ws_disabled" };

  ensureSsiWsStarted();
  ssiWs.ensureCoreIndices();

  if (!env.ssiWsPreload) {
    return { ok: true, preloaded: 0, indices: true };
  }

  let n = 0;
  for (const s of LIQUID) {
    ssiWs.watchSymbol(s);
    n += 1;
  }
  return { ok: true, preloaded: n, indices: true };
}

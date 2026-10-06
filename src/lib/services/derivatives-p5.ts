import "server-only";
import { buildMeta } from "../freshness";
import type { Meta } from "../types";
import {
  getDerivativesSnapshot,
  getDerivativesSnapshotWithFlow,
  getDerivativesRegime,
  getDerivativesHistory,
} from "./derivatives";
import { persistDerivativeRows, loadPricesFromDb } from "./derivatives-persist";
import { evaluateDerivAlerts, type DerivAlert } from "../engines/derivatives-alerts";

export type { DerivAlert };

export async function pollAndPersistDerivatives(opts?: {
  coreOnly?: boolean;
}): Promise<{
  data: {
    contracts: number;
    withQuote: number;
    persist: { attempted: boolean; written: number; error: string | null };
    alerts: DerivAlert[];
  };
  meta: Meta;
}> {
  const snap = await getDerivativesSnapshotWithFlow({
    coreOnly: opts?.coreOnly !== false,
  });
  const persist = await persistDerivativeRows(snap.data.contracts);
  const regime = await getDerivativesRegime({ underlying: "VN30" });
  const alerts = evaluateDerivAlerts(
    snap.data.contracts.map((c) => ({
      symbol: c.symbol,
      last: c.quote?.last ?? null,
      basis: c.basis?.basis ?? null,
      openInterest: c.quote?.openInterest ?? null,
      regimeKind: regime.data.regime.kind,
      curveShape: regime.data.curveShape,
    })),
  );
  const withQuote = snap.data.contracts.filter((c) => c.quote?.last != null).length;
  const meta = buildMeta({
    source: snap.meta.source,
    sourceTimestampMs: Date.now(),
    cached: false,
    stale: snap.meta.stale,
    partial: withQuote === 0 || persist.error != null,
    note: persist.error
      ? `poll ok · persist error: ${persist.error}`
      : `poll ${withQuote}/${snap.data.contracts.length} quotes · persist written=${persist.written}`,
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return {
    data: {
      contracts: snap.data.contracts.length,
      withQuote,
      persist,
      alerts,
    },
    meta,
  };
}

export async function getDerivativesAlerts(underlying = "VN30"): Promise<{
  data: { alerts: DerivAlert[]; underlying: string };
  meta: Meta;
}> {
  const [snap, regime] = await Promise.all([
    getDerivativesSnapshot({ coreOnly: underlying === "VN30" }),
    getDerivativesRegime({ underlying }),
  ]);
  const alerts = evaluateDerivAlerts(
    snap.data.contracts
      .filter((c) => c.underlying === underlying)
      .map((c) => ({
        symbol: c.symbol,
        last: c.quote?.last ?? null,
        basis: c.basis?.basis ?? null,
        openInterest: c.quote?.openInterest ?? null,
        regimeKind: regime.data.regime.kind,
        curveShape: regime.data.curveShape,
      })),
  );
  const meta = buildMeta({
    source: snap.meta.source,
    sourceTimestampMs: Date.now(),
    cached: snap.meta.cached,
    stale: snap.meta.stale,
    partial: alerts.length === 0 && snap.meta.partial,
    note: alerts.length ? `${alerts.length} alert(s)` : "No alerts",
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return { data: { alerts, underlying }, meta };
}

export async function getDerivativesHistoryMerged(symbol: string, limit = 48) {
  const base = await getDerivativesHistory(symbol, limit);
  if (!base) return null;
  if (base.data.samples.length > 0) return base;
  const fromDb = await loadPricesFromDb(symbol, limit);
  if (fromDb.length) {
    return {
      data: {
        symbol: symbol.toUpperCase(),
        samples: fromDb,
        note: `${fromDb.length} sample(s) from derivative_prices (DB)`,
      },
      meta: {
        ...base.meta,
        partial: false,
        note: "DB history",
        source: "derivative_prices",
      },
    };
  }
  return base;
}

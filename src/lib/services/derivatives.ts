import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import type {
  DerivativeBasis,
  DerivativeContract,
  DerivativeContractRow,
  DerivativeFlowSignal,
  DerivativeProduct,
  DerivativeQuote,
  Meta,
  OhlcvBar,
} from "../types";
import {
  PRODUCT_CATALOG,
  buildContractMaster,
  getContractBySymbol,
  getProductById,
  VSDC,
} from "../providers/vsdc-spec";
import {
  derivativesLiveConfigured,
  getDerivativeMarketQuote,
  getDerivativeMarketQuotes,
  fetchDerivativeOhlcv,
  HNX_DERIVATIVES,
} from "../providers/hnx-derivatives";
import { classifyDerivFlow, flowFromQuotes } from "../engines/derivatives-flow";
import { buildTermStructure, estimateRollYieldAnnualized, type TermStructureResult } from "../engines/derivatives-curve";
import { classifyDerivRegime, type DerivRegime } from "../engines/derivatives-regime";
import {
  recordDerivSample,
  getPriorSample,
  getDerivHistoryPayload,
  type DerivHistorySample,
} from "./derivatives-history";
import {
  MARGIN_SCHEDULE,
  getMarginForProduct,
  estimateInitialMarginVnd,
  type MarginScheduleEntry,
} from "../providers/vsdc-margin";

/** Vietnam Derivatives service — P0–P4. No fabricated prices. */

export interface DerivativesCatalog {
  products: DerivativeProduct[];
  contracts: DerivativeContract[];
  liveConfigured: boolean;
  note: string;
}

export interface DerivativesSnapshot {
  contracts: DerivativeContractRow[];
  spot: { symbol: string; price: number | null; source: string | null };
  liveConfigured: boolean;
  note: string;
}

async function resolveVn30Spot(): Promise<{ price: number | null; source: string | null; ts: number | null }> {
  try {
    const { getPublicIndices } = await import("../providers/public-vn-feed");
    const idx = await getPublicIndices(["VN30"]);
    const row = idx?.items?.find((i) => String(i.code).toUpperCase() === "VN30");
    if (row && Number(row.value) > 0) {
      return {
        price: Number(row.value),
        source: "public-vn",
        ts: row.updatedAt ? Date.parse(row.updatedAt) : (idx.sourceTs ?? Date.now()),
      };
    }
  } catch { /* try vndirect */ }
  try {
    const { getVndIndices } = await import("../providers/vndirect");
    const idx = await getVndIndices();
    const row = idx?.items?.find((i) => String(i.code).toUpperCase() === "VN30");
    if (row && Number(row.value) > 0) {
      return {
        price: Number(row.value),
        source: "vndirect",
        ts: row.updatedAt ? Date.parse(row.updatedAt) : (idx.sourceTs ?? Date.now()),
      };
    }
  } catch { /* none */ }
  return { price: null, source: null, ts: null };
}

export function computeBasis(
  futuresLast: number | null | undefined,
  spot: number | null | undefined,
): DerivativeBasis | null {
  if (futuresLast == null || spot == null) return null;
  if (!Number.isFinite(futuresLast) || !Number.isFinite(spot) || spot <= 0) return null;
  const basis = futuresLast - spot;
  const basisPct = (basis / spot) * 100;
  return { basis, basisPct, futuresLast, spot, computedAt: new Date().toISOString() };
}

export async function getDerivativesCatalog(): Promise<{ data: DerivativesCatalog; meta: Meta }> {
  const contracts = buildContractMaster();
  const liveConfigured = derivativesLiveConfigured();
  const data: DerivativesCatalog = {
    products: PRODUCT_CATALOG,
    contracts,
    liveConfigured,
    note: liveConfigured
      ? "Contract Master VSDC + live quote adapter configured"
      : "Contract Master VSDC seed only — set SSI_* or DERIVATIVES_QUOTE_URL for live quotes",
  };
  const meta = buildMeta({
    source: VSDC,
    sourceTimestampMs: Date.now(),
    cached: false,
    stale: false,
    partial: !liveConfigured,
    note: data.note,
    slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
  });
  return { data, meta };
}

export async function getDerivativeContractDetail(
  symbol: string,
): Promise<{ data: DerivativeContractRow; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const contract = getContractBySymbol(sym);
  if (!contract) return null;
  const res = await cached(`derivatives:detail:${sym}`, {
    ttlMs: 15_000,
    staleMs: 120_000,
    producer: async () => {
      const quote = await getDerivativeMarketQuote(sym);
      const spot = await resolveVn30Spot();
      const basis =
        contract.underlying === "VN30" ? computeBasis(quote?.last ?? null, spot.price) : null;
      return { quote, spot, basis, fetchedAt: Date.now() };
    },
  });
  const row: DerivativeContractRow = { ...contract, quote: res.value.quote, basis: res.value.basis };
  const srcTs = res.value.quote?.updatedAt ? Date.parse(res.value.quote.updatedAt) : res.value.fetchedAt;
  const meta = buildMeta({
    source: res.value.quote?.source ?? VSDC,
    sourceTimestampMs: Number.isFinite(srcTs) ? srcTs : res.value.fetchedAt,
    cached: res.cached,
    stale: res.stale,
    partial: !res.value.quote,
    note: res.value.quote ? undefined : "Quote unavailable — contract master only",
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return { data: row, meta };
}

export async function getDerivativesSnapshot(opts?: {
  symbols?: string[];
  coreOnly?: boolean;
}): Promise<{ data: DerivativesSnapshot; meta: Meta }> {
  const all = buildContractMaster();
  let contracts = all;
  if (opts?.symbols?.length) {
    const set = new Set(opts.symbols.map((s) => s.toUpperCase()));
    contracts = all.filter((c) => set.has(c.symbol));
  } else if (opts?.coreOnly !== false) {
    contracts = all.filter((c) => c.underlying === "VN30" && c.status === "ACTIVE");
  }
  const symbols = contracts.map((c) => c.symbol);
  const res = await cached(`derivatives:snapshot:${symbols.join(",")}`, {
    ttlMs: 15_000,
    staleMs: 120_000,
    producer: async () => {
      const [quotes, spot] = await Promise.all([
        getDerivativeMarketQuotes(symbols),
        resolveVn30Spot(),
      ]);
      return { quotes, spot, fetchedAt: Date.now() };
    },
  });
  const rows: DerivativeContractRow[] = contracts.map((c) => {
    const quote = res.value.quotes.get(c.symbol) ?? null;
    const basis =
      c.underlying === "VN30" ? computeBasis(quote?.last ?? null, res.value.spot.price) : null;
    return { ...c, quote, basis };
  });
  const anyQuote = rows.some((r) => r.quote?.last != null);
  const liveConfigured = derivativesLiveConfigured();
  const data: DerivativesSnapshot = {
    contracts: rows,
    spot: { symbol: "VN30", price: res.value.spot.price, source: res.value.spot.source },
    liveConfigured,
    note: anyQuote
      ? "Snapshot with live quotes"
      : liveConfigured
        ? "Live adapter configured but quotes returned empty"
        : "No live quote source — N/A until SSI or DERIVATIVES_QUOTE_URL",
  };
  const meta = buildMeta({
    source: anyQuote ? HNX_DERIVATIVES : VSDC,
    sourceTimestampMs: res.value.fetchedAt,
    cached: res.cached,
    stale: res.stale,
    partial: !anyQuote,
    note: data.note,
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return { data, meta };
}

export function listProducts(): DerivativeProduct[] {
  return PRODUCT_CATALOG;
}

const priorQuoteMem = new Map<
  string,
  { last: number | null; openInterest: number | null; volume: number | null; basis: number | null; at: number }
>();

function rememberQuote(
  symbol: string,
  q: { last: number | null; openInterest?: number | null; volume?: number | null },
  basis: number | null,
) {
  priorQuoteMem.set(symbol.toUpperCase(), {
    last: q.last,
    openInterest: q.openInterest ?? null,
    volume: q.volume ?? null,
    basis,
    at: Date.now(),
  });
}

export async function getDerivativeOhlcv(
  symbol: string,
  days = 60,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const contract = getContractBySymbol(sym);
  if (!contract) return null;
  const res = await cached(`derivatives:ohlcv:${sym}:${days}`, {
    ttlMs: 60_000,
    staleMs: 30 * 60_000,
    producer: async () => {
      const bars = await fetchDerivativeOhlcv(sym, days);
      return { bars, fetchedAt: Date.now() };
    },
  });
  const last = res.value.bars[res.value.bars.length - 1];
  const meta = buildMeta({
    source: res.value.bars.length ? HNX_DERIVATIVES : VSDC,
    sourceTimestampMs: last?.time ?? res.value.fetchedAt,
    cached: res.cached,
    stale: res.stale,
    partial: res.value.bars.length === 0,
    note:
      res.value.bars.length === 0
        ? "Chưa có OHLCV phái sinh — cấu hình SSI hoặc DERIVATIVES_OHLCV_URL"
        : undefined,
    slas: { liveSlaMs: 120_000, freshSlaMs: 600_000, delayedSlaMs: 3_600_000 },
  });
  return { bars: res.value.bars, meta };
}

export function buildFlowForRow(row: DerivativeContractRow): DerivativeFlowSignal {
  const sym = row.symbol.toUpperCase();
  const memPrior = priorQuoteMem.get(sym) ?? null;
  const histPrior = getPriorSample(sym, 60_000);
  const prior =
    memPrior ??
    (histPrior
      ? {
          last: histPrior.last,
          openInterest: histPrior.openInterest,
          volume: histPrior.volume,
          basis: histPrior.basis,
          at: histPrior.ts,
        }
      : null);
  const q = row.quote;
  const signal = flowFromQuotes(
    sym,
    {
      last: q?.last ?? null,
      openInterest: q?.openInterest ?? null,
      volume: q?.volume ?? null,
      change: q?.change ?? null,
    },
    prior ? { last: prior.last, openInterest: prior.openInterest, volume: prior.volume } : null,
    row.basis?.basis ?? null,
    prior?.basis ?? null,
  );
  if (q) {
    rememberQuote(sym, q, row.basis?.basis ?? null);
    recordDerivSample({
      symbol: sym,
      ts: Date.now(),
      last: q.last ?? null,
      openInterest: q.openInterest ?? null,
      volume: q.volume ?? null,
      basis: row.basis?.basis ?? null,
      source: q.source ?? null,
    });
  }
  return signal as DerivativeFlowSignal;
}

export interface DerivativesSnapshotWithFlow extends DerivativesSnapshot {
  flow: DerivativeFlowSignal[];
}

export async function getDerivativesSnapshotWithFlow(opts?: {
  symbols?: string[];
  coreOnly?: boolean;
}): Promise<{ data: DerivativesSnapshotWithFlow; meta: Meta }> {
  const base = await getDerivativesSnapshot(opts);
  const flow = base.data.contracts.map((row) => buildFlowForRow(row));
  return {
    data: { ...base.data, flow },
    meta: {
      ...base.meta,
      note: [base.data.note, "Flow Engine P1.5: ΔOI từ process prior hoặc history P3."]
        .filter(Boolean)
        .join(" · "),
    },
  };
}

export { classifyDerivFlow };

/* P2 curve / margin */

export type { TermStructureResult } from "../engines/derivatives-curve";
export type { MarginScheduleEntry } from "../providers/vsdc-margin";

export async function getDerivativesTermStructure(opts?: {
  underlying?: string;
}): Promise<{ data: TermStructureResult; meta: Meta }> {
  const underlying = (opts?.underlying ?? "VN30").toUpperCase();
  const master = buildContractMaster().filter((c) => c.underlying === underlying);
  const symbols = master.map((c) => c.symbol);
  const snap = await getDerivativesSnapshot({
    coreOnly: false,
    symbols: symbols.length ? symbols : undefined,
  });
  const rows = snap.data.contracts.filter((c) => c.underlying === underlying);
  const inputs = rows.map((c) => ({
    symbol: c.symbol,
    last: c.quote?.last ?? null,
    daysToExpiry: c.daysToExpiry ?? null,
    priority: c.priority ?? null,
    openInterest: c.quote?.openInterest ?? null,
    volume: c.quote?.volume ?? null,
    basis: c.basis?.basis ?? null,
  }));
  const spot = underlying === "VN30" ? snap.data.spot.price : null;
  const curve = buildTermStructure(underlying, inputs, spot);
  if (curve.spreads.length && curve.points.length >= 2) {
    const a = curve.points[0];
    const b = curve.points[1];
    if (a.last != null && b.last != null) {
      const ry = estimateRollYieldAnnualized(a.last, b.last, a.daysToExpiry, b.daysToExpiry);
      curve.rollYieldAnnualizedPct = ry != null ? Math.round(ry * 100) / 100 : null;
    }
  }
  const meta = buildMeta({
    source: snap.meta.source,
    sourceTimestampMs: Date.now(),
    cached: snap.meta.cached,
    stale: snap.meta.stale,
    partial: curve.shape === "insufficient" || curve.points.every((p) => p.last == null),
    note: curve.note,
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return { data: curve, meta };
}

export function getMarginSchedule(productId?: string): MarginScheduleEntry[] {
  if (productId) {
    const m = getMarginForProduct(productId);
    return m ? [m] : [];
  }
  return [...MARGIN_SCHEDULE];
}

export function getContractMarginEstimate(symbol: string, last?: number | null) {
  const c = getContractBySymbol(symbol);
  if (!c) return null;
  return {
    symbol: c.symbol,
    productId: c.productId,
    ...estimateInitialMarginVnd(c.productId, last ?? null, c.multiplier ?? null),
  };
}

/* P3 history / P4 regime */

export type { DerivRegime } from "../engines/derivatives-regime";
export type { DerivHistorySample };

export async function getDerivativesRegime(opts?: {
  underlying?: string;
}): Promise<{
  data: {
    underlying: string;
    regime: DerivRegime;
    flowKind: string | null;
    curveShape: string | null;
    frontBasis: number | null;
    frontSymbol: string | null;
  };
  meta: Meta;
}> {
  const underlying = (opts?.underlying ?? "VN30").toUpperCase();
  const [snap, curve] = await Promise.all([
    getDerivativesSnapshotWithFlow({
      coreOnly: false,
      symbols: buildContractMaster()
        .filter((c) => c.underlying === underlying)
        .map((c) => c.symbol),
    }),
    getDerivativesTermStructure({ underlying }),
  ]);
  const frontSym = curve.data.front?.symbol ?? snap.data.contracts[0]?.symbol ?? null;
  const flow =
    snap.data.flow.find((f) => f.symbol === frontSym) ?? snap.data.flow[0] ?? null;
  const regime = classifyDerivRegime({
    flowKind: (flow?.kind as import("../engines/derivatives-flow").DerivFlowKind) ?? null,
    flowConfidence: flow?.confidence ?? null,
    curveShape: curve.data.shape,
    frontBasis: curve.data.frontBasis,
  });
  const anyData =
    (flow?.kind != null && flow.kind !== "insufficient") ||
    curve.data.shape !== "insufficient" ||
    curve.data.frontBasis != null;
  const meta = buildMeta({
    source: snap.meta.source,
    sourceTimestampMs: Date.now(),
    cached: snap.meta.cached,
    stale: snap.meta.stale,
    partial: !anyData || regime.kind === "insufficient",
    note: regime.description,
    slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
  });
  return {
    data: {
      underlying,
      regime,
      flowKind: flow?.kind ?? null,
      curveShape: curve.data.shape,
      frontBasis: curve.data.frontBasis,
      frontSymbol: frontSym,
    },
    meta,
  };
}

export async function getDerivativesHistory(symbol: string, limit = 48) {
  const sym = symbol.toUpperCase();
  if (!getContractBySymbol(sym)) return null;
  const payload = await getDerivHistoryPayload(sym, limit);
  const meta = buildMeta({
    source: "derivatives-history",
    sourceTimestampMs: payload.samples.at(-1)?.ts ?? Date.now(),
    cached: false,
    stale: false,
    partial: payload.samples.length === 0,
    note: payload.note,
    slas: { liveSlaMs: 60_000, freshSlaMs: 600_000, delayedSlaMs: 3_600_000 },
  });
  return { data: payload, meta };
}

export async function getDerivativesBriefBlock(): Promise<{
  available: boolean;
  lines: string[];
  regime: DerivRegime | null;
  metaNote: string;
}> {
  try {
    const { data, meta } = await getDerivativesRegime({ underlying: "VN30" });
    const lines: string[] = [];
    if (data.regime.kind === "insufficient") {
      return {
        available: false,
        lines: [
          "VN30F / basis / OI: chưa đủ quote live — block UNAVAILABLE (không suy diễn).",
        ],
        regime: data.regime,
        metaNote: meta.note ?? data.regime.description,
      };
    }
    lines.push(
      `Regime phái sinh: ${data.regime.titleVi} (${data.regime.kind}) · conf ${Math.round(data.regime.confidence * 100)}%`,
    );
    if (data.frontSymbol) {
      lines.push(
        `Front: ${data.frontSymbol}` +
          (data.frontBasis != null
            ? ` · basis ${data.frontBasis >= 0 ? "+" : ""}${data.frontBasis.toFixed(1)} pts`
            : "") +
          (data.flowKind ? ` · flow ${data.flowKind}` : "") +
          (data.curveShape ? ` · curve ${data.curveShape}` : ""),
      );
    }
    lines.push(data.regime.description);
    return { available: true, lines, regime: data.regime, metaNote: meta.note ?? "" };
  } catch {
    return {
      available: false,
      lines: ["VN30F / basis / OI: lỗi pipeline phái sinh — UNAVAILABLE."],
      regime: null,
      metaNote: "error",
    };
  }
}

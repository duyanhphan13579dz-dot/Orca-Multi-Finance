/**
 * VIETNAM DATA ENGINE (Phase 5) — VNDirect là provider CHÍNH & DUY NHẤT.
 *
 *  ✓ healthy-aware selection   — circuit-open → bỏ qua adapter
 *  ✓ VNDirect first            — single-provider, không reconciliation
 *  ✓ archive fallback (OHLCV)  — chỉ fallback vào lịch sử tự lưu của hệ thống
 *  ✓ data confidence           — Phase 2 worst-of, single-source → tối đa medium
 *  ✓ health telemetry          — recordSuccess/recordFailure
 *
 * Adapters inject được (constructor) → deterministic unit tests với fake
 * provider; production dùng real adapter bao quanh src/lib/providers/vndirect.
 */

import "server-only";
import { computeQuoteConfidence, type DataConfidence } from "../confidence";
import { validateQuote } from "../quality";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { isCircuitOpen, recordSuccess, recordFailure } from "../health";
import * as vndirect from "../providers/vndirect";
import type { IndexQuote, OhlcvBar, Quote } from "../types";

export interface VnQuoteAdapter {
  id: string;
  priority: number; // 1 = primary (chỉ VNDirect trong production)
  getQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }>;
}

export interface VnIndicesAdapter {
  id: string;
  priority: number;
  getIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }>;
}

export interface VnOhlcvAdapter {
  id: string;
  priority: number;
  getOhlcv(symbol: string, limit: number): Promise<OhlcvBar[]>;
}

export interface VnQuoteResolution {
  quotes: Quote[];
  bySymbol: Map<string, { provider: string; providerCount: number; deviationPct: number | null; confidence: DataConfidence }>;
  providers: string[];
  discrepancies: { symbol: string; values: { provider: string; price: number | null }[]; deviationPct: number }[];
  notes: string[];
  sourceTs: number | null;
  degraded: boolean;
  fallback: boolean; // true khi nguồn ngày != VNDirect chính (vd archive/đã offline)
}

export interface VnOhlcvResolution {
  bars: OhlcvBar[];
  provider: string;
  degraded: boolean;
  fallback: boolean;
}

/* --------------------------- default real adapters ------------------------- */

const vndirectQuoteAdapter: VnQuoteAdapter = {
  id: vndirect.VNDIRECT,
  priority: 1,
  getQuotes: async (symbols) => vndirect.getVndQuotes(symbols),
};

const vndirectIndicesAdapter: VnIndicesAdapter = {
  id: vndirect.VNDIRECT,
  priority: 1,
  getIndices: async () => vndirect.getVndIndices(),
};

const vndirectOhlcvAdapter: VnOhlcvAdapter = {
  id: vndirect.VNDIRECT,
  priority: 1,
  getOhlcv: async (symbol, limit) => vndirect.getVndOhlcv(symbol, limit),
};

export interface VnDataEngineOptions {
  quoteAdapters?: VnQuoteAdapter[];
  indicesAdapters?: VnIndicesAdapter[];
  ohlcvAdapters?: VnOhlcvAdapter[];
  isProviderHealthy?: (id: string) => boolean;
  isConfigured?: (adapter: { id: string }) => boolean;
  archiveOhlcv?: (symbol: string, limit: number) => Promise<OhlcvBar[] | null>;
  /** SLA theo phiên VN (TEST hook) */
  slaMs?: (session?: VnSessionInfo) => number;
}

/** SLA theo phiên VN cho quotes (age tính confidence). */
export function vnValidSlaMs(session: VnSessionInfo = getVnSession()): number {
  if (session.trading) return 3 * 60_000; // 3 phút trong phiên khớp lệnh
  if (session.state === "pre_open" || session.state === "lunch_break") return 60 * 60_000;
  return 18 * 3_600_000; // ngoài phiên: dữ liệu chốt phiên là bản mới nhất hợp lệ
}

/**
 * Phân loại trạng thái dữ liệu (LIVE/FRESH/DELAYED/STALE/UNAVAILABLE) theo
 * tuổi dữ liệu + phiên VN — dùng cho meta.freshness của mọi response VN.
 */
export function vnDataState(ageMs: number | null, session: VnSessionInfo = getVnSession()): "LIVE" | "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (ageMs == null) return "UNAVAILABLE";
  const sla = vnValidSlaMs(session);
  if (ageMs <= sla / 3) return "LIVE";
  if (ageMs <= sla) return "FRESH";
  if (ageMs <= sla * 3) return "DELAYED";
  return "STALE";
}

export class VnDataEngine {
  private quoteAdapters: VnQuoteAdapter[];
  private indicesAdapters: VnIndicesAdapter[];
  private ohlcvAdapters: VnOhlcvAdapter[];
  private isProviderHealthy: (id: string) => boolean;
  private isConfigured: (adapter: { id: string }) => boolean;
  private archiveOhlcv?: (symbol: string, limit: number) => Promise<OhlcvBar[] | null>;
  private slaMs: (session?: VnSessionInfo) => number;

  constructor(opts: VnDataEngineOptions = {}) {
    this.quoteAdapters = opts.quoteAdapters ?? [vndirectQuoteAdapter];
    this.indicesAdapters = opts.indicesAdapters ?? [vndirectIndicesAdapter];
    this.ohlcvAdapters = opts.ohlcvAdapters ?? [vndirectOhlcvAdapter];
    this.isProviderHealthy = opts.isProviderHealthy ?? ((id) => !isCircuitOpen(id));
    this.isConfigured = opts.isConfigured ?? (() => true); // VNDirect finfo keyless
    this.archiveOhlcv = opts.archiveOhlcv;
    this.slaMs = opts.slaMs ?? vnValidSlaMs;
  }

  private available<T extends { id: string; priority: number }>(adapters: T[]): T[] {
    return adapters
      .filter((a) => this.isConfigured(a))
      .filter((a) => this.isProviderHealthy(a.id))
      .sort((a, b) => a.priority - b.priority);
  }

  /* --------------------------------- quotes --------------------------------- */

  /** First-success (VNDirect duy nhất): không merge, không reconciliation. */
  async resolveQuotes(symbols: string[]): Promise<VnQuoteResolution> {
    const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const planned = this.available(this.quoteAdapters);
    for (const a of planned) {
      const started = Date.now();
      try {
        const r = await a.getQuotes(syms);
        recordSuccess(a.id, Date.now() - started, "vn-quotes");
        const bySymbol = new Map<string, { provider: string; providerCount: number; deviationPct: number | null; confidence: DataConfidence }>();
        for (const q of r.quotes) {
          const ts = q.updatedAt ? Date.parse(q.updatedAt) : null;
          const quality = validateQuote(q, {
            assetClass: "stock",
            staleMs: this.slaMs(),
            sourceTimestampMs: ts,
          }).status;
          bySymbol.set(q.symbol, {
            provider: a.id,
            providerCount: 1,
            deviationPct: null,
            confidence: computeQuoteConfidence({
              providerCount: 1,
              deviationPct: null,
              quality,
              ageMs: ts != null ? Math.max(0, Date.now() - ts) : null,
              validSlaMs: this.slaMs(),
              providerHealthy: this.isProviderHealthy(a.id),
              secondaryOnly: false,
            }),
          });
        }
        return {
          quotes: r.quotes,
          bySymbol,
          providers: [a.id],
          discrepancies: [],
          notes: ["Nguồn duy nhất VNDirect (finfo) — single-source, không đối chiếu chéo"],
          sourceTs: r.sourceTs,
          degraded: false,
          fallback: false,
        };
      } catch (err) {
        recordFailure(a.id, err instanceof Error ? err.message : "adapter failed", "vn-quotes");
      }
    }
    return {
      quotes: [],
      bySymbol: new Map(),
      providers: [],
      discrepancies: [],
      notes: ["VNDirect không trả dữ liệu (timeout/lỗi/empty) — UNAVAILABLE"],
      sourceTs: null,
      degraded: true,
      fallback: true,
    };
  }

  /* --------------------------------- indices -------------------------------- */

  async resolveIndices(): Promise<{ items: IndexQuote[]; providers: string[]; confidence: DataConfidence | null; degraded: boolean; sourceTs: number | null } | null> {
    const planned = this.available(this.indicesAdapters);
    for (const a of planned) {
      const started = Date.now();
      try {
        const r = await a.getIndices();
        recordSuccess(a.id, Date.now() - started, "vn-indices");
        const ts = r.sourceTs ?? (r.items[0]?.updatedAt ? Date.parse(r.items[0].updatedAt) : null);
        const confidence = computeQuoteConfidence({
          providerCount: 1,
          deviationPct: null,
          quality: "VALID",
          ageMs: ts != null ? Math.max(0, Date.now() - ts) : null,
          validSlaMs: this.slaMs(),
          providerHealthy: this.isProviderHealthy(a.id),
        });
        return { items: r.items, providers: [a.id], confidence, degraded: false, sourceTs: ts };
      } catch (err) {
        recordFailure(a.id, err instanceof Error ? err.message : "adapter failed", "vn-indices");
      }
    }
    return null;
  }

  /* ---------------------------------- OHLCV ---------------------------------- */

  async resolveOhlcv(symbol: string, limit = 250): Promise<VnOhlcvResolution | null> {
    const sym = symbol.toUpperCase();
    const planned = this.available(this.ohlcvAdapters);
    for (const a of planned) {
      const started = Date.now();
      try {
        const bars = await a.getOhlcv(sym, limit);
        if (!bars?.length) throw new Error("empty bars");
        recordSuccess(a.id, Date.now() - started, "vn-ohlcv");
        return { bars, provider: a.id, fallback: false, degraded: false };
      } catch (err) {
        recordFailure(a.id, err instanceof Error ? err.message : "adapter failed", "vn-ohlcv");
      }
    }
    // Archive fallback — lịch sử tự lưu (không phải provider ngoài)
    if (this.archiveOhlcv) {
      try {
        const bars = await this.archiveOhlcv(sym, limit);
        if (bars?.length) return { bars, provider: "archive", fallback: true, degraded: true };
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

const g = globalThis as typeof globalThis & { __orcaVnDataEngine?: VnDataEngine };
export const vnDataEngine =
  g.__orcaVnDataEngine ??
  new VnDataEngine({
    archiveOhlcv: async (symbol, limit) => {
      try {
        const { getArchivedOhlcv } = await import("../services/archive");
        return await getArchivedOhlcv(symbol, limit);
      } catch {
        return null;
      }
    },
  });
g.__orcaVnDataEngine = vnDataEngine;

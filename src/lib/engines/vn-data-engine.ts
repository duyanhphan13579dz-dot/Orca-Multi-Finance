/**
 * VIETNAM MULTI-PROVIDER DATA ENGINE (Phase 2)
 *
 * Orchestrates every VN data fetch across N providers with:
 *   ✓ healthy-aware selection   — circuit-open providers bị loại khỏi vòng gọi
 *   ✓ graceful fallback          — VNStock (primary) → VNDirect (secondary)
 *   ✓ reconciliation             — reconcileQuotes (không lấy trung bình)
 *   ✓ data confidence            — per-symbol DataConfidence (xem confidence.ts)
 *   ✓ health telemetry           — recordSuccess/recordFailure trên từng adapter
 *
 * Adapters được inject (constructor) → deterministic unit tests với fake
 * provider; production dùng real adapters bao quanh src/lib/providers/*.
 */

import "server-only";
import { buildQuoteSet, reconcileQuotes, logDiscrepancies } from "../reconcile";
import { computeQuoteConfidence, type DataConfidence } from "../confidence";
import { validateQuote } from "../quality";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { isCircuitOpen, recordSuccess, recordFailure } from "../health";
import * as vnstock from "../providers/vnstock";
import * as vndirect from "../providers/vndirect";
import { env } from "../env";
import type { IndexQuote, OhlcvBar, Quote } from "../types";

export interface VnQuoteAdapter {
  id: string;
  priority: number; // 1 = primary
  requiresKey?: boolean;
  getQuotes(symbols: string[]): Promise<{ quotes: Quote[]; sourceTs: number | null }>;
}

export interface VnIndicesAdapter {
  id: string;
  priority: number;
  requiresKey?: boolean;
  getIndices(): Promise<{ items: IndexQuote[]; sourceTs: number | null }>;
}

export interface VnOhlcvAdapter {
  id: string;
  priority: number;
  requiresKey?: boolean;
  getOhlcv(symbol: string, limit: number): Promise<OhlcvBar[]>;
}

export interface VnQuoteResolution {
  quotes: Quote[];
  bySymbol: Map<string, { provider: string; providerCount: number; deviationPct: number | null; confidence: DataConfidence }>;
  providers: string[];
  discrepancies: { symbol: string; values: { provider: string; price: number | null }[]; deviationPct: number }[];
  notes: string[];
  sourceTs: number | null;
  degraded: boolean; // có provider kế hoạch thất bại / vắng mặt
  fallback: boolean; // primary không khả dụng
}

export interface VnOhlcvResolution {
  bars: OhlcvBar[];
  provider: string;
  degraded: boolean;
  fallback: boolean;
}

/* --------------------------- default real adapters ------------------------- */

const vnstockQuoteAdapter: VnQuoteAdapter = {
  id: vnstock.VNSTOCK,
  priority: 1,
  requiresKey: true,
  getQuotes: async (symbols) => ({ quotes: await vnstock.getVnQuotes(symbols), sourceTs: Date.now() }),
};

const vndirectQuoteAdapter: VnQuoteAdapter = {
  id: vndirect.VNDIRECT,
  priority: 2,
  getQuotes: async (symbols) => vndirect.getVndQuotes(symbols),
};

const vnstockIndicesAdapter: VnIndicesAdapter = {
  id: vnstock.VNSTOCK,
  priority: 1,
  requiresKey: true,
  getIndices: async () => vnstock.getVnIndices(),
};

const vnstockOhlcvAdapter: VnOhlcvAdapter = {
  id: vnstock.VNSTOCK,
  priority: 1,
  requiresKey: true,
  getOhlcv: async (symbol, limit) => vnstock.getVnOhlcv(symbol, limit),
};

const vndirectOhlcvAdapter: VnOhlcvAdapter = {
  id: vndirect.VNDIRECT,
  priority: 2,
  getOhlcv: async (symbol, limit) => vndirect.getVndOhlcv(symbol, limit),
};

export interface VnDataEngineOptions {
  quoteAdapters?: VnQuoteAdapter[];
  indicesAdapters?: VnIndicesAdapter[];
  ohlcvAdapters?: VnOhlcvAdapter[];
  /** health gate mặc định = circuit breaker của health.ts (inject được trong test) */
  isProviderHealthy?: (id: string) => boolean;
  /** adapter tùy chọn cần key đã cấu hình chưa (mặc định: VNSTOCK_API_KEY) */
  isConfigured?: (adapter: { id: string; requiresKey?: boolean }) => boolean;
  /** cung cấp dữ liệu 1m/BASE (không dùng — giữ interface mở rộng) */
  archiveOhlcv?: (symbol: string, limit: number) => Promise<OhlcvBar[] | null>;
}

/** SLA theo phiên VN cho quotes (age threshold tính confidence). */
export function vnValidSlaMs(session: VnSessionInfo = getVnSession()): number {
  if (session.trading) return 3 * 60_000; // 3 phút trong phiên khớp lệnh
  if (session.state === "pre_open" || session.state === "lunch_break") return 60 * 60_000;
  return 18 * 3_600_000; // ngoài phiên: dữ liệu chốt phiên là bản mới nhất hợp lệ
}

export class VnDataEngine {
  private quoteAdapters: VnQuoteAdapter[];
  private indicesAdapters: VnIndicesAdapter[];
  private ohlcvAdapters: VnOhlcvAdapter[];
  private isProviderHealthy: (id: string) => boolean;
  private isConfigured: (adapter: { id: string; requiresKey?: boolean }) => boolean;
  private archiveOhlcv?: (symbol: string, limit: number) => Promise<OhlcvBar[] | null>;

  constructor(opts: VnDataEngineOptions = {}) {
    this.quoteAdapters = opts.quoteAdapters ?? [vnstockQuoteAdapter, vndirectQuoteAdapter];
    this.indicesAdapters = opts.indicesAdapters ?? [vnstockIndicesAdapter];
    this.ohlcvAdapters = opts.ohlcvAdapters ?? [vnstockOhlcvAdapter, vndirectOhlcvAdapter];
    this.isProviderHealthy = opts.isProviderHealthy ?? ((id) => !isCircuitOpen(id));
    this.isConfigured =
      opts.isConfigured ?? ((a) => (a.requiresKey ? Boolean(env.vnstockApiKey) : true));
    this.archiveOhlcv = opts.archiveOhlcv;
  }

  private available<T extends { id: string; priority: number; requiresKey?: boolean }>(adapters: T[]): T[] {
    return adapters
      .filter((a) => this.isConfigured(a))
      .filter((a) => this.isProviderHealthy(a.id))
      .sort((a, b) => a.priority - b.priority);
  }

  /* --------------------------------- quotes --------------------------------- */

  async resolveQuotes(symbols: string[]): Promise<VnQuoteResolution> {
    const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const planned = this.available(this.quoteAdapters);
    const results = await Promise.all(
      planned.map(async (a) => {
        const started = Date.now();
        try {
          const r = await a.getQuotes(syms);
          recordSuccess(a.id, Date.now() - started, "vn-quotes");
          return { adapter: a, ...r };
        } catch (err) {
          recordFailure(a.id, err instanceof Error ? err.message : "adapter failed", "vn-quotes");
          return null;
        }
      }),
    );
    const ok = results.filter((r): r is NonNullable<typeof r> => r != null);
    const fell = planned.length;
    const providersUsed: string[] = [];
    const notes: string[] = [];
    const degraded = ok.length < planned.length;
    const fallback = !ok.some((r) => r.adapter.priority === 1);

    if (!ok.length) {
      return { quotes: [], bySymbol: new Map(), providers: [], discrepancies: [], notes: ["Không provider nào trả dữ liệu"], sourceTs: null, degraded: true, fallback };
    }

    const sets = ok.map((r) => {
      providersUsed.push(r.adapter.id);
      return buildQuoteSet(r.adapter.id, r.adapter.priority, r.quotes);
    });
    const reconciled = reconcileQuotes(sets);
    const winnersProvider = reconciled.winnerProviders;
    const discrepancies = reconciled.discrepancies;
    notes.push(...reconciled.notes);

    // Per-symbol confidence
    const bySymbol = new Map<string, { provider: string; providerCount: number; deviationPct: number | null; confidence: DataConfidence }>();
    const providerCountBySymbol = new Map<string, number>();
    for (const r of ok) for (const q of r.quotes) providerCountBySymbol.set(q.symbol, (providerCountBySymbol.get(q.symbol) ?? 0) + 1);
    for (const q of reconciled.quotes) {
      const winner = winnersProvider.get(q.symbol);
      const ts = q.updatedAt ? Date.parse(q.updatedAt) : null;
      const dev = discrepancies.find((d) => d.symbol === q.symbol)?.deviationPct ?? null;
      const quality = validateQuote(q, {
        assetClass: "stock",
        staleMs: vnValidSlaMs(),
        sourceTimestampMs: ts,
      }).status;
      bySymbol.set(q.symbol, {
        provider: winner ?? providersUsed[0],
        providerCount: providerCountBySymbol.get(q.symbol) ?? 1,
        deviationPct: dev,
        confidence: computeQuoteConfidence({
          providerCount: providerCountBySymbol.get(q.symbol) ?? 1,
          deviationPct: dev,
          quality,
          ageMs: ts != null ? Math.max(0, Date.now() - ts) : null,
          validSlaMs: vnValidSlaMs(),
          providerHealthy: this.isProviderHealthy(winner ?? providersUsed[0] ?? ""),
          secondaryOnly: fallback,
        }),
      });
    }

    const sourceTs = reconciled.quotes.reduce((acc, q) => {
      const t = q.updatedAt ? Date.parse(q.updatedAt) : 0;
      return Number.isFinite(t) && t > acc ? t : acc;
    }, 0) || null;

    if (fallback) notes.unshift("VNStock (primary) không khả dụng — dùng VNDirect (fallback)");
    if (degraded) {
      const missing = planned.filter((p) => !providersUsed.includes(p.id)).map((p) => p.id);
      notes.unshift(`${missing.join(", ")} khả dụng nhưng thất bại lần này — hệ thống tự chọn nguồn còn lại`);
    }
    void logDiscrepancies(reconciled).catch(() => {});
    void fell;

    return { quotes: reconciled.quotes, bySymbol, providers: providersUsed, discrepancies, notes, sourceTs, degraded, fallback };
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
          validSlaMs: vnValidSlaMs(),
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
        return { bars, provider: a.id, fallback: a.priority !== 1, degraded: false };
      } catch (err) {
        recordFailure(a.id, err instanceof Error ? err.message : "adapter failed", "vn-ohlcv");
      }
    }
    // Archive fallback — giữ lịch sử phục vụ được khi provider offline
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
    // Archive fallback: provider offline → vẫn phục vụ lịch sử đã lưu
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

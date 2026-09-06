/**
 * AGENT PIPELINE (Phase 4) — chuẩn hoá 7 bước theo kiến trúc đề xuất:
 *
 *   User Question → Existing AI UI → Realtime Context → Quant Engine →
 *   Data Confidence → LLM Reasoning → Existing UI Output
 *
 * Module này chỉ lo 3 bước ở giữa (realtime context, confidence, pipeline
 * trace) và KHÔNG đổi contract UI/API:
 *   - overlay là additive field (market_data.realtime, data_meta.data_confidence)
 *   - trace là field meta mới (meta.pipeline) — UI cũ bỏ qua.
 * Quant engine và LLM vẫn nằm trong agent.ts (giữ nguyên hành vi).
 */

import "server-only";
import { marketStore } from "../realtime/market-store";
import { computeQuoteConfidence, aggregateConfidence, type DataConfidence } from "../confidence";
import { vnSlasForSession, getVnSession } from "../vn/sessions";
import { getMarketRegime, getMarketBreadth, getSectorRotation, getMarketEvents } from "./market-intelligence";
import type { Confidence } from "./intelligence";

export interface RealtimeOverlay {
  price: number;
  changePercent: number | null;
  ts: number;
  source: string;
  quality: string;
  freshnessAgeMs: number;
}

/** Bước 3 — overlay quote realtime (market store) vào contract (additive). */
export function overlayRealtime(contract: Record<string, unknown>, symbols: string[]): {
  market_data: Record<string, unknown> | null;
  confidences: DataConfidence[];
  overlaid: number;
  providers: string[];
} {
  const market_data = (contract.market_data ?? null) as Record<string, unknown> | null;
  const quotes = marketStore.getMany(symbols);
  const confidences: DataConfidence[] = [];
  const providers = new Set<string>();
  let overlaid = 0;
  const now = Date.now();
  for (const q of quotes) {
    const overlay: RealtimeOverlay = {
      price: q.price,
      changePercent: q.changePercent ?? null,
      ts: q.ts,
      source: q.source,
      quality: q.quality,
      freshnessAgeMs: Math.max(0, now - q.ts),
    };
    // additive: giữ nguyên mọi field cũ của market_data, thêm realtime
    if (market_data) {
      const existing = market_data.realtime as Record<string, unknown> | undefined;
      market_data.realtime = { ...(existing ?? {}), [q.symbol]: overlay };
    } else {
      // contract không có market_data (intel/compare): gắn block additive riêng
      const existing = contract.realtime_overlay as Record<string, unknown> | undefined;
      contract.realtime_overlay = { ...(existing ?? {}), [q.symbol]: overlay };
    }
    providers.add(q.source.split(":")[0] ?? q.source);
    overlaid += 1;
    confidences.push(
      computeQuoteConfidence({
        // Trung thực Phase 2: StoredQuote chỉ có 1 source — không giả định 2 provider;
        // nếu sau này source ghép "a:b" thì đếm theo và sẽ đủ điều kiện high.
        providerCount: q.source.includes(":") ? q.source.split(":").length : 1,
        deviationPct: null,
        quality: q.quality === "VALID" ? "VALID" : q.quality === "SUSPECT" ? "SUSPECT" : q.quality === "STALE" ? "STALE" : "INVALID",
        ageMs: overlay.freshnessAgeMs,
        validSlaMs: q.assetType === "stock" ? vnSlasForSession().freshSlaMs : q.assetType === "crypto" ? 120_000 : 300_000,
        providerHealthy: true,
        secondaryOnly: q.source.includes("fallback") || q.source.includes("vndirect"),
      }),
    );
  }
  return { market_data, confidences, overlaid, providers: [...providers] };
}

/** Bước 3b — bối cảnh Market Intelligence (additive, bounded) cho intent thị trường. */
export async function marketIntelContext(): Promise<Record<string, unknown> | null> {
  const [regime, breadth, sectors, events] = await Promise.allSettled([getMarketRegime(), getMarketBreadth(), getSectorRotation(), getMarketEvents(5)]);
  const ctx: Record<string, unknown> = { session: getVnSession().state };
  if (regime.status === "fulfilled" && regime.value) ctx.regime = regime.value.regime;
  if (breadth.status === "fulfilled" && breadth.value) ctx.breadth = breadth.value.breadth;
  if (sectors.status === "fulfilled" && sectors.value) ctx.sectorRotation = { top: sectors.value.rotation.topSector, laggard: sectors.value.rotation.laggardSector, dispersionPct: sectors.value.rotation.dispersionPct, rows: sectors.value.rotation.rows.slice(0, 3) };
  if (events.status === "fulfilled" && events.value) ctx.events = events.value.events.slice(0, 3);
  return Object.keys(ctx).length > 1 ? ctx : null;
}

/** Bước 5 — tổng hợp Data Confidence theo Phase 2 (worst-of) + gate. */
export function pipelineConfidence(blocks: DataConfidence[]): { aggregate: DataConfidence | null; gateOk: boolean } {
  const aggregate = aggregateConfidence(blocks);
  // gate: nếu block nào unverified/low và dữ liệu vẫn được dùng → đánh dấu hạ cấp, không chặn LLM nhưng required be honest
  const gateOk = aggregate ? aggregate.level !== "unverified" : true;
  return { aggregate, gateOk };
}

/** Fold Phase-2 confidence vào Confidence cũ (HIGH/MEDIUM/LOW) — chỉ hạ cấp. */
export function foldConfidence(base: Confidence, blocks: DataConfidence[]): Confidence {
  const agg = aggregateConfidence(blocks);
  if (!agg) return base;
  const order: Confidence[] = ["HIGH", "MEDIUM", "LOW"];
  const idx = order.indexOf(base);
  let level = idx;
  if (agg.level === "low" || agg.level === "unverified") level = Math.max(idx, 1); // MEDIUM trở xuống
  if (agg.level === "unverified") level = 2; // LOW
  if (agg.level === "low" && base === "LOW") level = 2;
  return order[level] ?? "LOW";
}

/** Pipeline trace — ghi lại từng bước đã chạy (additive meta). */
export function pipelineTrace(intent: string, stages: { quant: string[]; overlaid: number; confidenceLevel: string | null; llm: boolean }): {
  steps: string[];
  intent: string;
  quant: string[];
  realtimeOverlaid: number;
  confidence: string | null;
  llm: boolean;
} {
  return {
    steps: ["user-question", "existing-ui", "realtime-context", "quant-engine", "data-confidence", "llm-reasoning", "existing-ui-output"],
    intent,
    quant: stages.quant,
    realtimeOverlaid: stages.overlaid,
    confidence: stages.confidenceLevel,
    llm: stages.llm,
  };
}

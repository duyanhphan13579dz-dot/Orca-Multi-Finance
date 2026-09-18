import "server-only";
import { buildMeta } from "../freshness";
import { analyzeWyckoff, type WyckoffPhase, type WyckoffSnapshot } from "../engines/wyckoff-elliott";
import { getVnOhlcv, getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta } from "../types";

export type WyckoffSetup =
  | "spring"
  | "upthrust"
  | "sos-breakout"
  | "sow-breakdown"
  | "accumulation-range"
  | "distribution-range"
  | "markup"
  | "markdown"
  | "watch";

export interface WyckoffScreenRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  phase: WyckoffPhase;
  phaseVi: string;
  subPhase: WyckoffSnapshot["subPhase"];
  setup: WyckoffSetup;
  setupVi: string;
  confidence: number;
  bias: WyckoffSnapshot["bias"];
  events: string[];
  eventCodes: string[];
  range: { high: number; low: number } | null;
  notes: string[];
}

const SETUP_VI: Record<WyckoffSetup, string> = {
  spring: "Spring / Shakeout",
  upthrust: "Upthrust / UTAD",
  "sos-breakout": "SOS — phá kháng cự",
  "sow-breakdown": "SOW — gãy hỗ trợ",
  "accumulation-range": "Range tích lũy",
  "distribution-range": "Range phân phối",
  markup: "Markup",
  markdown: "Markdown",
  watch: "Quan sát",
};

function pickSetup(w: WyckoffSnapshot): WyckoffSetup {
  const codes = new Set(w.eventCodes ?? []);
  if (codes.has("SPRING")) return "spring";
  if (codes.has("UTAD") || codes.has("UT")) return "upthrust";
  if (codes.has("SOS") && (w.phase === "markup" || w.phase === "accumulation")) return "sos-breakout";
  if (codes.has("SOW") && (w.phase === "markdown" || w.phase === "distribution")) return "sow-breakdown";
  if (w.phase === "accumulation" || w.phase === "re-accumulation") return "accumulation-range";
  if (w.phase === "distribution" || w.phase === "re-distribution") return "distribution-range";
  if (w.phase === "markup") return "markup";
  if (w.phase === "markdown") return "markdown";
  return "watch";
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function screenWyckoff(args?: {
  symbols?: string[];
  phase?: WyckoffPhase | "all";
  setup?: WyckoffSetup | "all";
  minConfidence?: number;
  sector?: string;
  limit?: number;
}): Promise<{ rows: WyckoffScreenRow[]; scanned: number; skipped: number; meta: Meta } | null> {
  const uniq = [
    ...new Set((args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean)),
  ].slice(0, 60);

  const quotesPack = await getVnQuotes(uniq).catch(() => null);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));

  let skipped = 0;
  const analyzed = await mapPool(uniq, 6, async (symbol) => {
    const ohlcv = await getVnOhlcv(symbol, 90).catch(() => null);
    const bars = ohlcv?.bars ?? [];
    if (bars.length < 40) {
      skipped += 1;
      return null;
    }
    const w = analyzeWyckoff(bars);
    const q = quoteMap.get(symbol);
    const sec = getSecurity(symbol);
    const setup = pickSetup(w);
    const row: WyckoffScreenRow = {
      symbol,
      name: sec?.name ?? q?.name ?? null,
      sector: sectorOf(symbol) ?? sec?.sector ?? null,
      price: q?.price ?? bars[bars.length - 1]?.close ?? null,
      changePercent: q?.changePercent ?? null,
      volume: q?.quoteVolume ?? q?.volume ?? bars[bars.length - 1]?.volume ?? null,
      phase: w.phase,
      phaseVi: w.phaseVi,
      subPhase: w.subPhase ?? null,
      setup,
      setupVi: SETUP_VI[setup],
      confidence: w.confidence,
      bias: w.bias,
      events: w.events,
      eventCodes: w.eventCodes ?? [],
      range: w.range,
      notes: w.notes,
    };
    return row;
  });

  let rows = analyzed.filter((r): r is WyckoffScreenRow => r != null);

  if (args?.phase && args.phase !== "all") {
    rows = rows.filter((r) => r.phase === args.phase);
  }
  if (args?.setup && args.setup !== "all") {
    rows = rows.filter((r) => r.setup === args.setup);
  }
  if (args?.minConfidence != null) {
    rows = rows.filter((r) => r.confidence >= args.minConfidence!);
  }
  if (args?.sector) {
    rows = rows.filter((r) => r.sector === args.sector);
  }

  rows.sort((a, b) => b.confidence - a.confidence || (b.volume ?? 0) - (a.volume ?? 0));
  const limit = Math.min(args?.limit ?? 40, 60);
  rows = rows.slice(0, limit);

  if (!rows.length && skipped === uniq.length) return null;

  return {
    rows,
    scanned: uniq.length,
    skipped,
    meta: buildMeta({
      source: quotesPack?.meta.source ?? "vndirect+ohlcv",
      sourceTimestampMs: Date.now(),
      partial: skipped > 0,
      note: `Quét ${uniq.length} mã thanh khoản · đủ nến ${uniq.length - skipped} · Wyckoff heuristic (không phải tín hiệu giao dịch)`,
    }),
  };
}

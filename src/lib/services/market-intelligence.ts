/**
 * MARKET INTELLIGENCE SERVICE (Phase 3) — orchestration ẩn sau UI hiện tại.
 *
 * Một nơi duy nhất thu thập inputs thật (VN) cho 6 engine Phase 3:
 * readiness: builder từ provider (cached, chunked);
 * routers:   getMarketBreadth / getSectorRotation / getMarketRegime /
 *            getMarketLeaders / getSmartSignals / getMarketEvents.
 *
 * Sự kiện được giữ trong ring bộ nhớ (max 100, dedupe 5 phút) — không persist
 * DB để tránh phình bảng; API có thể tự phát hiện fresh khi ring trống.
 */

import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getVnIndices, getVnOhlcv, getVnQuotes } from "./stocks";
import { computeBreadth, type BreadthQuoteInput, type BreadthResult } from "../engines/breadth";
import { computeSectorRotation, type SectorQuoteInput, type SectorRotationResult } from "../engines/sector-rotation";
import { computeMarketRegime, type MarketRegimeResult } from "../engines/market-regime";
import { computeLeadership, type LeadershipResult } from "../engines/leadership";
import { evaluateSmartRules, type SmartSignal } from "../engines/smart-alerts";
import { detectMarketEvents, type MarketEvent } from "../engines/event-intelligence";
import { VN_SECURITIES, getSecurity } from "../vn/master";
import { vnSlasForSession, getVnSession } from "../vn/sessions";
import type { IndexQuote, Meta, OhlcvBar, Quote } from "../types";

/** Board khảo sát: bluechip trước, sau đó các mã master — cap 135 (5 chunk × 30). */
function surveySymbols(): string[] {
  const bluechip = VN_SECURITIES.filter((s) => s.bluechip).map((s) => s.symbol);
  const rest = VN_SECURITIES.filter((s) => !s.bluechip).map((s) => s.symbol);
  return [...new Set([...bluechip, ...rest])].slice(0, 135);
}

export interface VnIntelInputs {
  quotes: Quote[];
  indexQuote: IndexQuote | null;
  indexBars: OhlcvBar[] | null;
  barsBySymbol: Map<string, OhlcvBar[]>;
  marketChangePct: number | null;
  fetchedAt: number;
}

async function fetchBarsBestEffort(symbols: string[]): Promise<Map<string, OhlcvBar[]>> {
  const bars = new Map<string, OhlcvBar[]>();
  const results = await Promise.allSettled(symbols.slice(0, 30).map((s) => getVnOhlcv(s, 60)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value?.bars?.length) bars.set(symbols[i].toUpperCase(), r.value.bars);
  }
  return bars;
}

const MAX_BARS_SYMBOLS = 30;

async function buildInputs(): Promise<VnIntelInputs> {
  const symbols = surveySymbols();
  const [indicesRes, chunksRes] = await Promise.allSettled([getVnIndices(), Promise.all(chunk(symbols, 30).map((c) => getVnQuotes(c)))]);
  const indices = indicesRes.status === "fulfilled" ? indicesRes.value : null;
  const chunks = chunksRes.status === "fulfilled" ? chunksRes.value : [];
  const quotes = chunks.flatMap((c) => (c ? c.quotes : []));
  const indexQuote = indices?.items.find((i) => i.code === "VNINDEX") ?? indices?.items[0] ?? null;

  // Depth: OHLCV cho top 30 mã thanh khoản nhất (best-effort)
  const topLiquid = [...quotes]
    .sort((a, b) => (b.quoteVolume ?? b.volume ?? 0) - (a.quoteVolume ?? a.volume ?? 0))
    .slice(0, MAX_BARS_SYMBOLS)
    .map((q) => q.symbol);
  const barsBySymbol = await fetchBarsBestEffort(topLiquid);

  // Index bars (VNINDEX OHLCV nếu provider hỗ trợ — tolerant)
  let indexBars: OhlcvBar[] | null = null;
  try {
    const ib = await getVnOhlcv("VNINDEX", 130);
    if (ib?.bars?.length) indexBars = ib.bars;
  } catch {
    /* index OHLCV không bắt buộc */
  }

  return { quotes, indexQuote, indexBars, barsBySymbol, marketChangePct: quotes.length ? quotes.reduce((a, q) => a + (q.changePercent ?? 0), 0) / quotes.length : null, fetchedAt: Date.now() };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const INPUT_TTL = 20_000;

async function inputs(): Promise<VnIntelInputs> {
  const res = await cached("intel:vn:inputs:v1", { ttlMs: INPUT_TTL, staleMs: 30 * 60_000, producer: () => buildInputs() });
  return res.value;
}

function breadthInputs(i: VnIntelInputs): BreadthQuoteInput[] {
  return i.quotes.map((q) => ({
    symbol: q.symbol,
    changePercent: q.changePercent ?? null,
    price: q.price,
    volume: q.volume ?? null,
    quoteVolume: q.quoteVolume ?? null,
    bars: i.barsBySymbol.get(q.symbol) ?? null,
  }));
}

function sectorInputs(i: VnIntelInputs): SectorQuoteInput[] {
  return i.quotes.map((q) => ({
    symbol: q.symbol,
    sector: getSecurity(q.symbol)?.sector ?? null,
    changePercent: q.changePercent ?? null,
    quoteVolume: q.quoteVolume ?? null,
    volume: q.volume ?? null,
  }));
}

function massMoversOf(i: VnIntelInputs): { symbol: string; sector: string | null; changePercent: number; volumeRatio: number | null }[] {
  return [...i.quotes]
    .filter((q) => q.changePercent != null)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, 12)
    .map((q) => {
      const bars = i.barsBySymbol.get(q.symbol);
      let volumeRatio: number | null = null;
      if (bars && bars.length >= 21) {
        const avg = bars.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20;
        if (avg > 0) volumeRatio = Number((bars[bars.length - 1].volume / avg).toFixed(2));
      }
      return { symbol: q.symbol, sector: getSecurity(q.symbol)?.sector ?? null, changePercent: q.changePercent ?? 0, volumeRatio };
    });
}

/* --------------------------------- routers --------------------------------- */

export async function getMarketBreadth(): Promise<{ breadth: BreadthResult; meta: Meta } | null> {
  try {
    const res = await cached("intel:vn:breadth:v1", {
      ttlMs: INPUT_TTL,
      staleMs: 30 * 60_000,
      producer: async () => {
        const i = await inputs();
        return { breadth: computeBreadth(breadthInputs(i)), fetchedAt: i.fetchedAt };
      },
    });
    const meta = buildMeta({ source: "vn-intelligence:breadth", sourceTimestampMs: res.value.fetchedAt, cached: res.cached, stale: res.stale, slas: vnSlasForSession(), note: res.value.breadth.note ?? undefined });
    return { breadth: res.value.breadth, meta };
  } catch {
    return null;
  }
}

export async function getSectorRotation(): Promise<{ rotation: SectorRotationResult; meta: Meta } | null> {
  try {
    const res = await cached("intel:vn:sectors:v1", {
      ttlMs: INPUT_TTL,
      staleMs: 30 * 60_000,
      producer: async () => {
        const i = await inputs();
        return { rotation: computeSectorRotation(sectorInputs(i)), fetchedAt: i.fetchedAt };
      },
    });
    const meta = buildMeta({ source: "vn-intelligence:sectors", sourceTimestampMs: res.value.fetchedAt, cached: res.cached, stale: res.stale, slas: vnSlasForSession(), note: res.value.rotation.note ?? undefined });
    return { rotation: res.value.rotation, meta };
  } catch {
    return null;
  }
}

export async function getMarketRegime(): Promise<{ regime: MarketRegimeResult; meta: Meta } | null> {
  try {
    const res = await cached("intel:vn:regime:v1", {
      ttlMs: INPUT_TTL,
      staleMs: 30 * 60_000,
      producer: async () => {
        const i = await inputs();
        const b = computeBreadth(breadthInputs(i));
        const rot = computeSectorRotation(sectorInputs(i));
        const regime = computeMarketRegime({
          indexBars: i.indexBars,
          indexChangePercent: i.indexQuote?.changePercent ?? null,
          breadthScore: b.score,
          sectorDispersionPct: rot.dispersionPct,
        });
        return { regime, fetchedAt: i.fetchedAt };
      },
    });
    const meta = buildMeta({ source: "vn-intelligence:state", sourceTimestampMs: res.value.fetchedAt, cached: res.cached, stale: res.stale, slas: vnSlasForSession(), note: res.value.regime.note ?? undefined });
    return { regime: res.value.regime, meta };
  } catch {
    return null;
  }
}

export async function getMarketLeaders(limit = 20): Promise<{ leadership: LeadershipResult; meta: Meta } | null> {
  try {
    const res = await cached(`intel:vn:leaders:v1:${limit}`, {
      ttlMs: INPUT_TTL,
      staleMs: 30 * 60_000,
      producer: async () => {
        const i = await inputs();
        const leadership = computeLeadership(
          i.quotes.map((q) => ({
            symbol: q.symbol,
            sector: getSecurity(q.symbol)?.sector ?? null,
            changePercent: q.changePercent ?? null,
            quoteVolume: q.quoteVolume ?? null,
            volume: q.volume ?? null,
            marketChangePercent: i.marketChangePct,
          })),
        );
        return { leadership: { ...leadership, leaders: leadership.leaders.slice(0, limit), laggards: leadership.laggards.slice(0, limit) }, fetchedAt: i.fetchedAt };
      },
    });
    const meta = buildMeta({ source: "vn-intelligence:leaders", sourceTimestampMs: res.value.fetchedAt, cached: res.cached, stale: res.stale, slas: vnSlasForSession(), note: res.value.leadership.note ?? undefined });
    return { leadership: res.value.leadership, meta };
  } catch {
    return null;
  }
}

export async function getSmartSignals(): Promise<{ signals: SmartSignal[]; meta: Meta } | null> {
  try {
    const res = await cached("intel:vn:smart-alerts:v1", {
      ttlMs: INPUT_TTL,
      staleMs: 30 * 60_000,
      producer: async () => {
        const i = await inputs();
        const b = computeBreadth(breadthInputs(i));
        const rot = computeSectorRotation(sectorInputs(i));
        const topSectorChange = rot.rows[0]?.medianChangePct ?? null;
        const regime = computeMarketRegime({ indexBars: i.indexBars, indexChangePercent: i.indexQuote?.changePercent ?? null, breadthScore: b.score, sectorDispersionPct: rot.dispersionPct });
        const signals = evaluateSmartRules({
          indexChangePercent: i.indexQuote?.changePercent ?? null,
          indexVolumeRatio: indexVolumeRatio(i.indexBars),
          advancers: b.advancers,
          decliners: b.decliners,
          total: b.total,
          newHighs20: b.newHighs20,
          newLows20: b.newLows20,
          sectorRotationScore: rot.dispersionPct,
          topSector: rot.topSector,
          topSectorChange: topSectorChange,
          massMovers: massMoversOf(i),
          volatilityRatio: regime.volatilityRatio,
        });
        return { signals, fetchedAt: i.fetchedAt };
      },
    });
    const meta = buildMeta({ source: "vn-intelligence:smart-alerts", sourceTimestampMs: res.value.fetchedAt, cached: res.cached, stale: res.stale, slas: vnSlasForSession() });
    return { signals: res.value.signals, meta };
  } catch {
    return null;
  }
}

function indexVolumeRatio(bars: OhlcvBar[] | null): number | null {
  if (!bars || bars.length < 21) return null;
  const avg = bars.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20;
  if (avg <= 0) return null;
  return Number((bars[bars.length - 1].volume / avg).toFixed(2));
}

/* ------------------------------ market events ------------------------------ */

interface Ring {
  events: MarketEvent[];
}
const g = globalThis as typeof globalThis & { __orcaMarketEvents?: Ring };
function ring(): Ring {
  if (!g.__orcaMarketEvents) g.__orcaMarketEvents = { events: [] };
  return g.__orcaMarketEvents;
}

export function recordEventBatch(events: MarketEvent[]): number {
  const r = ring();
  const seen = new Set(r.events.map((e) => e.id));
  let added = 0;
  for (const e of events) {
    if (seen.has(e.id)) continue;
    r.events.unshift(e);
    seen.add(e.id);
    added += 1;
  }
  if (r.events.length > 100) r.events.length = 100;
  return added;
}

export async function detectAndRecordEvents(): Promise<MarketEvent[]> {
  const i = await inputs();
  const b = computeBreadth(breadthInputs(i));
  const rot = computeSectorRotation(sectorInputs(i));
  const regime = computeMarketRegime({ indexBars: i.indexBars, indexChangePercent: i.indexQuote?.changePercent ?? null, breadthScore: b.score, sectorDispersionPct: rot.dispersionPct });
  const events = detectMarketEvents({
    indexChangePercent: i.indexQuote?.changePercent ?? null,
    indexVolumeRatio: indexVolumeRatio(i.indexBars),
    advancers: b.advancers,
    decliners: b.decliners,
    total: b.total,
    newHighs20: b.newHighs20,
    newLows20: b.newLows20,
    topSector: rot.topSector,
    sectorDispersionPct: rot.dispersionPct,
    massMovers: massMoversOf(i),
    volatilityRatio: regime.volatilityRatio,
  });
  recordEventBatch(events);
  return events;
}

export async function getMarketEvents(limit = 20): Promise<{ events: MarketEvent[]; detectedAt: number; meta: Meta } | null> {
  try {
    const r = ring();
    if (!r.events.length) {
      // fresh detection khi ring trống (sau restart)
      await cached("intel:vn:events:v1", { ttlMs: 60_000, staleMs: 30 * 60_000, producer: () => detectAndRecordEvents() });
    }
    const events = ring().events.slice(0, limit);
    const meta = buildMeta({ source: "vn-intelligence:events", sourceTimestampMs: events[0]?.ts ?? Date.now(), cached: false, slas: vnSlasForSession() });
    return { events, detectedAt: Date.now(), meta };
  } catch {
    return null;
  }
}

/** Scheduler hook — 5 phút/lần. Best-effort. */
export async function runMarketIntelligenceCycle(): Promise<number> {
  try {
    const events = await detectAndRecordEvents();
    return events.length;
  } catch {
    return 0;
  }
}

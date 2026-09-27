import "server-only";
import { buildMeta } from "../freshness";
import { detectCandlePatterns, type DetectedCandlePattern } from "../engines/candlestick-patterns";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getSecurity, sectorOf } from "../vn/master";
import { getVnOhlcv, getVnQuotes } from "./stocks";
import type { Meta } from "../types";

export type CandlestickScreenRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  patterns: DetectedCandlePattern[];
  topPattern: DetectedCandlePattern;
  alertWorthy: boolean;
};

export type CandlestickScreenResult = {
  rows: CandlestickScreenRow[];
  scanned: number;
  skipped: number;
  meta: Meta;
};

export type CandlestickScreenOpts = {
  symbols?: string[];
  category?: string;
  minScore?: number;
  limit?: number;
  volumeOnly?: boolean;
};

const DEFAULT_MIN = 55;

export type PatternAlertEvent = {
  id: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  pattern: DetectedCandlePattern;
  firedAt: number;
};

function patternAlertStore() {
  const g = globalThis as typeof globalThis & {
    __orcaPatternEvents?: PatternAlertEvent[];
  };
  if (!g.__orcaPatternEvents) g.__orcaPatternEvents = [];
  return g.__orcaPatternEvents;
}

export function getRecentPatternAlerts(limit = 30): PatternAlertEvent[] {
  return patternAlertStore().slice(0, limit);
}

async function ohlcvBatch(symbols: string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof getVnOhlcv>>>();
  const chunk = 8;
  for (let i = 0; i < symbols.length; i += chunk) {
    const batch = symbols.slice(i, i + chunk);
    const settled = await Promise.allSettled(batch.map((s) => getVnOhlcv(s, 80)));
    settled.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value?.bars?.length) out.set(batch[j], r.value);
    });
  }
  return out;
}

function isReversal(p: DetectedCandlePattern): boolean {
  return p.category === "bullish_reversal" || p.category === "bearish_reversal";
}

function isAlertWorthy(top: DetectedCandlePattern): boolean {
  if (!isReversal(top)) return false;
  if (!(top.reliability === "high" || top.reliability === "very_high")) return false;
  if (top.reliability === "very_high") return top.score >= 68;
  return top.score >= 72 && top.volumeConfirmed;
}

export async function screenCandlestickPatterns(
  opts: CandlestickScreenOpts = {},
): Promise<CandlestickScreenResult | null> {
  const universe = (opts.symbols?.length ? opts.symbols : LIQUID_BOARD)
    .map((s) => s.toUpperCase())
    .filter(Boolean)
    .slice(0, 120);
  const minScore = opts.minScore ?? DEFAULT_MIN;
  const limit = Math.min(opts.limit ?? 40, 80);
  const cat = (opts.category ?? "all").toLowerCase();

  const [ohlcvMap, quotesPack] = await Promise.all([
    ohlcvBatch(universe),
    getVnQuotes(universe).catch(() => null),
  ]);
  const quoteBy = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol.toUpperCase(), q]));

  const rows: CandlestickScreenRow[] = [];
  let skipped = 0;

  for (const sym of universe) {
    const pack = ohlcvMap.get(sym);
    if (!pack?.bars || pack.bars.length < 10) {
      skipped++;
      continue;
    }
    let patterns = detectCandlePatterns(pack.bars);
    if (cat !== "all") patterns = patterns.filter((p) => p.category === cat);
    if (opts.volumeOnly) patterns = patterns.filter((p) => p.volumeConfirmed);
    patterns = patterns.filter((p) => p.score >= minScore);
    patterns = patterns.filter((p) => p.category !== "neutral" || p.score >= 70);
    if (!patterns.length) continue;

    patterns.sort((a, b) => {
      const ra = isReversal(a) ? 1 : 0;
      const rb = isReversal(b) ? 1 : 0;
      if (rb !== ra) return rb - ra;
      return b.score - a.score;
    });

    const top = patterns[0]!;
    const q = quoteBy.get(sym);
    const sec = getSecurity(sym);
    rows.push({
      symbol: sym,
      name: sec?.name ?? q?.name ?? null,
      sector: sectorOf(sym) ?? sec?.sector ?? null,
      price: q?.price ?? pack.bars[pack.bars.length - 1]?.close ?? null,
      changePercent: q?.changePercent ?? null,
      volume: q?.volume ?? pack.bars[pack.bars.length - 1]?.volume ?? null,
      patterns,
      topPattern: top,
      alertWorthy: isAlertWorthy(top),
    });
  }

  rows.sort((a, b) => {
    if (a.alertWorthy !== b.alertWorthy) return a.alertWorthy ? -1 : 1;
    return b.topPattern.score - a.topPattern.score;
  });

  return {
    rows: rows.slice(0, limit),
    scanned: universe.length,
    skipped,
    meta: buildMeta({
      source: "candlestick-engine+ohlcv",
      sourceTimestampMs: Date.now(),
      note: `Ruleset v1 · minScore≥${minScore} · ${cat} · alert=reversal-only`,
      partial: skipped > 0,
    }),
  };
}

export async function runCandlestickPatternAlerts(): Promise<{
  scanned: number;
  hits: number;
  alerted: number;
  symbols: string[];
}> {
  const [bull, bear] = await Promise.all([
    screenCandlestickPatterns({ minScore: 65, limit: 20, category: "bullish_reversal" }),
    screenCandlestickPatterns({ minScore: 65, limit: 20, category: "bearish_reversal" }),
  ]);

  const scanned = Math.max(bull?.scanned ?? 0, bear?.scanned ?? 0);
  const merged = [...(bull?.rows ?? []), ...(bear?.rows ?? [])]
    .filter((x) => x.alertWorthy)
    .sort((a, b) => b.topPattern.score - a.topPattern.score);

  const bySym = new Map<string, (typeof merged)[0]>();
  for (const row of merged) {
    const prev = bySym.get(row.symbol);
    if (!prev || row.topPattern.score > prev.topPattern.score) bySym.set(row.symbol, row);
  }
  const hits = [...bySym.values()].sort((a, b) => b.topPattern.score - a.topPattern.score);

  if (!hits.length) return { scanned, hits: 0, alerted: 0, symbols: [] };

  const g = globalThis as typeof globalThis & {
    __orcaPatternAlertDay?: string;
    __orcaPatternAlerted?: Set<string>;
  };
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  if (g.__orcaPatternAlertDay !== day) {
    g.__orcaPatternAlertDay = day;
    g.__orcaPatternAlerted = new Set();
  }
  const fired = g.__orcaPatternAlerted!;
  const events = patternAlertStore();

  let alerted = 0;
  const symbols: string[] = [];
  try {
    const { postGlobalDiscord } = await import("./discord-notify");
    for (const row of hits.slice(0, 10)) {
      const key = `${row.symbol}:${row.topPattern.name}`;
      if (fired.has(key)) continue;
      const p = row.topPattern;
      const isBull = p.type === "bullish";
      const dirLabel = isBull ? "ĐẢO CHIỀU TĂNG" : "ĐẢO CHIỀU GIẢM";
      const color = isBull ? 0x22c55e : 0xef4444;
      const priceStr = row.price != null ? row.price.toLocaleString("vi-VN") : "—";
      const chgStr =
        row.changePercent != null
          ? `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`
          : "—";

      const title = `Cảnh báo nến · ${row.symbol}`;
      const body =
        `${dirLabel} — ${p.nameVi} (${p.name})\n` +
        `Giá ${priceStr} (${chgStr}) · điểm ${p.score}` +
        (p.volumeConfirmed ? " · volume ✓" : "") +
        `\n${p.description}\n` +
        `Xác nhận: ${p.confirmation}`;

      const sent = await postGlobalDiscord({
        title,
        description: body,
        color,
        username: "Orca Alerts",
        fields: [
          { name: "Mã", value: `\`${row.symbol}\``, inline: true },
          { name: "Giá", value: priceStr, inline: true },
          { name: "% phiên", value: chgStr, inline: true },
          { name: "Mẫu", value: `${p.nameVi} · ${p.reliability}`, inline: true },
          { name: "Ngành", value: row.sector ?? "—", inline: true },
          { name: "Trend trước", value: p.trendContext, inline: true },
        ],
      });

      events.unshift({
        id: key,
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        price: row.price,
        changePercent: row.changePercent,
        pattern: p,
        firedAt: Date.now(),
      });
      if (events.length > 50) events.length = 50;

      if (sent.ok || sent.skipped) {
        fired.add(key);
        if (sent.ok) {
          alerted++;
          symbols.push(row.symbol);
        } else if (sent.skipped) {
          symbols.push(row.symbol);
        }
      }
    }
  } catch (e) {
    console.warn("[runCandlestickPatternAlerts]", e);
  }

  return { scanned, hits: hits.length, alerted, symbols };
}

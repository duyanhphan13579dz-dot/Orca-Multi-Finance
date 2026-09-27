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
    if (cat !== "all") {
      patterns = patterns.filter((p) => p.category === cat);
    }
    if (opts.volumeOnly) {
      patterns = patterns.filter((p) => p.volumeConfirmed);
    }
    patterns = patterns.filter((p) => p.score >= minScore);
    patterns = patterns.filter((p) => p.category !== "neutral" || p.score >= 70);
    if (!patterns.length) continue;

    const top = patterns[0];
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
      alertWorthy:
        top.score >= 70 &&
        (top.category === "bullish_reversal" ||
          top.category === "bearish_reversal" ||
          top.category === "continuation") &&
        (top.reliability === "high" || top.reliability === "very_high"),
    });
  }

  rows.sort((a, b) => b.topPattern.score - a.topPattern.score);

  return {
    rows: rows.slice(0, limit),
    scanned: universe.length,
    skipped,
    meta: buildMeta({
      source: "candlestick-engine+ohlcv",
      sourceTimestampMs: Date.now(),
      note: `Ruleset v1 · minScore≥${minScore} · ${cat}`,
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
  const r = await screenCandlestickPatterns({
    minScore: 70,
    limit: 25,
    category: "all",
  });
  if (!r) return { scanned: 0, hits: 0, alerted: 0, symbols: [] };

  const hits = r.rows.filter((x) => x.alertWorthy);
  if (!hits.length) {
    return { scanned: r.scanned, hits: 0, alerted: 0, symbols: [] };
  }

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

  let alerted = 0;
  const symbols: string[] = [];
  try {
    const { postGlobalDiscord } = await import("./discord-notify");
    for (const row of hits.slice(0, 12)) {
      const key = `${row.symbol}:${row.topPattern.name}`;
      if (fired.has(key)) continue;
      const p = row.topPattern;
      const dir =
        p.type === "bullish" ? "TĂNG" : p.type === "bearish" ? "GIẢM" : "TRUNG TÍNH";
      const color =
        p.type === "bullish" ? 0x22c55e : p.type === "bearish" ? 0xef4444 : 0x94a3b8;
      const sent = await postGlobalDiscord({
        title: `Mẫu nến ${dir} · ${row.symbol}`,
        description:
          `**${p.nameVi}** (${p.name})\n` +
          `Độ tin cậy: ${p.reliability} · điểm ${p.score}` +
          (p.volumeConfirmed ? " · volume ✓" : " · volume yếu") +
          `\n${p.description}\n` +
          `_Xác nhận: ${p.confirmation}_`,
        color,
        fields: [
          {
            name: "Giá",
            value: row.price != null ? row.price.toLocaleString("vi-VN") : "—",
            inline: true,
          },
          {
            name: "% phiên",
            value:
              row.changePercent != null
                ? `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`
                : "—",
            inline: true,
          },
          {
            name: "Ngành",
            value: row.sector ?? "—",
            inline: true,
          },
        ],
      });
      if (sent.ok) {
        fired.add(key);
        alerted++;
        symbols.push(row.symbol);
      }
    }
  } catch (e) {
    console.warn("[runCandlestickPatternAlerts]", e);
  }

  return { scanned: r.scanned, hits: hits.length, alerted, symbols };
}

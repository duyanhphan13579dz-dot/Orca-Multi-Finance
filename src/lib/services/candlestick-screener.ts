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
  assetClass?: "stock" | "forex" | "crypto";
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
  const g = globalThis as typeof globalThis & { __orcaPatternEvents?: PatternAlertEvent[] };
  if (!g.__orcaPatternEvents) g.__orcaPatternEvents = [];
  return g.__orcaPatternEvents;
}

export function getRecentPatternAlerts(limit = 30): PatternAlertEvent[] {
  return patternAlertStore().slice(0, limit);
}

async function ohlcvBatch(symbols: string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof getVnOhlcv>>>();
  const chunk = 10;
  for (let i = 0; i < symbols.length; i += chunk) {
    const batch = symbols.slice(i, i + chunk);
    const settled = await Promise.allSettled(
      batch.map(async (s) => {
        let pack = await getVnOhlcv(s, 80).catch(() => null);
        if (!pack?.bars?.length) {
          await new Promise((r) => setTimeout(r, 60));
          pack = await getVnOhlcv(s, 80).catch(() => null);
        }
        return pack;
      }),
    );
    settled.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value?.bars?.length) out.set(batch[j]!, r.value);
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
): Promise<CandlestickScreenResult> {
  const universe = (opts.symbols?.length ? opts.symbols : LIQUID_BOARD)
    .map((s) => s.toUpperCase())
    .filter(Boolean)
    .slice(0, 120);
  const assetClass = opts.assetClass ?? "stock";
  const minScore = opts.minScore ?? (assetClass === "stock" ? DEFAULT_MIN : 48);
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
    let patterns = detectCandlePatterns(pack.bars, {
      assetClass,
      recentBars: assetClass === "stock" ? 3 : 5,
    });
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
      note: `Ruleset multi-bar · minScore≥${minScore} · ${cat} · ${assetClass}`,
      hasData: rows.length > 0,
      partial: skipped > 0,
    }),
  };
}

const CRYPTO_CANDLE_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
];

const FOREX_CANDLE_UNIVERSE = [
  "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
];

export async function screenCryptoCandlePatterns(
  opts: CandlestickScreenOpts = {},
): Promise<CandlestickScreenResult> {
  const { getKlinesDeep } = await import("../providers/binance");
  const universe = (opts.symbols?.length ? opts.symbols : CRYPTO_CANDLE_UNIVERSE)
    .map((s) => s.toUpperCase())
    .slice(0, 30);
  const minScore = opts.minScore ?? 48;
  const limit = Math.min(opts.limit ?? 20, 40);
  const cat = (opts.category ?? "all").toLowerCase();
  const rows: CandlestickScreenRow[] = [];
  let skipped = 0;
  for (const sym of universe) {
    try {
      const bars = await getKlinesDeep(sym, "1d", 90);
      if (!bars?.length || bars.length < 10) {
        skipped++;
        continue;
      }
      let patterns = detectCandlePatterns(bars, { assetClass: "crypto", recentBars: 5 });
      if (cat !== "all") patterns = patterns.filter((p) => p.category === cat);
      patterns = patterns.filter((p) => p.score >= minScore && p.category !== "neutral");
      if (!patterns.length) continue;
      patterns.sort((a, b) => (isReversal(b) ? 1 : 0) - (isReversal(a) ? 1 : 0) || b.score - a.score);
      const top = patterns[0]!;
      const last = bars[bars.length - 1]!;
      const prev = bars.length >= 2 ? bars[bars.length - 2]! : null;
      rows.push({
        symbol: sym,
        name: sym.replace("USDT", "/USDT"),
        sector: "Crypto",
        price: last.close,
        changePercent: prev?.close ? ((last.close - prev.close) / prev.close) * 100 : null,
        volume: last.volume ?? null,
        patterns,
        topPattern: top,
        alertWorthy: isAlertWorthy(top),
      });
    } catch {
      skipped++;
    }
  }
  rows.sort((a, b) =>
    a.alertWorthy === b.alertWorthy ? b.topPattern.score - a.topPattern.score : a.alertWorthy ? -1 : 1,
  );
  return {
    rows: rows.slice(0, limit),
    scanned: universe.length,
    skipped,
    meta: buildMeta({
      source: "candlestick-crypto+binance",
      sourceTimestampMs: Date.now(),
      note: `crypto daily · minScore≥${minScore}`,
      partial: skipped > 0,
    }),
  };
}

export async function screenForexCandlePatterns(
  opts: CandlestickScreenOpts = {},
): Promise<CandlestickScreenResult> {
  const { getChartHistory } = await import("./chart");
  const universe = (opts.symbols?.length ? opts.symbols : FOREX_CANDLE_UNIVERSE)
    .map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .slice(0, 20);
  const minScore = opts.minScore ?? 48;
  const limit = Math.min(opts.limit ?? 15, 30);
  const cat = (opts.category ?? "all").toLowerCase();
  const rows: CandlestickScreenRow[] = [];
  let skipped = 0;
  for (const sym of universe) {
    try {
      const isMetal = sym === "XAUUSD" || sym === "XAGUSD";
      const pack = await getChartHistory({
        symbol: sym,
        assetType: isMetal ? "commodity" : "forex",
        timeframe: "1d",
        limit: 120,
      });
      const bars = pack?.data?.candles;
      if (!bars?.length || bars.length < 10) {
        skipped++;
        continue;
      }
      const ohlcv = bars.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
      let patterns = detectCandlePatterns(ohlcv, { assetClass: "forex", recentBars: 5 });
      if (cat !== "all") patterns = patterns.filter((p) => p.category === cat);
      patterns = patterns.filter((p) => p.score >= minScore && p.category !== "neutral");
      if (!patterns.length) continue;
      patterns.sort((a, b) => (isReversal(b) ? 1 : 0) - (isReversal(a) ? 1 : 0) || b.score - a.score);
      const top = patterns[0]!;
      const last = bars[bars.length - 1]!;
      const prev = bars.length >= 2 ? bars[bars.length - 2]! : null;
      rows.push({
        symbol: sym === "XAUUSD" ? "XAU/USD" : sym.length === 6 ? `${sym.slice(0, 3)}/${sym.slice(3)}` : sym,
        name: sym === "XAUUSD" ? "Vàng / USD" : null,
        sector: isMetal ? "Metal" : "Forex",
        price: last.close,
        changePercent: prev?.close ? ((last.close - prev.close) / prev.close) * 100 : null,
        volume: last.volume ?? null,
        patterns,
        topPattern: top,
        alertWorthy: isAlertWorthy(top),
      });
    } catch {
      skipped++;
    }
  }
  rows.sort((a, b) =>
    a.alertWorthy === b.alertWorthy ? b.topPattern.score - a.topPattern.score : a.alertWorthy ? -1 : 1,
  );
  return {
    rows: rows.slice(0, limit),
    scanned: universe.length,
    skipped,
    meta: buildMeta({
      source: "candlestick-forex+chart",
      sourceTimestampMs: Date.now(),
      note: `forex/XAU daily · minScore≥${minScore}`,
      partial: skipped > 0,
    }),
  };
}

export async function screenMultiAssetCandlePatterns(
  opts: CandlestickScreenOpts = {},
): Promise<CandlestickScreenResult & { legs: { stock: number; crypto: number; forex: number } }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const [stock, crypto, forex] = await Promise.all([
    screenCandlestickPatterns({ ...opts, assetClass: "stock", limit }).catch(() => null),
    screenCryptoCandlePatterns({ ...opts, limit: 20 }).catch(() => null),
    screenForexCandlePatterns({ ...opts, limit: 15 }).catch(() => null),
  ]);
  const rows = [
    ...(stock?.rows ?? []).map((r) => ({ ...r, sector: r.sector ?? "VN" })),
    ...(crypto?.rows ?? []),
    ...(forex?.rows ?? []),
  ];
  rows.sort((a, b) => {
    if (a.alertWorthy !== b.alertWorthy) return a.alertWorthy ? -1 : 1;
    return b.topPattern.score - a.topPattern.score;
  });
  const scanned = (stock?.scanned ?? 0) + (crypto?.scanned ?? 0) + (forex?.scanned ?? 0);
  const skipped = (stock?.skipped ?? 0) + (crypto?.skipped ?? 0) + (forex?.skipped ?? 0);
  return {
    rows: rows.slice(0, limit),
    scanned,
    skipped,
    legs: {
      stock: stock?.rows.length ?? 0,
      crypto: crypto?.rows.length ?? 0,
      forex: forex?.rows.length ?? 0,
    },
    meta: buildMeta({
      source: "candlestick-multi-asset",
      sourceTimestampMs: Date.now(),
      note: "stock+crypto+forex · XAU included",
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

      const sent = await postGlobalDiscord({
        title: `Cảnh báo nến · ${row.symbol}`,
        description:
          `${dirLabel} — ${p.nameVi} (${p.name})\n` +
          `Giá ${priceStr} (${chgStr}) · điểm ${p.score}` +
          (p.volumeConfirmed ? " · volume ✓" : "") +
          `\n${p.description}\nXác nhận: ${p.confirmation}`,
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

import "server-only";
import { buildMeta } from "../freshness";
import { cached } from "../cache";
import {
  detectDivergences,
  divergenceSummaryLine,
  DIVERGENCE_KIND_VI,
} from "../engines/divergence";
import type {
  DivergenceKind,
  DivergenceOscillator,
  DivergenceSignal,
  DivergenceStrength,
  Meta,
} from "../types";
import { getSecurity, sectorOf } from "../vn/master";
import { defaultTechnicalUniverse } from "../vn/vn100";
import { getVnQuotes } from "./stocks";
import { batchVnOhlcv, SCREENER_UNIVERSE_CAP } from "./ohlcv-batch";

export type DivergenceScreenRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  asset: "stock" | "crypto";
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  divergences: DivergenceSignal[];
  top: DivergenceSignal;
  alertWorthy: boolean;
  summary: string;
};

export type DivergenceScreenResult = {
  rows: DivergenceScreenRow[];
  scanned: number;
  skipped: number;
  meta: Meta;
};

export type DivergenceScreenOpts = {
  symbols?: string[];
  kind?: DivergenceKind | "any";
  oscillator?: DivergenceOscillator | "any";
  minStrength?: DivergenceStrength;
  timeframe?: string;
  limit?: number;
  asset?: "stock" | "crypto" | "multi";
  window?: "default" | "short_3_4d";
  skipCache?: boolean;
};

const STRENGTH_RANK: Record<DivergenceStrength, number> = { A: 3, B: 2, C: 1 };

const SCREEN_TTL_MS = 90_000;
const SCREEN_STALE_MS = 300_000;

function oscillatorsFor(opts: DivergenceScreenOpts): DivergenceOscillator[] | undefined {
  if (!opts.oscillator || opts.oscillator === "any") {
    if ((opts.window ?? "short_3_4d") === "short_3_4d") return ["rsi", "macd_hist"];
    return ["rsi", "macd_hist", "macd_line", "stoch"];
  }
  return [opts.oscillator];
}

const CRYPTO_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
  "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "NEARUSDT", "ATOMUSDT", "LTCUSDT", "APTUSDT",
];

function strengthOk(s: DivergenceStrength, min: DivergenceStrength): boolean {
  return STRENGTH_RANK[s] >= STRENGTH_RANK[min];
}

function isAlertWorthy(d: DivergenceSignal): boolean {
  const multi = d.structure === "double" || d.structure === "triple";
  const confFloor = multi ? 0.5 : 0.55;
  const volOk = d.volumeConfirmed === true;
  const volSoft = d.volumeConfirmed !== false;
  if (d.strength === "A" && d.confidence >= confFloor && (volOk || (volSoft && d.confidence >= 0.7))) {
    return true;
  }
  if (
    d.strength === "B" &&
    (d.kind === "regular_bullish" || d.kind === "regular_bearish") &&
    d.confidence >= confFloor &&
    volOk
  ) {
    return true;
  }
  if (d.strength === "B" && multi && d.confidence >= 0.6 && volOk) return true;
  if (d.strength === "A" && volOk && d.confidence >= 0.45) return true;
  return false;
}

function filterSignals(list: DivergenceSignal[], opts: DivergenceScreenOpts): DivergenceSignal[] {
  const min = opts.minStrength ?? "C";
  let out = list.filter((d) => strengthOk(d.strength, min));
  if (opts.kind && opts.kind !== "any") out = out.filter((d) => d.kind === opts.kind);
  if (opts.oscillator && opts.oscillator !== "any") {
    out = out.filter((d) => d.oscillator === opts.oscillator);
  }
  return out;
}

function rankSignals(a: DivergenceSignal, b: DivergenceSignal): number {
  const wa = isAlertWorthy(a) ? 1 : 0;
  const wb = isAlertWorthy(b) ? 1 : 0;
  if (wb !== wa) return wb - wa;
  const va = a.volumeConfirmed === true ? 1 : 0;
  const vb = b.volumeConfirmed === true ? 1 : 0;
  if (vb !== va) return vb - va;
  if (STRENGTH_RANK[b.strength] !== STRENGTH_RANK[a.strength]) {
    return STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength];
  }
  return b.confidence - a.confidence;
}

function detectOptsFor(opts: DivergenceScreenOpts, timeframe: string) {
  const window = opts.window ?? "short_3_4d";
  return {
    window,
    timeframe,
    maxSignals: 6,
    oscillators: oscillatorsFor(opts),
  } as const;
}

function cacheKeyVn(opts: DivergenceScreenOpts, universe: string[]): string {
  const w = opts.window ?? "short_3_4d";
  const tf = opts.timeframe ?? "1d";
  const k = opts.kind ?? "any";
  const o = opts.oscillator ?? "any";
  const s = opts.minStrength ?? "C";
  const lim = Math.min(opts.limit ?? 40, 80);
  const symPart = opts.symbols?.length ? universe.slice(0, 20).join(",") : "vn100";
  return `div:vn:v3:${w}:${tf}:${k}:${o}:${s}:${lim}:${symPart}`;
}

export async function screenVnDivergences(
  opts: DivergenceScreenOpts = {},
): Promise<DivergenceScreenResult> {
  // Ưu tiên rổ VN100 — phân kỳ 3–4 phiên gần nhất
  const universe = (opts.symbols?.length ? opts.symbols : defaultTechnicalUniverse(SCREENER_UNIVERSE_CAP))
    .map((s) => s.toUpperCase())
    .filter(Boolean)
    .slice(0, SCREENER_UNIVERSE_CAP);
  const limit = Math.min(opts.limit ?? 40, 80);
  const tf = opts.timeframe ?? "1d";
  const window = opts.window ?? "short_3_4d";
  const short = window === "short_3_4d";

  const run = async (): Promise<DivergenceScreenResult> => {
    const t0 = Date.now();
    const [ohlcvMap, quotesPack] = await Promise.all([
      batchVnOhlcv(universe, {
        bars: short ? 48 : 120,
        concurrency: short ? 16 : 12,
        perSymbolMs: short ? 2_500 : 4_000,
        deadlineMs: short ? 24_000 : 35_000,
      }),
      getVnQuotes(universe).catch(() => null),
    ]);
    const quoteBy = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol.toUpperCase(), q]));

    const rows: DivergenceScreenRow[] = [];
    let skipped = 0;
    const minBarsNeed = short ? 22 : 40;
    let ohlcvHits = 0;

    for (const sym of universe) {
      const pack = ohlcvMap.get(sym);
      if (!pack?.bars || pack.bars.length < minBarsNeed) {
        skipped++;
        continue;
      }
      ohlcvHits++;
      let divs = detectDivergences(pack.bars, detectOptsFor(opts, tf));
      divs = filterSignals(divs, opts);
      if (!divs.length) continue;
      divs.sort(rankSignals);
      const top = divs[0]!;
      const q = quoteBy.get(sym);
      const sec = getSecurity(sym);
      rows.push({
        symbol: sym,
        name: sec?.name ?? q?.name ?? null,
        sector: sectorOf(sym) ?? sec?.sector ?? null,
        asset: "stock",
        price: q?.price ?? pack.bars[pack.bars.length - 1]?.close ?? null,
        changePercent: q?.changePercent ?? null,
        volume: q?.volume ?? pack.bars[pack.bars.length - 1]?.volume ?? null,
        divergences: divs,
        top,
        alertWorthy: isAlertWorthy(top),
        summary: divergenceSummaryLine(top),
      });
    }

    rows.sort((a, b) => {
      if (a.alertWorthy !== b.alertWorthy) return a.alertWorthy ? -1 : 1;
      const ta = a.top.pricePivots[1]?.time ?? 0;
      const tb = b.top.pricePivots[1]?.time ?? 0;
      if (tb !== ta) return tb - ta;
      return rankSignals(a.top, b.top);
    });

    const ms = Date.now() - t0;
    return {
      rows: rows.slice(0, limit),
      scanned: universe.length,
      skipped,
      meta: buildMeta({
        source: "divergence-engine+vn-ohlcv",
        sourceTimestampMs: Date.now(),
        note: `VN100 · tf=${tf} · window=${window} · ohlcv=${ohlcvHits}/${universe.length} · ${ms}ms · vol-confirm`,
        hasData: rows.length > 0,
        partial: skipped > 0 || ohlcvHits < universe.length,
        latencyMs: ms,
      }),
    };
  };

  if (opts.skipCache) return run();

  const key = cacheKeyVn(opts, universe);
  const pack = await cached(key, {
    ttlMs: SCREEN_TTL_MS,
    staleMs: SCREEN_STALE_MS,
    producer: run,
  });
  const result = pack.value;
  if (pack.cached && result.meta) {
    result.meta = {
      ...result.meta,
      cached: true,
      stale: pack.stale,
      note: `${result.meta.note ?? ""} · cache${pack.stale ? "-stale" : "-hit"}`,
    };
  }
  return result;
}

export async function screenCryptoDivergences(
  opts: DivergenceScreenOpts = {},
): Promise<DivergenceScreenResult> {
  const { getKlinesDeep } = await import("../providers/binance");
  const universe = (opts.symbols?.length ? opts.symbols : CRYPTO_UNIVERSE)
    .map((s) => s.toUpperCase())
    .slice(0, 30);
  const limit = Math.min(opts.limit ?? 20, 40);
  const interval = opts.timeframe ?? "1h";
  const window = opts.window ?? "short_3_4d";
  const short = window === "short_3_4d";
  const rows: DivergenceScreenRow[] = [];
  let skipped = 0;

  const { mapPool } = await import("./ohlcv-batch");
  const packs = await mapPool(universe, short ? 8 : 6, async (sym) => {
    try {
      const bars = await getKlinesDeep(sym, interval, short ? 60 : 120);
      return { sym, bars };
    } catch {
      return { sym, bars: null as Awaited<ReturnType<typeof getKlinesDeep>> | null };
    }
  });

  for (const { sym, bars } of packs) {
    if (!bars?.length || bars.length < 22) {
      skipped++;
      continue;
    }
    let divs = detectDivergences(bars, detectOptsFor(opts, interval));
    divs = filterSignals(divs, opts);
    if (!divs.length) continue;
    divs.sort(rankSignals);
    const top = divs[0]!;
    const last = bars[bars.length - 1]!;
    const prev = bars.length >= 2 ? bars[bars.length - 2]! : null;
    rows.push({
      symbol: sym,
      name: sym.replace("USDT", "/USDT"),
      sector: "Crypto",
      asset: "crypto",
      price: last.close,
      changePercent: prev?.close ? ((last.close - prev.close) / prev.close) * 100 : null,
      volume: last.volume ?? null,
      divergences: divs,
      top,
      alertWorthy: isAlertWorthy(top),
      summary: divergenceSummaryLine(top),
    });
  }

  rows.sort((a, b) => {
    if (a.alertWorthy !== b.alertWorthy) return a.alertWorthy ? -1 : 1;
    return rankSignals(a.top, b.top);
  });

  return {
    rows: rows.slice(0, limit),
    scanned: universe.length,
    skipped,
    meta: buildMeta({
      source: "divergence-engine+binance",
      sourceTimestampMs: Date.now(),
      note: `crypto · ${interval} · window=${window} · vol-confirm`,
      hasData: rows.length > 0,
      partial: skipped > 0,
    }),
  };
}

export async function screenMultiAssetDivergences(
  opts: DivergenceScreenOpts = {},
): Promise<DivergenceScreenResult & { legs: { stock: number; crypto: number } }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const [stock, crypto] = await Promise.all([
    screenVnDivergences({ ...opts, limit }).catch(() => null),
    screenCryptoDivergences({ ...opts, limit: 20 }).catch(() => null),
  ]);
  const rows = [...(stock?.rows ?? []), ...(crypto?.rows ?? [])];
  rows.sort((a, b) => {
    if (a.alertWorthy !== b.alertWorthy) return a.alertWorthy ? -1 : 1;
    return rankSignals(a.top, b.top);
  });
  const scanned = (stock?.scanned ?? 0) + (crypto?.scanned ?? 0);
  const skipped = (stock?.skipped ?? 0) + (crypto?.skipped ?? 0);
  return {
    rows: rows.slice(0, limit),
    scanned,
    skipped,
    legs: { stock: stock?.rows.length ?? 0, crypto: crypto?.rows.length ?? 0 },
    meta: buildMeta({
      source: "divergence-multi-asset",
      sourceTimestampMs: Date.now(),
      note: "stock+crypto · vol-confirm",
      hasData: rows.length > 0,
      partial: skipped > 0,
    }),
  };
}

export async function warmVnDivergenceScreen(): Promise<{
  ok: boolean;
  rows: number;
  scanned: number;
  ms: number;
}> {
  const t0 = Date.now();
  try {
    const r = await screenVnDivergences({
      window: "short_3_4d",
      timeframe: "1d",
      minStrength: "C",
      limit: 40,
      skipCache: true,
    });
    return {
      ok: true,
      rows: r.rows.length,
      scanned: r.scanned,
      ms: Date.now() - t0,
    };
  } catch (e) {
    console.warn("[warmVnDivergenceScreen]", e);
    return { ok: false, rows: 0, scanned: 0, ms: Date.now() - t0 };
  }
}

export type DivergenceAlertEvent = {
  id: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  asset: "stock" | "crypto";
  price: number | null;
  changePercent: number | null;
  divergence: DivergenceSignal;
  summary: string;
  firedAt: number;
};

function divergenceAlertStore() {
  const g = globalThis as typeof globalThis & { __orcaDivEvents?: DivergenceAlertEvent[] };
  if (!g.__orcaDivEvents) g.__orcaDivEvents = [];
  return g.__orcaDivEvents;
}

export function getRecentDivergenceAlerts(limit = 30): DivergenceAlertEvent[] {
  return divergenceAlertStore().slice(0, limit);
}

function colorForKind(kind: DivergenceKind): number {
  switch (kind) {
    case "regular_bullish":
      return 0x22c55e;
    case "regular_bearish":
      return 0xef4444;
    case "hidden_bullish":
      return 0x86efac;
    case "hidden_bearish":
      return 0xfca5a5;
    default:
      return 0x94a3b8;
  }
}

export async function runDivergenceAlerts(): Promise<{
  scanned: number;
  hits: number;
  alerted: number;
  symbols: string[];
}> {
  const result = await screenVnDivergences({
    minStrength: "B",
    limit: 30,
    timeframe: "1d",
    window: "short_3_4d",
    skipCache: true,
  });
  const hits = (result?.rows ?? []).filter((r) => r.alertWorthy);
  const scanned = result?.scanned ?? 0;
  if (!hits.length) return { scanned, hits: 0, alerted: 0, symbols: [] };

  const g = globalThis as typeof globalThis & {
    __orcaDivAlertDay?: string;
    __orcaDivAlerted?: Set<string>;
  };
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  if (g.__orcaDivAlertDay !== day) {
    g.__orcaDivAlertDay = day;
    g.__orcaDivAlerted = new Set();
  }
  const fired = g.__orcaDivAlerted!;
  const events = divergenceAlertStore();

  let alerted = 0;
  const symbols: string[] = [];

  try {
    const { postGlobalDiscord } = await import("./discord-notify");
    for (const row of hits.slice(0, 12)) {
      const d = row.top;
      const key = `${row.symbol}:${d.kind}:${d.oscillator}`;
      if (fired.has(key)) continue;

      const priceStr = row.price != null ? row.price.toLocaleString("vi-VN") : "—";
      const chgStr =
        row.changePercent != null
          ? `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`
          : "—";
      const oscLabel =
        d.oscillator === "rsi"
          ? "RSI"
          : d.oscillator === "macd_hist"
            ? "MACD hist"
            : d.oscillator === "macd_line"
              ? "MACD line"
              : d.oscillator === "stoch"
                ? "Stoch"
                : d.oscillator;
      const volTag = d.volumeConfirmed ? " · vol✓" : "";

      const sent = await postGlobalDiscord({
        title: `Phân kỳ · ${row.symbol}`,
        description:
          `${DIVERGENCE_KIND_VI[d.kind]}\n` +
          `Giá ${priceStr} (${chgStr}) · hạng ${d.strength} · tin cậy ${(d.confidence * 100).toFixed(0)}%${volTag}\n` +
          `${oscLabel} · ${d.barsBetween} nến · ${row.summary}`,
        color: colorForKind(d.kind),
        username: "ORCA Divergence",
        fields: [
          { name: "Mã", value: "`" + row.symbol + "`", inline: true },
          { name: "Giá", value: priceStr, inline: true },
          { name: "% phiên", value: chgStr, inline: true },
          { name: "Loại", value: d.kind, inline: true },
          { name: "Chỉ báo", value: oscLabel, inline: true },
          {
            name: "Khối lượng",
            value: d.volumeConfirmed
              ? `✓ ${d.volumeRatio != null ? d.volumeRatio.toFixed(2) + "×SMA" : ""}`
              : "—",
            inline: true,
          },
        ],
      });

      events.unshift({
        id: key,
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        asset: row.asset,
        price: row.price,
        changePercent: row.changePercent,
        divergence: d,
        summary: row.summary,
        firedAt: Date.now(),
      });
      if (events.length > 50) events.length = 50;

      if (sent.ok || sent.skipped) {
        fired.add(key);
        symbols.push(row.symbol);
        if (sent.ok) alerted++;
      }
    }
  } catch (e) {
    console.warn("[runDivergenceAlerts]", e);
  }

  return { scanned, hits: hits.length, alerted, symbols };
}

export { buildDivergenceConfluence, SHORT_3_4D } from "../engines/divergence";

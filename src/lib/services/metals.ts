import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getSwissquoteQuotes, SWISSQUOTE } from "../providers/swissquote";
import { getYahooChart, getYahooQuotes, type YahooQuote } from "../providers/yahoo";
import { analyzeSeries } from "../technical";
import { marketStore } from "../realtime/market-store";
import { computeDailyPerformance, type PerformanceResult } from "../performance";
import type { ChartCandle } from "../chart-const";
import type { MetalRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/**
 * METALS DOMAIN — XAU/XAG/XPT/XPD là tradable instrument RIÊNG (quote live BBO
 * từ Swissquote public, OHLC từ Yahoo Finance public), tách hẳn khỏi hàng hóa
 * (commodities = VietnamBiz /goods vẫn giữ nguyên).
 *
 * Multi-source với partial honesty:
 *  - price: Swissquote BBO (direct) → Yahoo chart meta (fallback)
 *  - change/prevClose: Yahoo daily reference
 *  - history: Yahoo 1d/1h/… thật + aggregate (4h = 1h)
 * Không mock; provider lỗi → mục đó UNAVAILABLE + meta.errors, không crash page.
 */

export interface MetalDef {
  symbol: string;
  name: string;
  unit: string;
  base: string;
  quote: string;
  group: MetalRow["group"];
  /** Yahoo candidates theo thứ tự ưu tiên: spot (X) → futures (F) */
  yahooSymbols: string[];
}

export const METAL_CATALOG: MetalDef[] = [
  { symbol: "XAUUSD", name: "Vàng thế giới (Gold)", unit: "USD/troy ounce", base: "XAU", quote: "USD", group: "precious", yahooSymbols: ["XAUUSD=X", "GC=F"] },
  { symbol: "XAGUSD", name: "Bạc thế giới (Silver)", unit: "USD/troy ounce", base: "XAG", quote: "USD", group: "precious", yahooSymbols: ["XAGUSD=X", "SI=F"] },
  { symbol: "XPTUSD", name: "Bạch kim (Platinum)", unit: "USD/troy ounce", base: "XPT", quote: "USD", group: "platinum", yahooSymbols: ["XPTUSD=X", "PL=F"] },
  { symbol: "XPDUSD", name: "Paladi (Palladium)", unit: "USD/troy ounce", base: "XPD", quote: "USD", group: "platinum", yahooSymbols: ["XPDUSD=X", "PA=F"] },
];

export function metalDef(symbol: string): MetalDef | null {
  return METAL_CATALOG.find((d) => d.symbol === symbol.toUpperCase().replace(/[^A-Z0-9]/g, "")) ?? null;
}

/** Tổng các candidate Yahoo cho tất cả metals (batch 1 lần). */
function allYahooSymbols(): string[] {
  return METAL_CATALOG.flatMap((d) => d.yahooSymbols);
}

function rowFromSources(def: MetalDef, sq: { mid: number; bid: number; ask: number; ts: number | null } | null, y: YahooQuote | null): MetalRow | null {
  const price = sq?.mid ?? y?.price ?? null;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const providers = [sq ? SWISSQUOTE : null, y ? "yahoo-fx" : null].filter(Boolean).join(" + ");
  return {
    symbol: def.symbol,
    name: def.name,
    assetClass: "metal",
    group: def.group,
    base: def.base,
    quote: def.quote,
    unit: def.unit,
    price,
    bid: sq?.bid ?? null,
    ask: sq?.ask ?? null,
    change: y?.change ?? null,
    changePercent: y?.changePercent ?? null,
    open: y?.previousClose ?? null,
    high: y?.dayHigh ?? null,
    low: y?.dayLow ?? null,
    previousClose: y?.previousClose ?? null,
    updatedAt: sq?.ts ? new Date(sq.ts).toISOString() : y?.marketTime ? new Date(y.marketTime).toISOString() : null,
    provider: providers || undefined,
  } satisfies MetalRow;
}

export interface MetalsMarket {
  rows: MetalRow[];
  note: string;
}

export async function getMetalsMarkets(): Promise<{ data: MetalsMarket; meta: Meta } | null> {
  // 1) Swissquote BBO (direct, cache 30s — quote realtime)
  let sqMap = new Map<string, { mid: number; bid: number; ask: number; ts: number | null }>();
  let sqOk = false;
  try {
    const r = await cached(`metals:swissquote`, {
      ttlMs: 30_000,
      staleMs: 12 * 3_600_000,
      producer: async () => {
        const m = await getSwissquoteQuotes(METAL_CATALOG.map((d) => ({ base: d.base, quote: d.quote })));
        return { m: Array.from(m.entries()).map(([k, v]) => ({ k, v })) };
      },
    });
    sqMap = new Map(r.value.m.map((x) => [x.k, x.v]));
    sqOk = r.value.m.length > 0;
  } catch {
    /* degrade */
  }
  // 2) Yahoo daily reference (change/prevClose + fallback price)
  let yMap = new Map<string, YahooQuote>();
  let yOk = false;
  try {
    const r = await cached(`metals:yahoo-quotes`, {
      ttlMs: 60_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const m = await getYahooQuotes(allYahooSymbols());
        return { entries: Array.from(m.entries()) };
      },
    });
    yMap = new Map(r.value.entries);
    yOk = r.value.entries.length > 0;
  } catch {
    /* degrade */
  }

  const rows: MetalRow[] = [];
  for (const def of METAL_CATALOG) {
    const sq = sqMap.get(def.symbol) ?? null;
    const y = def.yahooSymbols.map((s) => yMap.get(s)).find((q) => q != null) ?? null;
    const row = rowFromSources(def, sq, y);
    if (row) rows.push(row);
  }

  if (!rows.length) return null;

  // Feed vào Realtime Market Store (shared, write-through pattern của FX)
  for (const r of rows) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue;
    marketStore.setQuote({
      assetType: "metal",
      symbol: r.symbol,
      price: r.price,
      change: r.change,
      changePercent: r.changePercent,
      open: r.open,
      high: r.high,
      low: r.low,
      source: r.provider ?? "metals-engine",
      ts: r.updatedAt ? Date.parse(r.updatedAt) : Date.now(),
    });
  }

  const got = new Set(rows.map((r) => r.symbol));
  const missing = METAL_CATALOG.filter((d) => !got.has(d.symbol));
  const errors: NonNullable<Meta["errors"]> = missing.length
    ? [{ component: "quote", status: "PARTIAL", message: `Provider không trả: ${missing.map((d) => d.symbol).join(", ")}` }]
    : [];
  if (!sqOk) {
    errors.push({ component: "quote", status: "PARTIAL", message: "Swissquote BBO không khả dụng — dùng Yahoo Finance (tham chiếu, có thể trễ phiên)" });
  }
  if (!yOk) {
    errors.push({ component: "quote", status: "PARTIAL", message: "Yahoo Finance reference không khả dụng — change/prevClose không có" });
  }

  const newest = rows.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
  const meta = buildMeta({
    source: [sqOk ? SWISSQUOTE : null, yOk ? "yahoo-fx" : null].filter(Boolean).join(" + ") || "unavailable",
    sourceTimestampMs: newest || Date.now(),
    partial: errors.length > 0,
    note:
      sqOk && yOk
        ? "Giá BBO trực tiếp từ Swissquote (public); % thay đổi/đóng cửa trước từ Yahoo Finance. Cuối tuần thị trường đóng cửa — giá là phiên gần nhất, không phải provider error."
        : sqOk
          ? "Giá BBO trực tiếp từ Swissquote (public); nguồn tham chiếu Yahoo chưa khả dụng nên thiếu cột % thay đổi."
          : "Swissquote chưa khả dụng — dùng giá tham chiếu Yahoo Finance (có thể trễ so với thị trường).",
    slas: { liveSlaMs: 60_000, freshSlaMs: 10 * 60_000, delayedSlaMs: 24 * 3_600_000 },
    errors: errors.length ? errors : undefined,
  });
  return { data: { rows, note: meta.note ?? "" }, meta };
}

/** Row từ market store nếu còn FRESH (150s) — tránh gọi lại provider. */
export function metalRowFromStore(symbol: string): MetalRow | null {
  const def = metalDef(symbol);
  if (!def) return null;
  const q = marketStore.getQuote("metal", def.symbol);
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return null;
  if (Date.now() - q.ingestedAt > 150_000) return null;
  return {
    symbol: def.symbol,
    name: def.name,
    assetClass: "metal",
    group: def.group,
    base: def.base,
    quote: def.quote,
    unit: def.unit,
    price: q.price,
    change: q.change ?? null,
    changePercent: q.changePercent ?? null,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    previousClose: q.previousClose ?? null,
    updatedAt: new Date(q.ts).toISOString(),
    provider: q.source,
  } satisfies MetalRow;
}

/** Chuỗi daily THẬT từ Yahoo (spot → futures failover), dùng cho performance/technical. */
export async function getMetalDailyCandles(symbol: string): Promise<{ candles: ChartCandle[]; source: string } | null> {
  const def = metalDef(symbol);
  if (!def) return null;
  let lastErr = "no_symbols";
  for (const y of def.yahooSymbols) {
    try {
      const yres = await getYahooChart(y, "1d", "2y");
      if (yres.candles.length) return { candles: yres.candles, source: `yahoo-fx (${y})` };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "unreachable";
    }
  }
  void lastErr;
  return null;
}

export interface MetalDetail {
  symbol: string;
  name: string;
  unit: string;
  current: MetalRow | null;
  daily: OhlcvBar[];
  performance: PerformanceResult | null;
  performanceNote: string;
  technical: TechnicalSnapshot | null;
  referenceNote: string;
}

export async function getMetalDetail(symbolRaw: string): Promise<{ detail: MetalDetail; meta: Meta } | null> {
  const def = metalDef(symbolRaw);
  if (!def) return null;
  const symbol = def.symbol;

  let current = metalRowFromStore(symbol);
  if (!current) {
    const markets = await getMetalsMarkets();
    current = markets?.data.rows.find((r) => r.symbol === symbol) ?? null;
  }

  const errors: NonNullable<Meta["errors"]> = [];
  let daily: ChartCandle[] = [];
  let dailySource: string | null = null;
  try {
    const d = await getMetalDailyCandles(symbol);
    if (d) {
      daily = d.candles;
      dailySource = d.source;
    }
  } catch {
    /* đã ghi trong errors dưới */
  }
  if (!daily.length) errors.push({ component: "chart", status: "UNAVAILABLE", message: "Chuỗi OHLC lịch sử (Yahoo Finance) không khả dụng — không hiển thị candles giả" });

  const bars: OhlcvBar[] = daily.map((c) => ({ ...c, volume: c.volume ?? 0 }));
  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;
  const performance = computeDailyPerformance(daily);

  const hasQuote = current != null;
  const hasSeries = bars.length > 0;
  if (!hasQuote && !hasSeries) return null;

  const meta = buildMeta({
    source: dailySource ?? current?.provider ?? "metals-engine",
    sourceTimestampMs: hasSeries ? daily[daily.length - 1]?.time ?? null : current?.updatedAt ? Date.parse(current.updatedAt) : null,
    partial: errors.length > 0 || !hasSeries || !hasQuote || !performance,
    note: !hasQuote
      ? "Giá hiện tại chưa khả dụng — chỉ còn chuỗi lịch sử OHLC"
      : !hasSeries
        ? "Giá hiện tại có nhưng chuỗi lịch sử không khả dụng — không vẽ candles giả"
        : undefined,
    slas: { liveSlaMs: 60_000, freshSlaMs: 10 * 60_000, delayedSlaMs: 24 * 3_600_000 },
    sections: {
      quote: hasQuote ? "FRESH" : "UNAVAILABLE",
      chart: hasSeries ? "FRESH" : "UNAVAILABLE",
      technical: technical ? "FRESH" : "UNAVAILABLE",
      performance: performance ? "FRESH" : "UNAVAILABLE",
    },
    errors: errors.length ? errors : undefined,
  });
  return {
    detail: {
      symbol,
      name: def.name,
      unit: def.unit,
      current,
      daily: bars,
      performance,
      performanceNote: performance
        ? "Hiệu suất tính trên nến đóng cửa hằng ngày thật (Yahoo Finance) — 1D/1W/1M/1Q/1Y theo mốc lịch; mốc nào chưa đủ dữ liệu hiển thị —."
        : "Chưa đủ dữ liệu daily để tính hiệu suất (không nội suy).",
      technical,
      referenceNote: `Chuỗi lịch sử: OHLC hằng ngày từ Yahoo Finance public (${def.yahooSymbols.join(" → ")} — spot ưu tiên, futures failover). Hiệu suất 1D/1W/1M/1Q/1Y tính theo nến thật — không nội suy.`,
    },
    meta,
  };
}

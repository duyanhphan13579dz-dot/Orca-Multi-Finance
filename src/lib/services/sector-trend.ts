import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import type { Meta, Quote } from "../types";
import { sectorOf, VN_SECTOR_MAP } from "../vn/master";
import { getVnMarketBoard } from "./stocks";

export interface SectorTrendMember {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  quoteVolume: number | null;
}

export interface SectorTrendRow {
  sector: string;
  /** Số mã có quote trong phiên */
  count: number;
  /** Số mã trong master ngành */
  universeCount: number;
  avgChangePercent: number | null;
  medianChangePercent: number | null;
  advances: number;
  declines: number;
  unchanged: number;
  totalVolume: number;
  totalValue: number;
  /** Điểm xu hướng -100..100 dựa trên % tăng TB + breadth */
  trendScore: number | null;
  trendLabelVi: string;
  topGainers: SectorTrendMember[];
  topLosers: SectorTrendMember[];
}

export interface SectorTrendSnapshot {
  sessionDate: string | null;
  sectors: SectorTrendRow[];
  leaders: SectorTrendRow[];
  laggards: SectorTrendRow[];
  marketAvgChangePercent: number | null;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function trendLabel(score: number | null): string {
  if (score == null) return "Chưa đủ dữ liệu";
  if (score >= 40) return "Tăng mạnh";
  if (score >= 15) return "Tăng";
  if (score >= 5) return "Hơi tăng";
  if (score > -5) return "Đi ngang";
  if (score > -15) return "Hơi giảm";
  if (score > -40) return "Giảm";
  return "Giảm mạnh";
}

/** Điểm xu hướng: 60% avg change (clamp ±5% → ±60) + 40% breadth */
function scoreTrend(avgChg: number | null, advances: number, declines: number, n: number): number | null {
  if (n <= 0 || avgChg == null) return null;
  const chgPart = Math.max(-60, Math.min(60, (avgChg / 5) * 60));
  const breadth = advances + declines > 0 ? ((advances - declines) / (advances + declines)) * 40 : 0;
  return Math.round(Math.max(-100, Math.min(100, chgPart + breadth)));
}

function toMember(q: Quote): SectorTrendMember {
  return {
    symbol: q.symbol,
    name: q.name ?? null,
    price: q.price ?? null,
    changePercent: q.changePercent ?? null,
    volume: q.volume ?? null,
    quoteVolume: q.quoteVolume ?? null,
  };
}

export function aggregateSectorTrends(quotes: Quote[]): SectorTrendRow[] {
  const bySector = new Map<string, Quote[]>();
  for (const q of quotes) {
    if (q.price == null && q.changePercent == null) continue;
    const sec = sectorOf(q.symbol);
    const arr = bySector.get(sec) ?? [];
    arr.push(q);
    bySector.set(sec, arr);
  }

  const universeSize = new Map(VN_SECTOR_MAP.map((s) => [s.name, s.symbols.length]));

  const rows: SectorTrendRow[] = [];
  for (const [sector, list] of bySector) {
    const chgs = list.map((q) => q.changePercent).filter((v): v is number => v != null && Number.isFinite(v));
    let advances = 0;
    let declines = 0;
    let unchanged = 0;
    for (const c of chgs) {
      if (c > 0.05) advances++;
      else if (c < -0.05) declines++;
      else unchanged++;
    }
    const avgChg = avg(chgs);
    const medChg = median(chgs);
    const totalVolume = list.reduce((s, q) => s + (q.volume ?? 0), 0);
    const totalValue = list.reduce((s, q) => s + (q.quoteVolume ?? 0), 0);
    const sorted = [...list].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
    const trendScore = scoreTrend(avgChg, advances, declines, list.length);

    rows.push({
      sector,
      count: list.length,
      universeCount: universeSize.get(sector) ?? list.length,
      avgChangePercent: avgChg,
      medianChangePercent: medChg,
      advances,
      declines,
      unchanged,
      totalVolume,
      totalValue,
      trendScore,
      trendLabelVi: trendLabel(trendScore),
      topGainers: sorted.slice(0, 5).map(toMember),
      topLosers: sorted.slice(-5).reverse().map(toMember),
    });
  }

  return rows.sort((a, b) => (b.trendScore ?? -999) - (a.trendScore ?? -999));
}

export async function getSectorTrendSnapshot(opts?: {
  sector?: string;
}): Promise<{ snapshot: SectorTrendSnapshot; meta: Meta } | null> {
  const board = await getVnMarketBoard();
  if (!board?.quotes?.length) return null;

  const cacheKey = `sector-trend:v1:${opts?.sector ?? "all"}`;
  const res = await cached(cacheKey, {
    ttlMs: 20_000,
    staleMs: 15 * 60_000,
    producer: async () => {
      let rows = aggregateSectorTrends(board.quotes);
      if (opts?.sector) {
        const needle = opts.sector.trim().toLowerCase();
        rows = rows.filter(
          (r) => r.sector.toLowerCase() === needle || r.sector.toLowerCase().includes(needle),
        );
      }
      const withScore = rows.filter((r) => r.trendScore != null);
      const marketChgs = board.quotes
        .map((q) => q.changePercent)
        .filter((v): v is number => v != null && Number.isFinite(v));
      return {
        sessionDate: board.sessionDate ?? null,
        sectors: rows,
        leaders: withScore.slice(0, 5),
        laggards: [...withScore].reverse().slice(0, 5),
        marketAvgChangePercent: avg(marketChgs),
      } satisfies SectorTrendSnapshot;
    },
  });

  return {
    snapshot: res.value,
    meta: buildMeta({
      source: board.meta.source,
      sourceTimestampMs: board.meta.sourceTimestamp ? Date.parse(board.meta.sourceTimestamp) : null,
      cached: res.cached || board.meta.cached,
      stale: res.stale || board.meta.stale,
      note: `Xu hướng ngành · ${res.value.sectors.length} nhóm · phiên ${res.value.sessionDate ?? "—"}`,
      slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 6 * 3_600_000 },
    }),
  };
}

/** Xu hướng ngành của một mã cụ thể */
export async function getSectorTrendForSymbol(
  symbol: string,
): Promise<{ sector: string; row: SectorTrendRow | null; snapshot: SectorTrendSnapshot; meta: Meta } | null> {
  const sector = sectorOf(symbol);
  const full = await getSectorTrendSnapshot();
  if (!full) return null;
  const row = full.snapshot.sectors.find((s) => s.sector === sector) ?? null;
  return { sector, row, snapshot: full.snapshot, meta: full.meta };
}

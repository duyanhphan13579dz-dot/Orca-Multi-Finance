/**
 * EVENT INTELLIGENCE ENGINE (Phase 3) — phát hiện sự kiện thị trường từ dữ liệu.
 *
 * Sự kiện = quan sát có thể kiểm chứng (index move, sector move, khối lượng,
 * kỷ lục 20 phiên, cụm mã mạnh, alert cluster). Xếp hạng severity, kèm
 * relatedSymbols/affectedSector để UI sau này chỉ cần render — không redesign.
 * Không bao giờ suy diễn "tin đồn" — chỉ dữ liệu đã tính.
 */

export type EventType =
  | "index_breakout"
  | "index_breakdown"
  | "index_volume_surge"
  | "sector_rotation"
  | "mass_movers"
  | "breadth_extreme"
  | "new_highs"
  | "new_lows"
  | "volatility_expansion";

export type EventSeverity = "info" | "watch" | "critical";

export interface MarketEvent {
  id: string;
  type: EventType;
  severity: EventSeverity;
  title: string;
  description: string;
  relatedSymbols: string[];
  affectedSector: string | null;
  value: number | null;
  ts: number;
}

export interface EventInputs {
  indexChangePercent: number | null;
  indexVolumeRatio: number | null;
  advancers: number | null;
  decliners: number | null;
  total: number | null;
  newHighs20: number | null;
  newLows20: number | null;
  topSector: string | null;
  sectorDispersionPct: number | null;
  massMovers: { symbol: string; sector: string | null; changePercent: number; volumeRatio: number | null }[];
  volatilityRatio: number | null;
  ts?: number;
}

const severityRank: Record<EventSeverity, number> = { critical: 3, watch: 2, info: 1 };

export function detectMarketEvents(input: EventInputs, tsOverride?: number): MarketEvent[] {
  const ts = tsOverride ?? input.ts ?? Date.now();
  const out: MarketEvent[] = [];
  const id = (type: EventType, salt: string) => `${type}:${salt}:${Math.floor(ts / 300_000)}`;

  const ch = input.indexChangePercent ?? 0;

  if (ch >= 1) {
    out.push({
      id: id("index_breakout", "up"),
      type: "index_breakout",
      severity: "watch",
      title: `Chỉ số tăng ${ch.toFixed(2)}%`,
      description: `VN-Index bứt phá ${ch >= 2 ? "mạnh" : ""} ${ch.toFixed(2)}% trong phiên.`,
      relatedSymbols: [],
      affectedSector: null,
      value: ch,
      ts,
    });
  }
  if (ch <= -1) {
    out.push({
      id: id("index_breakdown", "down"),
      type: "index_breakdown",
      severity: "critical",
      title: `Chỉ số giảm ${Math.abs(ch).toFixed(2)}%`,
      description: `Áp lực bán mạnh lên chỉ số (${ch.toFixed(2)}%).`,
      relatedSymbols: [],
      affectedSector: null,
      value: ch,
      ts,
    });
  }

  if (input.indexVolumeRatio != null && input.indexVolumeRatio >= 1.6 && ch >= 0.5) {
    out.push({
      id: id("index_volume_surge", `${input.indexVolumeRatio.toFixed(1)}`),
      type: "index_volume_surge",
      severity: "watch",
      title: "Khối lượng tăng điểm đột biến",
      description: `Cầu mạnh: khối lượng ×${input.indexVolumeRatio.toFixed(1)} trung bình 20 phiên.`,
      relatedSymbols: [],
      affectedSector: null,
      value: input.indexVolumeRatio,
      ts,
    });
  }

  if (input.sectorDispersionPct != null && input.sectorDispersionPct >= 30 && input.topSector) {
    out.push({
      id: id("sector_rotation", input.topSector),
      type: "sector_rotation",
      severity: "watch",
      title: `Dòng tiền xoay sang ${input.topSector}`,
      description: `Phân tán ngành ${input.sectorDispersionPct.toFixed(0)} điểm — ${input.topSector} dẫn đầu, khả năng rotation.`,
      relatedSymbols: [],
      affectedSector: input.topSector,
      value: input.sectorDispersionPct,
      ts,
    });
  }

  const big = input.massMovers.filter((m) => Math.abs(m.changePercent) >= 5);
  if (big.length >= 3) {
    const bySector = new Map<string, { up: string[]; down: string[] }>();
    for (const m of big) {
      const k = m.sector ?? "Khác";
      const entry = bySector.get(k) ?? { up: [], down: [] };
      if (m.changePercent > 0) entry.up.push(m.symbol);
      else entry.down.push(m.symbol);
      bySector.set(k, entry);
    }
    for (const [sector, e] of bySector) {
      const cluster = e.up.length >= 3 || e.down.length >= 3;
      if (!cluster) continue;
      const dir = e.up.length >= 3 ? "tăng mạnh" : "giảm mạnh";
      const syms = (e.up.length >= 3 ? e.up : e.down).slice(0, 6);
      out.push({
        id: id("mass_movers", `${sector}:${dir}`),
        type: "mass_movers",
        severity: "watch",
        title: `Cụm ${dir} ngành ${sector}`,
        description: `${syms.length} mã ${dir} ≥5%: ${syms.join(", ")}.`,
        relatedSymbols: syms,
        affectedSector: sector,
        value: syms.length,
        ts,
      });
    }
  }

  if (input.advancers != null && input.decliners != null && input.total != null && input.total > 0) {
    const advRatio = input.advancers / input.total;
    if (advRatio >= 0.7) {
      out.push({
        id: id("breadth_extreme", "up"),
        type: "breadth_extreme",
        severity: "info",
        title: "Breadth cực rộng theo chiều tăng",
        description: `${input.advancers}/${input.total} mã tăng (${(advRatio * 100).toFixed(0)}%) — thị trường tăng toàn diện.`,
        relatedSymbols: [],
        affectedSector: null,
        value: Number(advRatio.toFixed(3)),
        ts,
      });
    } else if (advRatio <= 0.3) {
      out.push({
        id: id("breadth_extreme", "down"),
        type: "breadth_extreme",
        severity: "watch",
        title: "Breadth cực hẹp theo chiều giảm",
        description: `Chỉ ${(advRatio * 100).toFixed(0)}% mã tăng — đà giảm chi phối toàn thị trường.`,
        relatedSymbols: [],
        affectedSector: null,
        value: Number(advRatio.toFixed(3)),
        ts,
      });
    }
  }

  if (input.newHighs20 != null && input.newHighs20 >= 8) {
    out.push({
      id: id("new_highs", `${input.newHighs20}`),
      type: "new_highs",
      severity: "info",
      title: `${input.newHighs20} mã phá đỉnh 20 phiên`,
      description: `Số mã lập đỉnh mới ${input.newHighs20} — động lực tích cực lan rộng.`,
      relatedSymbols: [],
      affectedSector: null,
      value: input.newHighs20,
      ts,
    });
  }
  if (input.newLows20 != null && input.newLows20 >= 8) {
    out.push({
      id: id("new_lows", `${input.newLows20}`),
      type: "new_lows",
      severity: "watch",
      title: `${input.newLows20} mã phá đáy 20 phiên`,
      description: `Số mã lập đáy mới ${input.newLows20} — áp lực bán lan rộng.`,
      relatedSymbols: [],
      affectedSector: null,
      value: input.newLows20,
      ts,
    });
  }

  if (input.volatilityRatio != null && input.volatilityRatio >= 1.5) {
    out.push({
      id: id("volatility_expansion", `${input.volatilityRatio.toFixed(1)}`),
      type: "volatility_expansion",
      severity: "info",
      title: "Biến động mở rộng",
      description: `Vol 30 phiên ×${input.volatilityRatio.toFixed(1)} nền 120 phiên — môi trường rủi ro tăng.`,
      relatedSymbols: [],
      affectedSector: null,
      value: input.volatilityRatio,
      ts,
    });
  }

  out.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.ts - a.ts);
  return out;
}

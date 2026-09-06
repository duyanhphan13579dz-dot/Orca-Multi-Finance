/**
 * SECTOR ROTATION ENGINE (Phase 3) — xoay vòng ngành từ dữ liệu thật.
 *
 * Mỗi ngành có: performance hôm nay (trung vị %thay đổi — median chống outlier),
 * participation (tăng/giảm), tỷ trọng giá trị giao dịch, RS so với thị trường,
 * và điểm rotation 0..100 (50 = trung tính). Rotation = momentum tương đối của
 * ngành so với toàn thị trường + tham gia rộng (nhiều mã cùng chiều).
 */

export interface SectorQuoteInput {
  symbol: string;
  sector: string | null;
  changePercent: number | null;
  quoteVolume?: number | null;
  volume?: number | null;
}

export interface SectorRotationRow {
  sector: string;
  count: number;
  medianChangePct: number;
  advancers: number;
  decliners: number;
  participationRatio: number; // 0..1 — share các mã tăng trong ngành
  volumeSharePct: number; // 0..100 — tỷ trọng giá trị giao dịch toàn thị trường
  relativeStrength: number; // median change - market median change (pp)
  rotationScore: number; // 0..100 (50 trung tính)
  label: "leading" | "neutral" | "lagging";
}

export interface SectorRotationResult {
  rows: SectorRotationRow[];
  marketMedianChangePct: number;
  totalValue: number;
  dispersionPct: number; // độ phân tán giữa ngành mạnh nhất và yếu nhất
  topSector: string | null;
  laggardSector: string | null;
  note: string | null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeSectorRotation(quotes: SectorQuoteInput[]): SectorRotationResult {
  const bySector = new Map<string, SectorQuoteInput[]>();
  let totalValue = 0;
  for (const q of quotes) {
    const key = q.sector ?? "Khác";
    const arr = bySector.get(key) ?? [];
    arr.push(q);
    bySector.set(key, arr);
    totalValue += (q.quoteVolume ?? q.volume ?? 0) > 0 ? (q.quoteVolume ?? q.volume ?? 0) : 0;
  }
  const marketMedian = median(quotes.map((q) => q.changePercent ?? 0).filter((c) => Number.isFinite(c)));

  const rows: SectorRotationRow[] = [];
  for (const [sector, members] of bySector) {
    const changes = members.map((m) => m.changePercent ?? 0).filter((c) => Number.isFinite(c));
    if (!changes.length) continue;
    const med = median(changes);
    const advancers = members.filter((m) => (m.changePercent ?? 0) > 0).length;
    const decliners = members.filter((m) => (m.changePercent ?? 0) < 0).length;
    const participationRatio = members.length ? advancers / members.length : 0;
    const vol = members.reduce((a, m) => a + (m.quoteVolume ?? m.volume ?? 0), 0);
    const volumeSharePct = totalValue > 0 ? (vol / totalValue) * 100 : 0;
    const relativeStrength = med - marketMedian;
    // rotation score: RS (50) + participation (50)
    const rsScore = Math.max(0, Math.min(50, 50 + relativeStrength * 25));
    const partScore = Math.max(0, Math.min(50, 50 + (participationRatio - 0.5) * 100));
    const rotationScore = Math.round(rsScore + partScore);
    rows.push({
      sector,
      count: members.length,
      medianChangePct: Number(med.toFixed(2)),
      advancers,
      decliners,
      participationRatio: Number(participationRatio.toFixed(3)),
      volumeSharePct: Number(volumeSharePct.toFixed(1)),
      relativeStrength: Number(relativeStrength.toFixed(2)),
      rotationScore,
      label: rotationScore >= 65 ? "leading" : rotationScore <= 35 ? "lagging" : "neutral",
    });
  }
  rows.sort((a, b) => b.rotationScore - a.rotationScore);

  const scores = rows.map((r) => r.rotationScore);
  const dispersion = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  return {
    rows,
    marketMedianChangePct: Number(marketMedian.toFixed(2)),
    totalValue,
    dispersionPct: Number(dispersion.toFixed(0)),
    topSector: rows[0]?.sector ?? null,
    laggardSector: rows[rows.length - 1]?.sector ?? null,
    note: rows.length ? null : "Chưa có dữ liệu ngành — cần quotes VN để tính rotation.",
  };
}

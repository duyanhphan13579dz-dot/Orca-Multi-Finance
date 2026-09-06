/**
 * LEADERSHIP DETECTION ENGINE (Phase 3) — cổ phiếu dẫn dắt thị trường.
 *
 * Leadership score 0..100 = RS so với thị trường (40%) + momentum (30%) +
 * volume participation (30%). Classification theo score: leader ≥65,
 * laggard ≤35. Không "bình chọn" — chỉ xếp hạng từ dữ liệu thật.
 */

export interface LeadershipInput {
  symbol: string;
  sector: string | null;
  changePercent: number | null;
  quoteVolume?: number | null;
  volume?: number | null;
  /** tỷ trọng giá trị so với toàn thị trường 0..1 (đã chuẩn hoá) */
  volumeShare?: number | null;
  marketChangePercent?: number | null;
}

export interface LeadershipRow {
  symbol: string;
  sector: string | null;
  changePercent: number;
  relativeStrength: number; // change - market change (pp)
  volumeSharePct: number; // 0..100
  score: number; // 0..100
  label: "leader" | "neutral" | "laggard";
}

export interface LeadershipResult {
  leaders: LeadershipRow[];
  laggards: LeadershipRow[];
  marketChangePercent: number | null;
  note: string | null;
}

export function computeLeadership(rows: LeadershipInput[]): LeadershipResult {
  const marketChange = rows.length
    ? rows.reduce((a, r) => a + (r.changePercent ?? 0), 0) / rows.length
    : null;
  const totalVol = rows.reduce((a, r) => a + Math.max(r.quoteVolume ?? r.volume ?? 0, 0), 0);

  const scored: LeadershipRow[] = rows.map((r) => {
    const ch = r.changePercent ?? 0;
    const rs = marketChange != null ? ch - marketChange : ch;
    // RS 40 điểm: ±5pp → ±40
    const rsScore = Math.max(0, Math.min(40, 20 + rs * 8));
    // momentum 30 điểm: ±5% → ±30
    const momScore = Math.max(0, Math.min(30, 15 + ch * 6));
    // volume 30 điểm: share thị trường tương đối (0..1 → 0..30)
    const share = totalVol > 0 ? Math.max(r.quoteVolume ?? r.volume ?? 0, 0) / totalVol : 0;
    const volScore = Math.max(0, Math.min(30, share * 100 * 3));
    const score = Math.round(rsScore + momScore + volScore);
    return {
      symbol: r.symbol,
      sector: r.sector ?? null,
      changePercent: Number(ch.toFixed(2)),
      relativeStrength: Number(rs.toFixed(2)),
      volumeSharePct: Number((share * 100).toFixed(2)),
      score,
      label: score >= 65 ? "leader" : score <= 35 ? "laggard" : "neutral",
    };
  });
  scored.sort((a, b) => b.score - a.score);

  return {
    leaders: scored.filter((r) => r.label === "leader"),
    laggards: scored.filter((r) => r.label === "laggard"),
    marketChangePercent: marketChange != null ? Number(marketChange.toFixed(2)) : null,
    note: rows.length ? null : "Chưa có dữ liệu để phát hiện dẫn dắt.",
  };
}

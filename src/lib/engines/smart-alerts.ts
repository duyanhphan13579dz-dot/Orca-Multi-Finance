/**
 * SMART ALERTS ENGINE (Phase 3) — quy tắc cảnh báo "thông minh" cấp thị trường.
 *
 * Khác alert cá nhân (price/rsi/volume theo mã): các quy tắc này đọc trạng
 * thái thị trường tổng thể và trả signal có lý do rõ ràng. Thuần & xác định —
 * cùng input → cùng đầu ra. Không bao giờ đưa khuyến nghị mua/bán.
 */

export type SmartRuleId =
  | "breadth_thrust"
  | "breadth_capitulation"
  | "index_volume_surge"
  | "index_momentum_breakout"
  | "index_momentum_breakdown"
  | "sector_rotation_trigger"
  | "mass_movers_sector"
  | "new_highs_surge"
  | "volatility_expansion";

export interface SmartSignal {
  ruleId: SmartRuleId;
  severity: "info" | "watch" | "alert";
  title: string;
  description: string;
  value: number | null;
  ts: number;
}

export interface SmartAlertInputs {
  indexChangePercent: number | null;
  indexVolumeRatio: number | null; // hôm nay / trung bình 20 phiên
  advancers: number | null;
  decliners: number | null;
  total: number | null;
  newHighs20: number | null;
  newLows20: number | null;
  sectorRotationScore: number | null; // dispersion 0..100
  topSector: string | null;
  topSectorChange: number | null;
  massMovers: { symbol: string; sector: string | null; changePercent: number }[];
  volatilityRatio: number | null; // vol30 / vol120
  ts?: number;
}

const clampPct = (x: number) => Math.max(-1, Math.min(1, x / 100));
void clampPct;

export function evaluateSmartRules(input: SmartAlertInputs): SmartSignal[] {
  const ts = input.ts ?? Date.now();
  const out: SmartSignal[] = [];

  // 1) breadth thrust: tỷ lệ tăng/giảm ≥ 2.5 và index dương → đà lan rộng
  if (input.advancers != null && input.decliners != null && input.decliners > 0) {
    const ratio = input.advancers / input.decliners;
    if (ratio >= 2.5 && (input.indexChangePercent ?? 0) > 0) {
      out.push({
        ruleId: "breadth_thrust",
        severity: "watch",
        title: "Breadth thrust",
        description: `${input.advancers} mã tăng / ${input.decliners} mã giảm (×${ratio.toFixed(1)}) — đà tăng lan rộng toàn thị trường.`,
        value: Number(ratio.toFixed(2)),
        ts,
      });
    }
    if (ratio <= 0.4 && (input.indexChangePercent ?? 0) < 0) {
      out.push({
        ruleId: "breadth_capitulation",
        severity: "alert",
        title: "Áp lực bán lan rộng",
        description: `${input.decliners} mã giảm so với ${input.advancers} mã tăng (×${(1 / ratio).toFixed(1)} chiều bán) — thị trường chịu áp lực toàn diện.`,
        value: Number(ratio.toFixed(2)),
        ts,
      });
    }
  }

  // 2) index volume surge: khối lượng đột biến ≥ 1.6x với chỉ số tăng mạnh
  if (input.indexVolumeRatio != null && input.indexVolumeRatio >= 1.6 && (input.indexChangePercent ?? 0) >= 0.8) {
    out.push({
      ruleId: "index_volume_surge",
      severity: "alert",
      title: "Khối lượng đột biến tăng điểm",
      description: `Chỉ số +${(input.indexChangePercent ?? 0).toFixed(2)}% với khối lượng ×${input.indexVolumeRatio.toFixed(1)} trung bình 20 phiên.`,
      value: input.indexVolumeRatio,
      ts,
    });
  }

  // 3) momentum breakout/breakdown: chỉ số ±1% xác nhận bởi breadth
  const ch = input.indexChangePercent ?? 0;
  const breadthOk = (input.advancers ?? 0) > (input.decliners ?? 0);
  if (ch >= 1 && breadthOk) {
    out.push({
      ruleId: "index_momentum_breakout",
      severity: "watch",
      title: "Đà tăng chỉ số",
      description: `Chỉ số +${ch.toFixed(2)}% cùng breadth thuận (${input.advancers} tăng / ${input.decliners} giảm).`,
      value: ch,
      ts,
    });
  }
  if (ch <= -1 && !breadthOk) {
    out.push({
      ruleId: "index_momentum_breakdown",
      severity: "alert",
      title: "Đà giảm chỉ số",
      description: `Chỉ số ${ch.toFixed(2)}% cùng breadth nghịch (${input.advancers} tăng / ${input.decliners} giảm).`,
      value: ch,
      ts,
    });
  }

  // 4) sector rotation trigger: phân tán ≥ 30 điểm + top sector đủ mạnh
  if (input.sectorRotationScore != null && input.sectorRotationScore >= 30 && input.topSector && (input.topSectorChange ?? 0) >= 0.5) {
    out.push({
      ruleId: "sector_rotation_trigger",
      severity: "watch",
      title: `Dòng tiền xoay sang ${input.topSector}`,
      description: `Phân tán ngành ${input.sectorRotationScore.toFixed(0)} điểm; ${input.topSector} dẫn đầu +${(input.topSectorChange ?? 0).toFixed(2)}%.`,
      value: input.sectorRotationScore,
      ts,
    });
  }

  // 5) mass movers: ≥3 mã cùng ngành trong top tăng ≥5% → cụm ngành
  const big = input.massMovers.filter((m) => m.changePercent >= 5);
  if (big.length >= 3) {
    const bySector = new Map<string, number>();
    for (const m of big) {
      const k = m.sector ?? "Khác";
      bySector.set(k, (bySector.get(k) ?? 0) + 1);
    }
    for (const [sector, n] of bySector) {
      if (n < 3) continue;
      out.push({
        ruleId: "mass_movers_sector",
        severity: "watch",
        title: `Cụm mã mạnh ngành ${sector}`,
        description: `${n} mã ngành ${sector} tăng ≥5%: ${big.filter((m) => (m.sector ?? "Khác") === sector).map((m) => m.symbol).join(", ")}.`,
        value: n,
        ts,
      });
    }
  }

  // 6) new highs surge: ≥8 mã phá đỉnh 20 phiên
  if (input.newHighs20 != null && input.newHighs20 >= 8) {
    out.push({
      ruleId: "new_highs_surge",
      severity: "info",
      title: "Nhiều mã phá đỉnh 20 phiên",
      description: `${input.newHighs20} mã lập đỉnh mới — động lực tích cực bền vững hơn chỉ số đơn lẻ.`,
      value: input.newHighs20,
      ts,
    });
  }

  // 7) volatility expansion: ×1.5 so với nền
  if (input.volatilityRatio != null && input.volatilityRatio >= 1.5) {
    out.push({
      ruleId: "volatility_expansion",
      severity: "info",
      title: "Biến động mở rộng",
      description: `Biến động 30 phiên gấp ×${input.volatilityRatio.toFixed(1)} nền 120 phiên — thị trường chuyển sang trạng thái rủi ro cao hơn.`,
      value: input.volatilityRatio,
      ts,
    });
  }

  const severityRank = { alert: 3, watch: 2, info: 1 };
  out.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  return out;
}

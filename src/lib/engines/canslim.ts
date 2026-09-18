import type { OhlcvBar } from "../types";
import type { GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "./fundamental";

/**
 * CAN SLIM heuristic (William O'Neil) — nghiên cứu, không phải tín hiệu mua bán.
 * VN: BCTC + ratios VNDirect, OHLCV (RS/new high/volume), NN proxy Institutional,
 * M từ VNINDEX (trend + MA50).
 *
 * Lưu ý: GrowthSnapshot.changePct là tỉ lệ (0.25 = +25%), engine đổi sang %.
 */

export type CanslimLetter = "C" | "A" | "N" | "S" | "L" | "I" | "M";

export interface CanslimLetterScore {
  letter: CanslimLetter;
  pass: boolean;
  score: number;
  detail: string;
  value: number | null;
}

export interface CanslimSnapshot {
  letters: CanslimLetterScore[];
  passCount: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  gradeVi: string;
  flags: string[];
  metrics: {
    epsYoyPct: number | null;
    revenueYoyPct: number | null;
    epsQoqPct: number | null;
    roePct: number | null;
    annualGrowthPct: number | null;
    pctFromHigh: number | null;
    rsRank: number | null;
    volRatio: number | null;
    foreignNet: number | null;
    foreignNet5d: number | null;
    sharesOutstanding: number | null;
  };
  dataCoverage: {
    hasGrowth: boolean;
    hasHealth: boolean;
    hasBars: boolean;
    hasForeign: boolean;
    hasRatios: boolean;
    barsCount: number;
  };
  notes: string[];
}

const LETTER_VI: Record<CanslimLetter, string> = {
  C: "Current EPS/LN quý",
  A: "Annual growth / ROE",
  N: "New high / gần đỉnh",
  S: "Supply & Demand (volume)",
  L: "Leader (Relative Strength)",
  I: "Institutional (NN proxy)",
  M: "Market direction",
};

/** Đổi changePct (tỉ lệ 0.25) → phần trăm 25; nếu đã là % (|x|>3) giữ nguyên. */
function toPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  // Growth engine trả 0.25; một số API ratios có thể đã là 25
  if (Math.abs(raw) <= 3) return raw * 100;
  return raw;
}

function growthOf(g: GrowthSnapshot | null | undefined, metric: string, kind: "yoy" | "qoq" = "yoy"): number | null {
  if (!g) return null;
  const cell = (kind === "yoy" ? g.yoy : g.qoq).find((c) => c.metric === metric);
  return toPct(cell?.changePct ?? null);
}

function annualNiCagr(periods: NormalizedPeriod[] | null | undefined): number | null {
  if (!periods?.length) return null;
  const years = periods
    .filter((p) => p.periodType === "year" && p.metrics.netIncome != null)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  if (years.length >= 2) {
    const first = years[0]!.metrics.netIncome!;
    const last = years[years.length - 1]!.metrics.netIncome!;
    const n = years.length - 1;
    if (first > 0 && last > 0 && n > 0) {
      return (Math.pow(last / first, 1 / n) - 1) * 100;
    }
  }
  const annualish = periods
    .filter((p) => p.metrics.netIncome != null && (p.periodType === "year" || p.quarter == null))
    .slice(0, 6);
  if (annualish.length >= 2) {
    const a = annualish[1]!.metrics.netIncome!;
    const b = annualish[0]!.metrics.netIncome!;
    if (a !== 0) return ((b - a) / Math.abs(a)) * 100;
  }
  return null;
}

function pctFromHigh(bars: OhlcvBar[]): number | null {
  if (bars.length < 20) return null;
  const slice = bars.slice(-252);
  const hi = Math.max(...slice.map((b) => b.high));
  const last = slice[slice.length - 1]!.close;
  if (hi <= 0) return null;
  return ((last - hi) / hi) * 100;
}

function volRatio(bars: OhlcvBar[]): number | null {
  if (bars.length < 30) return null;
  const recent = bars.slice(-5);
  const base = bars.slice(-55, -5);
  const avgR = recent.reduce((s, b) => s + (b.volume || 0), 0) / recent.length;
  const avgB = base.reduce((s, b) => s + (b.volume || 0), 0) / Math.max(base.length, 1);
  if (avgB <= 0) return null;
  return avgR / avgB;
}

function retPct(bars: OhlcvBar[], lookback: number): number | null {
  if (bars.length < lookback + 2) return null;
  const a = bars[bars.length - 1 - lookback]!.close;
  const b = bars[bars.length - 1]!.close;
  if (a <= 0) return null;
  return ((b - a) / a) * 100;
}

export function analyzeCanslim(input: {
  bars: OhlcvBar[];
  growth: GrowthSnapshot | null;
  health: FinancialHealthResult | null;
  periods?: NormalizedPeriod[] | null;
  /** Ròng NN phiên gần nhất (VND) */
  foreignNetVal?: number | null;
  /** Tổng ròng NN 5 phiên */
  foreignNet5d?: number | null;
  marketBullish?: boolean | null;
  marketDetail?: string | null;
  rsRank?: number | null;
  /** ROE % từ VNDirect ratios (fallback) */
  ratiosRoePct?: number | null;
  /** EPS từ ratios — chỉ tham chiếu note */
  ratiosEps?: number | null;
  sharesOutstanding?: number | null;
}): CanslimSnapshot {
  const notes: string[] = [];
  const flags: string[] = [];

  const epsYoy =
    growthOf(input.growth, "netIncome", "yoy") ??
    growthOf(input.growth, "netIncomeParent", "yoy") ??
    null;
  const epsQoq =
    growthOf(input.growth, "netIncome", "qoq") ??
    growthOf(input.growth, "netIncomeParent", "qoq") ??
    null;
  const revYoy = growthOf(input.growth, "revenue", "yoy") ?? growthOf(input.growth, "netRevenue", "yoy");

  let roe =
    input.health?.groups.profitability.roe != null
      ? input.health.groups.profitability.roe * 100
      : null;
  if (roe == null && input.ratiosRoePct != null) {
    // ratios ROE có thể 0.22 hoặc 22
    roe = Math.abs(input.ratiosRoePct) <= 3 ? input.ratiosRoePct * 100 : input.ratiosRoePct;
    notes.push("ROE từ VNDirect ratios");
  }

  const annualG = annualNiCagr(input.periods ?? null);
  const fromHigh = pctFromHigh(input.bars);
  const vr = volRatio(input.bars);
  const rsRank = input.rsRank ?? null;
  const foreignNet = input.foreignNetVal ?? null;
  const foreignNet5d = input.foreignNet5d ?? null;
  const shares = input.sharesOutstanding ?? null;

  // —— C ——
  let cScore = 30;
  let cPass = false;
  let cDetail = "Thiếu tăng trưởng LN quý YoY (BCTC)";
  if (epsYoy != null) {
    if (epsYoy >= 50) {
      cScore = 95;
      cPass = true;
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% (rất mạnh)`;
    } else if (epsYoy >= 25) {
      cScore = 85;
      cPass = true;
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% (≥25%)`;
    } else if (epsYoy >= 18) {
      cScore = 70;
      cPass = true;
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% (ngưỡng mềm)`;
    } else if (epsYoy >= 0) {
      cScore = 45;
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% — dưới 18%`;
    } else {
      cScore = 20;
      cDetail = `LN YoY ${epsYoy.toFixed(0)}% — đang giảm`;
      flags.push("C: LN quý đang âm tăng trưởng");
    }
    // Acceleration: QoQ dương + YoY mạnh
    if (epsQoq != null && epsQoq > 5 && cPass) {
      cScore = Math.min(100, cScore + 5);
      cDetail += ` · QoQ +${epsQoq.toFixed(0)}%`;
    }
    if (revYoy != null && revYoy >= 20 && cPass) {
      cScore = Math.min(100, cScore + 5);
      cDetail += ` · DT +${revYoy.toFixed(0)}%`;
    } else if (revYoy != null && revYoy < 5 && epsYoy > 25) {
      notes.push("LN tăng nhanh nhưng DT yếu — kiểm tra biên / one-off");
      cScore = Math.max(40, cScore - 10);
    }
  }

  // —— A ——
  let aScore = 30;
  let aPass = false;
  let aDetail = "Thiếu chuỗi tăng trưởng năm / ROE";
  if (annualG != null && annualG >= 25) {
    aScore = 90;
    aPass = true;
    aDetail = `CAGR LN ~${annualG.toFixed(0)}%/năm`;
  } else if (annualG != null && annualG >= 15) {
    aScore = 72;
    aPass = true;
    aDetail = `CAGR LN ~${annualG.toFixed(0)}%/năm`;
  } else if (roe != null && roe >= 17) {
    aScore = 78;
    aPass = true;
    aDetail = `ROE ${roe.toFixed(1)}% (≥17%)`;
  } else if (roe != null && roe >= 12) {
    aScore = 58;
    aDetail = `ROE ${roe.toFixed(1)}% — dưới 17%`;
  } else if (roe != null) {
    aScore = 35;
    aDetail = `ROE ${roe.toFixed(1)}%`;
  }
  if (roe != null && roe >= 17 && annualG != null && annualG >= 20) {
    aScore = Math.min(100, aScore + 8);
    aPass = true;
  }

  // —— N ——
  let nScore = 35;
  let nPass = false;
  let nDetail = "Chưa đủ nến để đo đỉnh 52W";
  if (fromHigh != null) {
    if (fromHigh >= -3) {
      nScore = 92;
      nPass = true;
      nDetail = `Gần/tại đỉnh 52W (${fromHigh.toFixed(1)}%)`;
    } else if (fromHigh >= -10) {
      nScore = 78;
      nPass = true;
      nDetail = `Trong 10% đỉnh 52W (${fromHigh.toFixed(1)}%)`;
    } else if (fromHigh >= -20) {
      nScore = 55;
      nDetail = `Cách đỉnh ${Math.abs(fromHigh).toFixed(0)}%`;
    } else {
      nScore = 28;
      nDetail = `Xa đỉnh ${Math.abs(fromHigh).toFixed(0)}%`;
      flags.push("N: giá xa đỉnh 52 tuần");
    }
  }

  // —— S ——
  let sScore = 40;
  let sPass = false;
  let sDetail = "Volume trung tính";
  if (vr != null) {
    if (vr >= 1.8) {
      sScore = 90;
      sPass = true;
      sDetail = `KL 5phiên / TB50 = ${vr.toFixed(2)}x`;
    } else if (vr >= 1.2) {
      sScore = 72;
      sPass = true;
      sDetail = `KL tương đối ${vr.toFixed(2)}x`;
    } else if (vr >= 0.8) {
      sScore = 50;
      sDetail = `KL ${vr.toFixed(2)}x — bình thường`;
    } else {
      sScore = 30;
      sDetail = `KL yếu ${vr.toFixed(2)}x`;
    }
  }
  // Float vừa: 50Tr–500Tr CP — điểm cộng nhẹ
  if (shares != null && shares > 0) {
    const mil = shares / 1e6;
    if (mil >= 20 && mil <= 800) {
      sScore = Math.min(100, sScore + 6);
      sDetail += ` · ${mil.toFixed(0)}Tr CP`;
      if (!sPass && vr != null && vr >= 1.0) sPass = true;
    } else if (mil > 1500) {
      sDetail += ` · float lớn ${mil.toFixed(0)}Tr`;
      sScore = Math.max(25, sScore - 5);
    }
  }

  // —— L ——
  let lScore = 35;
  let lPass = false;
  let lDetail = "Chưa xếp hạng RS";
  if (rsRank != null) {
    if (rsRank >= 80) {
      lScore = 95;
      lPass = true;
      lDetail = `RS rank ${rsRank.toFixed(0)} (leader)`;
    } else if (rsRank >= 70) {
      lScore = 75;
      lPass = true;
      lDetail = `RS rank ${rsRank.toFixed(0)}`;
    } else if (rsRank >= 50) {
      lScore = 50;
      lDetail = `RS rank ${rsRank.toFixed(0)} — mid`;
    } else {
      lScore = 25;
      lDetail = `RS rank ${rsRank.toFixed(0)} — laggard`;
      flags.push("L: yếu hơn đa số rổ");
    }
  } else {
    const r6 = retPct(input.bars, 126);
    if (r6 != null) {
      if (r6 >= 25) {
        lScore = 80;
        lPass = true;
        lDetail = `6M +${r6.toFixed(0)}% (proxy RS)`;
      } else if (r6 >= 10) {
        lScore = 60;
        lDetail = `6M +${r6.toFixed(0)}%`;
      } else if (r6 >= 0) {
        lScore = 45;
        lDetail = `6M +${r6.toFixed(0)}%`;
      } else {
        lScore = 25;
        lDetail = `6M ${r6.toFixed(0)}%`;
      }
    }
  }

  // —— I — ưu tiên 5 phiên ——
  let iScore = 45;
  let iPass = false;
  let iDetail = "Chưa có dòng tiền NN";
  const nn = foreignNet5d != null ? foreignNet5d : foreignNet;
  if (nn != null) {
    const label = foreignNet5d != null ? "5phiên" : "1phiên";
    if (nn > 0) {
      iScore = nn > 15e9 ? 90 : nn > 5e9 ? 82 : 70;
      iPass = true;
      iDetail = `NN ròng mua (${label}) ~${(nn / 1e9).toFixed(1)} tỷ`;
    } else if (nn < 0) {
      iScore = nn < -15e9 ? 22 : nn < -5e9 ? 32 : 42;
      iDetail = `NN ròng bán (${label}) ~${(Math.abs(nn) / 1e9).toFixed(1)} tỷ`;
      if (nn < -10e9) flags.push("I: NN bán mạnh");
    } else {
      iScore = 50;
      iDetail = "NN cân bằng";
    }
  }

  // —— M ——
  let mScore = 50;
  let mPass = input.marketBullish !== false;
  let mDetail = input.marketDetail ?? (
    input.marketBullish === true
      ? "Thị trường nghiêng tăng"
      : input.marketBullish === false
        ? "Thị trường yếu / điều chỉnh"
        : "Chưa xác định chiều thị trường"
  );
  if (input.marketBullish === true) {
    mScore = 85;
    mPass = true;
  } else if (input.marketBullish === false) {
    mScore = 30;
    mPass = false;
    flags.push("M: thị trường không thuận");
  }

  const letters: CanslimLetterScore[] = [
    { letter: "C", pass: cPass, score: cScore, detail: cDetail, value: epsYoy },
    { letter: "A", pass: aPass, score: aScore, detail: aDetail, value: annualG ?? roe },
    { letter: "N", pass: nPass, score: nScore, detail: nDetail, value: fromHigh },
    { letter: "S", pass: sPass, score: sScore, detail: sDetail, value: vr },
    { letter: "L", pass: lPass, score: lScore, detail: lDetail, value: rsRank },
    { letter: "I", pass: iPass, score: iScore, detail: iDetail, value: nn },
    { letter: "M", pass: mPass, score: mScore, detail: mDetail, value: null },
  ];

  const passCount = letters.filter((l) => l.pass).length;
  const weights: Record<CanslimLetter, number> = { C: 1.4, A: 1.2, N: 1.1, S: 0.9, L: 1.3, I: 0.8, M: 1.0 };
  let wSum = 0;
  let sSum = 0;
  for (const l of letters) {
    wSum += weights[l.letter];
    sSum += l.score * weights[l.letter];
  }
  const score = Math.round(sSum / wSum);
  const grade: CanslimSnapshot["grade"] =
    score >= 80 && passCount >= 5 ? "A" : score >= 68 && passCount >= 4 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const gradeVi =
    grade === "A"
      ? "Mạnh — đủ nhiều tiêu chí CANSLIM"
      : grade === "B"
        ? "Khá — đáng theo dõi"
        : grade === "C"
          ? "Trung bình"
          : grade === "D"
            ? "Yếu"
            : "Không đủ điều kiện";

  if (!input.growth) notes.push("Thiếu growth BCTC — C yếu");
  if (input.bars.length < 60) notes.push("Ít nến — N/S/L kém tin cậy");
  if (input.ratiosEps != null) notes.push(`EPS ratios: ${input.ratiosEps}`);

  return {
    letters,
    passCount,
    score,
    grade,
    gradeVi,
    flags: flags.slice(0, 4),
    metrics: {
      epsYoyPct: epsYoy,
      revenueYoyPct: revYoy,
      epsQoqPct: epsQoq,
      roePct: roe,
      annualGrowthPct: annualG,
      pctFromHigh: fromHigh,
      rsRank,
      volRatio: vr,
      foreignNet,
      foreignNet5d,
      sharesOutstanding: shares,
    },
    dataCoverage: {
      hasGrowth: Boolean(input.growth && (input.growth.yoy.length || input.growth.qoq.length)),
      hasHealth: Boolean(input.health && input.health.coverage > 0),
      hasBars: input.bars.length >= 40,
      hasForeign: foreignNet != null || foreignNet5d != null,
      hasRatios: input.ratiosRoePct != null || input.ratiosEps != null,
      barsCount: input.bars.length,
    },
    notes: notes.slice(0, 4),
  };
}

export function canslimLetterLabel(letter: CanslimLetter): string {
  return LETTER_VI[letter];
}

export { retPct };

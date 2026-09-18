import type { OhlcvBar } from "../types";
import type { GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "./fundamental";

/**
 * CAN SLIM heuristic (William O'Neil) — nghiên cứu, không phải tín hiệu mua bán.
 * Đã thích nghi VN: dùng BCTC (EPS/LN/DT/ROE), OHLCV (RS, new high, volume),
 * dòng tiền ngoại làm proxy Institutional; M = chiều thị trường VNINDEX.
 */

export type CanslimLetter = "C" | "A" | "N" | "S" | "L" | "I" | "M";

export interface CanslimLetterScore {
  letter: CanslimLetter;
  pass: boolean;
  score: number; // 0–100
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
    roePct: number | null;
    annualGrowthPct: number | null;
    pctFromHigh: number | null;
    rsRank: number | null;
    volRatio: number | null;
    foreignNet: number | null;
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

function growthOf(g: GrowthSnapshot | null | undefined, metric: string, kind: "yoy" | "qoq" = "yoy"): number | null {
  if (!g) return null;
  const cell = (kind === "yoy" ? g.yoy : g.qoq).find((c) => c.metric === metric);
  return cell?.changePct != null && Number.isFinite(cell.changePct) ? cell.changePct : null;
}

/** CAGR gần đúng từ chuỗi lợi nhuận năm (nếu có). */
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
  // fallback: so sánh 2 kỳ năm gần nhất trong periods
  const annualish = periods
    .filter((p) => p.metrics.netIncome != null && (p.periodType === "year" || p.quarter == null))
    .slice(0, 6);
  if (annualish.length >= 2) {
    const a = annualish[1]!.metrics.netIncome!;
    const b = annualish[0]!.metrics.netIncome!;
    if (a > 0) return ((b - a) / Math.abs(a)) * 100;
  }
  return null;
}

function pctFromHigh(bars: OhlcvBar[]): number | null {
  if (bars.length < 20) return null;
  const slice = bars.slice(-252);
  const hi = Math.max(...slice.map((b) => b.high));
  const last = slice[slice.length - 1]!.close;
  if (hi <= 0) return null;
  return ((last - hi) / hi) * 100; // 0 = at high, negative = below
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
  foreignNetVal?: number | null;
  marketBullish?: boolean | null;
  /** percentile 0–100 trong universe đã xếp sẵn */
  rsRank?: number | null;
}): CanslimSnapshot {
  const notes: string[] = [];
  const flags: string[] = [];

  const epsYoy =
    growthOf(input.growth, "netIncome", "yoy") ??
    growthOf(input.growth, "netIncomeParent", "yoy") ??
    null;
  const revYoy = growthOf(input.growth, "revenue", "yoy") ?? growthOf(input.growth, "netRevenue", "yoy");
  const roe = input.health?.groups.profitability.roe != null ? input.health.groups.profitability.roe * 100 : null;
  const annualG = annualNiCagr(input.periods ?? null);
  const fromHigh = pctFromHigh(input.bars);
  const vr = volRatio(input.bars);
  const rsRank = input.rsRank ?? null;
  const foreignNet = input.foreignNetVal ?? null;

  // —— C: Current quarterly earnings ——
  let cScore = 30;
  let cPass = false;
  let cDetail = "Thiếu tăng trưởng LN quý YoY";
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
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% (ngưỡng mềm O'Neil)`;
    } else if (epsYoy >= 0) {
      cScore = 45;
      cDetail = `LN YoY +${epsYoy.toFixed(0)}% — dưới 18%`;
    } else {
      cScore = 20;
      cDetail = `LN YoY ${epsYoy.toFixed(0)}% — đang giảm`;
      flags.push("C: LN quý đang âm tăng trưởng");
    }
    if (revYoy != null && revYoy >= 20 && cPass) {
      cScore = Math.min(100, cScore + 5);
      cDetail += ` · DT +${revYoy.toFixed(0)}%`;
    } else if (revYoy != null && revYoy < 5 && epsYoy != null && epsYoy > 25) {
      notes.push("LN tăng nhanh nhưng DT yếu — cần kiểm tra biên lợi / one-off");
      cScore = Math.max(40, cScore - 10);
    }
  }

  // —— A: Annual earnings / ROE ——
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

  // —— N: New high (price near 52w high) ——
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

  // —— S: Supply & Demand (volume) ——
  let sScore = 40;
  let sPass = false;
  let sDetail = "Volume trung tính";
  if (vr != null) {
    if (vr >= 1.8) {
      sScore = 90;
      sPass = true;
      sDetail = `KL 5phiên / TB50 = ${vr.toFixed(2)}x (cầu mạnh)`;
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

  // —— L: Leader (RS rank) ——
  let lScore = 35;
  let lPass = false;
  let lDetail = "Chưa xếp hạng RS";
  if (rsRank != null) {
    if (rsRank >= 80) {
      lScore = 95;
      lPass = true;
      lDetail = `RS rank ${rsRank.toFixed(0)} (≥80 — leader)`;
    } else if (rsRank >= 70) {
      lScore = 75;
      lPass = true;
      lDetail = `RS rank ${rsRank.toFixed(0)}`;
    } else if (rsRank >= 50) {
      lScore = 50;
      lDetail = `RS rank ${rsRank.toFixed(0)} — mid-pack`;
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

  // —— I: Institutional — proxy khối ngoại VN ——
  let iScore = 45;
  let iPass = false;
  let iDetail = "Chưa có dòng tiền NN";
  if (foreignNet != null) {
    if (foreignNet > 0) {
      iScore = foreignNet > 5e9 ? 88 : 72;
      iPass = true;
      iDetail = `NN ròng mua ~${(foreignNet / 1e9).toFixed(1)} tỷ`;
    } else if (foreignNet < 0) {
      iScore = foreignNet < -5e9 ? 25 : 40;
      iDetail = `NN ròng bán ~${(Math.abs(foreignNet) / 1e9).toFixed(1)} tỷ`;
      if (foreignNet < -10e9) flags.push("I: NN bán mạnh");
    } else {
      iScore = 50;
      iDetail = "NN cân bằng";
    }
  }

  // —— M: Market direction ——
  let mScore = 50;
  let mPass = input.marketBullish !== false;
  let mDetail =
    input.marketBullish === true
      ? "Thị trường nghiêng tăng (VNINDEX)"
      : input.marketBullish === false
        ? "Thị trường yếu / điều chỉnh"
        : "Chưa xác định chiều thị trường";
  if (input.marketBullish === true) {
    mScore = 85;
    mPass = true;
  } else if (input.marketBullish === false) {
    mScore = 30;
    mPass = false;
    flags.push("M: thị trường không thuận — CANSLIM khuyên giảm exposure");
  }

  const letters: CanslimLetterScore[] = [
    { letter: "C", pass: cPass, score: cScore, detail: cDetail, value: epsYoy },
    { letter: "A", pass: aPass, score: aScore, detail: aDetail, value: annualG ?? roe },
    { letter: "N", pass: nPass, score: nScore, detail: nDetail, value: fromHigh },
    { letter: "S", pass: sPass, score: sScore, detail: sDetail, value: vr },
    { letter: "L", pass: lPass, score: lScore, detail: lDetail, value: rsRank },
    { letter: "I", pass: iPass, score: iScore, detail: iDetail, value: foreignNet },
    { letter: "M", pass: mPass, score: mScore, detail: mDetail, value: null },
  ];

  const passCount = letters.filter((l) => l.pass).length;
  // Trọng số: C A L N nặng hơn S I M
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

  if (!input.growth) notes.push("Thiếu growth BCTC — C/A ớớc ước lượng");
  if (input.bars.length < 60) notes.push("Ít nến — N/S/L kém tin cậy");

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
      roePct: roe,
      annualGrowthPct: annualG,
      pctFromHigh: fromHigh,
      rsRank,
      volRatio: vr,
      foreignNet,
    },
    notes: notes.slice(0, 3),
  };
}

export function canslimLetterLabel(letter: CanslimLetter): string {
  return LETTER_VI[letter];
}

export { retPct };

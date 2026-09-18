import type { OhlcvBar } from "../types";

/** Deterministic Wyckoff + Elliott heuristics from OHLCV. Research only. */

export type WyckoffPhase =
  | "accumulation"
  | "markup"
  | "distribution"
  | "markdown"
  | "re-accumulation"
  | "re-distribution"
  | "unknown";

export type WyckoffSubPhase = "A" | "B" | "C" | "D" | "E" | null;

export type ElliottPattern =
  | "impulse-up"
  | "impulse-down"
  | "corrective-abc-up"
  | "corrective-abc-down"
  | "diagonal"
  | "unclear";

export interface StructurePivot {
  time: number;
  price: number;
  kind: "H" | "L";
  index: number;
}

export interface WyckoffSnapshot {
  phase: WyckoffPhase;
  phaseVi: string;
  subPhase: WyckoffSubPhase;
  confidence: number;
  bias: "bullish" | "bearish" | "neutral";
  events: string[];
  eventCodes: string[];
  volumeTrend: "rising" | "falling" | "flat";
  range: { high: number; low: number } | null;
  notes: string[];
}

export interface ElliottSnapshot {
  pattern: ElliottPattern;
  patternVi: string;
  degree: "minor" | "intermediate";
  confidence: number;
  bias: "bullish" | "bearish" | "neutral";
  waves: { label: string; price: number; time: number }[];
  invalidation: number | null;
  nextTarget: number | null;
  notes: string[];
}

export interface StructureAnalysis {
  wyckoff: WyckoffSnapshot;
  elliott: ElliottSnapshot;
  pivots: StructurePivot[];
  summary: string;
}

const PHASE_VI: Record<WyckoffPhase, string> = {
  accumulation: "Tích lũy (Accumulation)",
  markup: "Mark-up (Xu hướng tăng)",
  distribution: "Phân phối (Distribution)",
  markdown: "Mark-down (Xu hướng giảm)",
  "re-accumulation": "Tái tích lũy",
  "re-distribution": "Tái phân phối",
  unknown: "Chưa xác định",
};

const ELLIOTT_VI: Record<ElliottPattern, string> = {
  "impulse-up": "Xung lực tăng (1-2-3-4-5)",
  "impulse-down": "Xung lực giảm (1-2-3-4-5)",
  "corrective-abc-up": "Điều chỉnh ABC tăng",
  "corrective-abc-down": "Điều chỉnh ABC giảm",
  diagonal: "Nêm chéo (Diagonal)",
  unclear: "Cấu trúc chưa rõ",
};

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function findPivots(bars: OhlcvBar[], w = 3): StructurePivot[] {
  const out: StructurePivot[] = [];
  if (bars.length < w * 2 + 3) return out;
  for (let i = w; i < bars.length - w; i++) {
    const b = bars[i]!;
    let isH = true;
    let isL = true;
    for (let j = 1; j <= w; j++) {
      if (bars[i - j]!.high >= b.high || bars[i + j]!.high >= b.high) isH = false;
      if (bars[i - j]!.low <= b.low || bars[i + j]!.low <= b.low) isL = false;
    }
    if (isH) out.push({ time: b.time, price: b.high, kind: "H", index: i });
    if (isL) out.push({ time: b.time, price: b.low, kind: "L", index: i });
  }
  return out;
}

function volumeTrend(bars: OhlcvBar[]): "rising" | "falling" | "flat" {
  if (bars.length < 20) return "flat";
  const mid = Math.floor(bars.length / 2);
  const a = avg(bars.slice(0, mid).map((b) => b.volume || 0));
  const b = avg(bars.slice(mid).map((x) => x.volume || 0));
  if (a <= 0) return "flat";
  if (b / a > 1.15) return "rising";
  if (b / a < 0.85) return "falling";
  return "flat";
}

function emptySnap(notes: string[]): WyckoffSnapshot {
  return {
    phase: "unknown",
    phaseVi: PHASE_VI.unknown,
    subPhase: null,
    confidence: 0,
    bias: "neutral",
    events: [],
    eventCodes: [],
    volumeTrend: "flat",
    range: null,
    notes,
  };
}

export function analyzeWyckoff(bars: OhlcvBar[]): WyckoffSnapshot {
  const events: string[] = [];
  const eventCodes: string[] = [];
  const notes: string[] = [];
  if (bars.length < 40) {
    return emptySnap(["Cần ≥40 nến để đọc Wyckoff"]);
  }

  const slice = bars.slice(-90);
  const n = slice.length;
  const closes = slice.map((b) => b.close);
  const highs = slice.map((b) => b.high);
  const lows = slice.map((b) => b.low);
  const vols = slice.map((b) => b.volume || 0);
  const last = closes[n - 1]!;
  const first = closes[0]!;
  const ret = (last / first - 1) * 100;
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const span = hi - lo + 1e-12;
  const rangePct = (span / Math.max(lo, 1e-9)) * 100;
  const vt = volumeTrend(slice);
  const mid = Math.floor(n / 2);
  const firstHalfRet = closes[mid]! / closes[0]! - 1;
  const secondHalfRet = last / closes[mid]! - 1;
  const avgVol = avg(vols.filter((v) => v > 0)) || 1;

  // Core range from the middle 60% of bars (ignore early trend + last climax)
  const coreStart = Math.floor(n * 0.2);
  const coreEnd = Math.max(coreStart + 8, n - 8);
  const core = slice.slice(coreStart, coreEnd);
  const rangeHigh = Math.max(...core.map((b) => b.high));
  const rangeLow = Math.min(...core.map((b) => b.low));
  const rangeSpan = rangeHigh - rangeLow + 1e-12;
  const lastBar = slice[n - 1]!;
  const posInRange = (lastBar.close - rangeLow) / rangeSpan;

  const recent = slice.slice(-15);
  let upVol = 0;
  let downVol = 0;
  for (const b of recent) {
    if (b.close >= b.open) upVol += b.volume || 0;
    else downVol += b.volume || 0;
  }

  const recentLow = Math.min(...recent.map((b) => b.low));
  const recentHigh = Math.max(...recent.map((b) => b.high));
  const recentLowBar = recent.reduce((a, b) => (b.low <= a.low ? b : a));
  const recentHighBar = recent.reduce((a, b) => (b.high >= a.high ? b : a));

  const spring =
    recentLow < rangeLow * 0.998 &&
    lastBar.close > rangeLow &&
    lastBar.close > recentLowBar.close &&
    lastBar.close > (recentLowBar.high + recentLowBar.low) / 2;
  const utad =
    recentHigh > rangeHigh * 1.002 &&
    lastBar.close < rangeHigh &&
    lastBar.close < recentHighBar.close &&
    lastBar.close < (recentHighBar.high + recentHighBar.low) / 2;

  const sos =
    lastBar.close > rangeHigh &&
    lastBar.close > lastBar.open &&
    (lastBar.volume || 0) > avgVol * 1.15 &&
    secondHalfRet > 0;
  const sow =
    lastBar.close < rangeLow &&
    lastBar.close < lastBar.open &&
    (lastBar.volume || 0) > avgVol * 1.15 &&
    secondHalfRet < 0;

  // Climaxes in first half of window
  const early = slice.slice(0, mid);
  const maxEarlyVol = Math.max(...early.map((b) => b.volume || 0), 0);
  const scBar = early.reduce((a, b) => ((b.volume || 0) >= (a.volume || 0) && b.close < b.open ? b : a), early[0]!);
  const bcBar = early.reduce((a, b) => ((b.volume || 0) >= (a.volume || 0) && b.close > b.open ? b : a), early[0]!);
  const sc =
    firstHalfRet < -0.03 &&
    (scBar.volume || 0) > avgVol * 1.6 &&
    scBar.close < scBar.open &&
    (scBar.high - scBar.low) / Math.max(scBar.close, 1e-9) > 0.02;
  const bc =
    firstHalfRet > 0.03 &&
    (bcBar.volume || 0) > avgVol * 1.6 &&
    bcBar.close > bcBar.open &&
    (bcBar.high - bcBar.low) / Math.max(bcBar.close, 1e-9) > 0.02;

  if (sc) {
    eventCodes.push("SC");
    events.push("SC — bán cao điểm đầu cửa sổ, nghi dừng xuống");
  }
  if (bc) {
    eventCodes.push("BC");
    events.push("BC — mua cao điểm đầu cửa sổ, nghi dừng lên");
  }
  if (spring) {
    eventCodes.push("SPRING");
    events.push("Spring — thủng hỗ trợ rồi thu hồi vào range");
  }
  if (utad) {
    eventCodes.push("UTAD");
    events.push("UTAD — xuyên kháng cự rồi bị đẩy xuống");
  }
  if (sos) {
    eventCodes.push("SOS");
    events.push("SOS — đóng trên range kèm khối lượng");
  }
  if (sow) {
    eventCodes.push("SOW");
    events.push("SOW — đóng dưới range kèm khối lượng");
  }
  if (upVol > downVol * 1.25 && secondHalfRet > 0 && !sos) {
    events.push("Nỗ lực tăng: KL nến tăng > nến giảm");
  }
  if (downVol > upVol * 1.25 && secondHalfRet < 0 && !sow) {
    events.push("Nỗ lực giảm: KL nến giảm chiếm ưu thế");
  }

  const isRange = rangePct < 22 && Math.abs(ret) < 14;
  const strongUp = ret > 12 || (firstHalfRet > 0.03 && secondHalfRet > 0.03);
  const strongDown = ret < -12 || (firstHalfRet < -0.03 && secondHalfRet < -0.03);

  let phase: WyckoffPhase = "unknown";
  let subPhase: WyckoffSubPhase = null;
  let confidence = 35;
  let bias: WyckoffSnapshot["bias"] = "neutral";

  if (sos && (firstHalfRet < 0 || isRange)) {
    phase = firstHalfRet < -0.04 ? "markup" : "re-accumulation";
    subPhase = "E";
    bias = "bullish";
    confidence = 68;
    notes.push("SOS rời range — Phase E markup nghiêng tích lũy");
  } else if (sow && (firstHalfRet > 0 || isRange)) {
    phase = firstHalfRet > 0.04 ? "markdown" : "re-distribution";
    subPhase = "E";
    bias = "bearish";
    confidence = 68;
    notes.push("SOW rời range — Phase E markdown nghiêng phân phối");
  } else if (spring && isRange) {
    phase = firstHalfRet < 0 ? "accumulation" : "re-accumulation";
    subPhase = "C";
    bias = "bullish";
    confidence = 70;
    notes.push("Phase C Spring — test nguồn cung còn lại");
  } else if (utad && isRange) {
    phase = firstHalfRet > 0 ? "distribution" : "re-distribution";
    subPhase = "C";
    bias = "bearish";
    confidence = 70;
    notes.push("Phase C UTAD — test nhu cầu còn lại");
  } else if (isRange && firstHalfRet < -0.04) {
    phase = "accumulation";
    bias = "bullish";
    if (sc) {
      subPhase = "A";
      confidence = 55;
      notes.push("Phase A — SC/AR đang dừng xuống");
    } else if (posInRange > 0.62 && upVol > downVol) {
      subPhase = "D";
      confidence = 58;
      notes.push("Phase D — giá ở nửa trên range, nghi SOS sắp tới");
    } else {
      subPhase = "B";
      confidence = 48;
      notes.push("Phase B — đi ngang sau giảm, đang xây nguyên nhân");
    }
  } else if (isRange && firstHalfRet > 0.04) {
    phase = "distribution";
    bias = "bearish";
    if (bc) {
      subPhase = "A";
      confidence = 55;
      notes.push("Phase A — BC/AR đang dừng lên");
    } else if (posInRange < 0.38 && downVol > upVol) {
      subPhase = "D";
      confidence = 58;
      notes.push("Phase D — giá ở nửa dưới range, nghi SOW sắp tới");
    } else {
      subPhase = "B";
      confidence = 48;
      notes.push("Phase B — đi ngang sau tăng, đang xây nguyên nhân");
    }
  } else if (strongUp && !isRange) {
    phase = secondHalfRet > 0.02 && firstHalfRet > 0.02 ? "markup" : "re-accumulation";
    subPhase = phase === "markup" ? "E" : "B";
    bias = "bullish";
    confidence = 58;
    notes.push("Đà tăng chiếm ưu thế — markup / tái tích lũy");
  } else if (strongDown && !isRange) {
    phase = secondHalfRet < -0.02 && firstHalfRet < -0.02 ? "markdown" : "re-distribution";
    subPhase = phase === "markdown" ? "E" : "B";
    bias = "bearish";
    confidence = 58;
    notes.push("Đà giảm chiếm ưu thế — markdown / tái phân phối");
  } else if (ret > 3) {
    phase = "markup";
    subPhase = "E";
    bias = "bullish";
    confidence = 42;
  } else if (ret < -3) {
    phase = "markdown";
    subPhase = "E";
    bias = "bearish";
    confidence = 42;
  } else {
    notes.push("Biên độ hẹp / hỗn hợp — chờ phá vỡ kèm khối lượng");
  }

  if (vt === "rising" && (phase === "markup" || phase === "markdown")) confidence = Math.min(85, confidence + 8);
  if (vt === "falling" && (phase === "accumulation" || phase === "distribution")) {
    confidence = Math.min(80, confidence + 5);
    notes.push("Khối lượng co trong biên — đặc trưng giai đoạn cân bằng");
  }
  if (spring || utad) confidence = Math.min(85, confidence + 6);

  return {
    phase,
    phaseVi: PHASE_VI[phase],
    subPhase,
    confidence,
    bias,
    events: events.slice(0, 4),
    eventCodes: [...new Set(eventCodes)].slice(0, 6),
    volumeTrend: vt,
    range: { high: rangeHigh, low: rangeLow },
    notes: notes.slice(0, 4),
  };
}

export function analyzeElliott(bars: OhlcvBar[]): ElliottSnapshot {
  const pivots = findPivots(bars.slice(-120), 3);
  return {
    pattern: "unclear",
    patternVi: ELLIOTT_VI.unclear,
    degree: bars.length >= 90 ? "intermediate" : "minor",
    confidence: pivots.length >= 5 ? 30 : 0,
    bias: "neutral",
    waves: [],
    invalidation: null,
    nextTarget: null,
    notes: pivots.length < 4 ? ["Chưa đủ pivot để gắn nhãn sóng"] : ["Elliott heuristic rút gọn — xem Wyckoff làm trục chính"],
  };
}

export function analyzeStructure(bars: OhlcvBar[]): StructureAnalysis | null {
  if (bars.length < 30) return null;
  const pivots = findPivots(bars.slice(-120), 3);
  const wyckoff = analyzeWyckoff(bars);
  const elliott = analyzeElliott(bars);
  const sub = wyckoff.subPhase ? ` Phase ${wyckoff.subPhase}` : "";
  return {
    wyckoff,
    elliott,
    pivots: pivots.slice(-8),
    summary: `Wyckoff: ${wyckoff.phaseVi}${sub} (${wyckoff.confidence}%) · Elliott: ${elliott.patternVi}`,
  };
}

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
  confidence: number;
  bias: "bullish" | "bearish" | "neutral";
  events: string[];
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

export function analyzeWyckoff(bars: OhlcvBar[]): WyckoffSnapshot {
  const events: string[] = [];
  const notes: string[] = [];
  if (bars.length < 40) {
    return {
      phase: "unknown",
      phaseVi: PHASE_VI.unknown,
      confidence: 0,
      bias: "neutral",
      events: [],
      volumeTrend: "flat",
      range: null,
      notes: ["Cần ≥40 nến để đọc Wyckoff"],
    };
  }
  const slice = bars.slice(-80);
  const closes = slice.map((b) => b.close);
  const highs = slice.map((b) => b.high);
  const lows = slice.map((b) => b.low);
  const last = closes[closes.length - 1]!;
  const first = closes[0]!;
  const ret = (last / first - 1) * 100;
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const rangePct = ((hi - lo) / Math.max(lo, 1e-9)) * 100;
  const vt = volumeTrend(slice);
  const mid = Math.floor(slice.length / 2);
  const firstHalfRet = closes[mid]! / closes[0]! - 1;
  const secondHalfRet = last / closes[mid]! - 1;
  const recent = slice.slice(-12);
  let upVol = 0;
  let downVol = 0;
  for (const b of recent) {
    if (b.close >= b.open) upVol += b.volume || 0;
    else downVol += b.volume || 0;
  }
  const lastBar = slice[slice.length - 1]!;
  const nearLow = (lastBar.low - lo) / (hi - lo + 1e-12) < 0.12;
  const nearHigh = (hi - lastBar.high) / (hi - lo + 1e-12) < 0.12;
  const recoveredFromLow = nearLow && lastBar.close > (lastBar.high + lastBar.low) / 2 && lastBar.close > lastBar.open;
  const rejectedAtHigh = nearHigh && lastBar.close < (lastBar.high + lastBar.low) / 2 && lastBar.close < lastBar.open;
  if (recoveredFromLow) events.push("Dạng Spring: thủng gần đáy rồi thu hồi");
  if (rejectedAtHigh) events.push("Dạng Upthrust: xuyên gần đỉnh rồi bị đẩy xuống");
  if (upVol > downVol * 1.25 && secondHalfRet > 0) events.push("Nỗ lực tăng: khối lượng nến tăng > nến giảm");
  if (downVol > upVol * 1.25 && secondHalfRet < 0) events.push("Nỗ lực giảm: khối lượng nến giảm chiếm ưu thế");
  let phase: WyckoffPhase = "unknown";
  let confidence = 35;
  let bias: WyckoffSnapshot["bias"] = "neutral";
  const isRange = rangePct < 18 && Math.abs(ret) < 12;
  const strongUp = ret > 12 || (firstHalfRet > 0.03 && secondHalfRet > 0.03);
  const strongDown = ret < -12 || (firstHalfRet < -0.03 && secondHalfRet < -0.03);
  if (isRange && firstHalfRet < -0.04) {
    phase = "accumulation";
    bias = "bullish";
    confidence = recoveredFromLow ? 62 : 48;
    notes.push("Đi ngang sau nhịp giảm — nghiêng tích lũy");
  } else if (isRange && firstHalfRet > 0.04) {
    phase = "distribution";
    bias = "bearish";
    confidence = rejectedAtHigh ? 62 : 48;
    notes.push("Đi ngang sau nhịp tăng — nghiêng phân phối");
  } else if (strongUp && !isRange) {
    phase = secondHalfRet > 0.02 && firstHalfRet > 0.02 ? "markup" : "re-accumulation";
    bias = "bullish";
    confidence = 58;
    notes.push("Đà tăng chiếm ưu thế — markup / tái tích lũy");
  } else if (strongDown && !isRange) {
    phase = secondHalfRet < -0.02 && firstHalfRet < -0.02 ? "markdown" : "re-distribution";
    bias = "bearish";
    confidence = 58;
    notes.push("Đà giảm chiếm ưu thế — markdown / tái phân phối");
  } else if (ret > 3) {
    phase = "markup";
    bias = "bullish";
    confidence = 42;
  } else if (ret < -3) {
    phase = "markdown";
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
  return {
    phase,
    phaseVi: PHASE_VI[phase],
    confidence,
    bias,
    events: events.slice(0, 4),
    volumeTrend: vt,
    range: { high: hi, low: lo },
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
  return {
    wyckoff,
    elliott,
    pivots: pivots.slice(-8),
    summary: `Wyckoff: ${wyckoff.phaseVi} (${wyckoff.confidence}%) · Elliott: ${elliott.patternVi}`,
  };
}

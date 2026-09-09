import type { OhlcvBar } from "../types";

/**
 * Deterministic Wyckoff + Elliott heuristics from OHLCV.
 * Research / education only — not a trading signal.
 */

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
  diagonal: "Diagonal / nêm",
  unclear: "Cấu trúc chưa rõ",
};

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Swing pivots: local extremum over ±w bars. */
export function findPivots(bars: OhlcvBar[], w = 3): StructurePivot[] {
  const out: StructurePivot[] = [];
  if (bars.length < w * 2 + 3) return out;
  for (let i = w; i < bars.length - w; i++) {
    const b = bars[i];
    let isH = true;
    let isL = true;
    for (let j = 1; j <= w; j++) {
      if (bars[i - j].high >= b.high || bars[i + j].high >= b.high) isH = false;
      if (bars[i - j].low <= b.low || bars[i + j].low <= b.low) isL = false;
    }
    if (isH) out.push({ time: b.time, price: b.high, kind: "H", index: i });
    if (isL) out.push({ time: b.time, price: b.low, kind: "L", index: i });
  }
  // Keep chronological, drop near-duplicates
  out.sort((a, b) => a.index - b.index);
  const cleaned: StructurePivot[] = [];
  for (const p of out) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.kind === p.kind && p.index - prev.index < w) {
      if (p.kind === "H" && p.price > prev.price) cleaned[cleaned.length - 1] = p;
      if (p.kind === "L" && p.price < prev.price) cleaned[cleaned.length - 1] = p;
      continue;
    }
    if (prev && prev.kind === p.kind) continue;
    cleaned.push(p);
  }
  return cleaned;
}

function volumeTrend(bars: OhlcvBar[]): "rising" | "falling" | "flat" {
  if (bars.length < 20) return "flat";
  const mid = Math.floor(bars.length / 2);
  const a = avg(bars.slice(0, mid).map((b) => b.volume || 0));
  const b = avg(bars.slice(mid).map((x) => x.volume || 0));
  if (a <= 0) return "flat";
  const r = b / a;
  if (r > 1.15) return "rising";
  if (r < 0.85) return "falling";
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
  const last = closes[closes.length - 1];
  const first = closes[0];
  const ret = (last / first - 1) * 100;
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const rangePct = ((hi - lo) / lo) * 100;
  const vt = volumeTrend(slice);

  // Prior trend from first half vs second half
  const mid = Math.floor(slice.length / 2);
  const firstHalfRet = closes[mid] / closes[0] - 1;
  const secondHalfRet = last / closes[mid] - 1;

  // Effort vs result: up-bar volume vs down-bar volume recently
  const recent = slice.slice(-12);
  let upVol = 0;
  let downVol = 0;
  let upBars = 0;
  let downBars = 0;
  for (const b of recent) {
    if (b.close >= b.open) {
      upVol += b.volume || 0;
      upBars++;
    } else {
      downVol += b.volume || 0;
      downBars++;
    }
  }

  // Spring / upthrust heuristics near range extremes
  const lastBar = slice[slice.length - 1];
  const nearLow = (lastBar.low - lo) / (hi - lo + 1e-12) < 0.12;
  const nearHigh = (hi - lastBar.high) / (hi - lo + 1e-12) < 0.12;
  const recoveredFromLow = nearLow && lastBar.close > (lastBar.high + lastBar.low) / 2 && lastBar.close > lastBar.open;
  const rejectedAtHigh = nearHigh && lastBar.close < (lastBar.high + lastBar.low) / 2 && lastBar.close < lastBar.open;

  if (recoveredFromLow) events.push("Spring-like: thủng gần đáy rồi thu hồi");
  if (rejectedAtHigh) events.push("Upthrust-like: xuyên gần đỉnh rồi bị đẩy xuống");
  if (upVol > downVol * 1.25 && secondHalfRet > 0) events.push("Effort tăng: volume phiên tăng > volume phiên giảm");
  if (downVol > upVol * 1.25 && secondHalfRet < 0) events.push("Effort giảm: volume phiên giảm chiếm ưu thế");

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
    notes.push("Sideway sau nhịp giảm — nghiêng tích lũy");
  } else if (isRange && firstHalfRet > 0.04) {
    phase = "distribution";
    bias = "bearish";
    confidence = rejectedAtHigh ? 62 : 48;
    notes.push("Sideway sau nhịp tăng — nghiêng phân phối");
  } else if (strongUp && !isRange) {
    phase = secondHalfRet > 0.02 && firstHalfRet > 0.02 ? "markup" : "re-accumulation";
    bias = "bullish";
    confidence = 58;
    notes.push("Chuỗi HH/HL hoặc đà tăng chiếm ưu thế");
  } else if (strongDown && !isRange) {
    phase = secondHalfRet < -0.02 && firstHalfRet < -0.02 ? "markdown" : "re-distribution";
    bias = "bearish";
    confidence = 58;
    notes.push("Chuỗi LH/LL hoặc đà giảm chiếm ưu thế");
  } else if (ret > 3) {
    phase = "markup";
    bias = "bullish";
    confidence = 42;
  } else if (ret < -3) {
    phase = "markdown";
    bias = "bearish";
    confidence = 42;
  } else {
    phase = "unknown";
    notes.push("Biên độ hẹp / hỗn hợp — chờ breakout volume");
  }

  if (vt === "rising" && phase === "markup") confidence = Math.min(85, confidence + 8);
  if (vt === "rising" && phase === "markdown") confidence = Math.min(85, confidence + 8);
  if (vt === "falling" && (phase === "accumulation" || phase === "distribution")) {
    confidence = Math.min(80, confidence + 5);
    notes.push("Volume co lại trong range — đặc trưng giai đoạn cân bằng");
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
  const notes: string[] = [];
  const pivots = findPivots(bars.slice(-120), bars.length > 100 ? 3 : 2);
  if (pivots.length < 4) {
    return {
      pattern: "unclear",
      patternVi: ELLIOTT_VI.unclear,
      degree: "intermediate",
      confidence: 0,
      bias: "neutral",
      waves: [],
      invalidation: null,
      nextTarget: null,
      notes: ["Chưa đủ pivot để gắn nhãn sóng"],
    };
  }

  // Take last up to 6 alternating pivots
  const seq = pivots.slice(-6);
  const waves = seq.map((p, i) => ({
    label: p.kind === "H" ? `P${i + 1}H` : `P${i + 1}L`,
    price: p.price,
    time: p.time,
  }));

  // Classify last 5 swings if possible (L-H-L-H-L or H-L-H-L-H)
  const last5 = pivots.slice(-5);
  let pattern: ElliottPattern = "unclear";
  let confidence = 30;
  let bias: ElliottSnapshot["bias"] = "neutral";
  let invalidation: number | null = null;
  let nextTarget: number | null = null;

  if (last5.length === 5) {
    const [a, b, c, d, e] = last5;
    const upImpulse =
      a.kind === "L" &&
      b.kind === "H" &&
      c.kind === "L" &&
      d.kind === "H" &&
      e.kind === "L" &&
      b.price > a.price &&
      d.price > b.price &&
      c.price > a.price &&
      e.price > c.price;

    const downImpulse =
      a.kind === "H" &&
      b.kind === "L" &&
      c.kind === "H" &&
      d.kind === "L" &&
      e.kind === "H" &&
      b.price < a.price &&
      d.price < b.price &&
      c.price < a.price &&
      e.price < c.price;

    // 3-wave ABC: L-H-L or H-L-H on last 3
    const last3 = pivots.slice(-3);
    const abcUp =
      last3.length === 3 &&
      last3[0].kind === "L" &&
      last3[1].kind === "H" &&
      last3[2].kind === "L" &&
      last3[1].price > last3[0].price &&
      last3[2].price > last3[0].price &&
      last3[2].price < last3[1].price;

    const abcDown =
      last3.length === 3 &&
      last3[0].kind === "H" &&
      last3[1].kind === "L" &&
      last3[2].kind === "H" &&
      last3[1].price < last3[0].price &&
      last3[2].price < last3[0].price &&
      last3[2].price > last3[1].price;

    if (upImpulse) {
      pattern = "impulse-up";
      bias = "bullish";
      confidence = 58;
      // Label 1..5 conceptually on swings
      waves.length = 0;
      const labels = ["1", "2", "3", "4", "5"];
      // Map L H L H L → start of 1, end 1/start 2, end 2, end 3, end 4 — simplified
      last5.forEach((p, i) => waves.push({ label: labels[i] ?? `${i}`, price: p.price, time: p.time }));
      invalidation = c.price;
      const w3 = d.price - c.price;
      nextTarget = e.price + w3 * 0.618;
      notes.push("Cấu trúc HH/HL 5 điểm — nghiêng impulse tăng");
      notes.push("Vô hiệu nếu thủng đáy sóng 4 (ước lượng)");
    } else if (downImpulse) {
      pattern = "impulse-down";
      bias = "bearish";
      confidence = 58;
      waves.length = 0;
      last5.forEach((p, i) => waves.push({ label: `${i + 1}`, price: p.price, time: p.time }));
      invalidation = c.price;
      const w3 = c.price - d.price;
      nextTarget = e.price - w3 * 0.618;
      notes.push("Cấu trúc LH/LL 5 điểm — nghiêng impulse giảm");
    } else if (abcUp) {
      pattern = "corrective-abc-up";
      bias = "bullish";
      confidence = 48;
      waves.length = 0;
      last3.forEach((p, i) => waves.push({ label: ["A", "B", "C"][i], price: p.price, time: p.time }));
      invalidation = last3[0].price;
      nextTarget = last3[1].price + (last3[1].price - last3[2].price);
      notes.push("3 nhịp L-H-L — đọc như ABC điều chỉnh trong xu hướng tăng");
    } else if (abcDown) {
      pattern = "corrective-abc-down";
      bias = "bearish";
      confidence = 48;
      waves.length = 0;
      last3.forEach((p, i) => waves.push({ label: ["A", "B", "C"][i], price: p.price, time: p.time }));
      invalidation = last3[0].price;
      nextTarget = last3[1].price - (last3[2].price - last3[1].price);
      notes.push("3 nhịp H-L-H — đọc như ABC điều chỉnh trong xu hướng giảm");
    } else {
      // Overlapping swings → diagonal-ish
      const prices = last5.map((p) => p.price);
      const span = Math.max(...prices) - Math.min(...prices);
      const lastSpan = Math.abs(last5[4].price - last5[0].price);
      if (span > 0 && lastSpan / span < 0.55) {
        pattern = "diagonal";
        confidence = 40;
        notes.push("Biên độ co hẹp giữa các pivot — có thể diagonal/nêm");
      } else {
        notes.push("Pivot không khớp impulse/ABC chuẩn — giữ quan sát");
      }
    }
  } else {
    notes.push("Ít hơn 5 pivot gần nhất — độ tin cậy thấp");
  }

  return {
    pattern,
    patternVi: ELLIOTT_VI[pattern],
    degree: bars.length >= 90 ? "intermediate" : "minor",
    confidence,
    bias,
    waves: waves.slice(0, 6),
    invalidation,
    nextTarget,
    notes: notes.slice(0, 4),
  };
}

export function analyzeStructure(bars: OhlcvBar[]): StructureAnalysis | null {
  if (bars.length < 30) return null;
  const pivots = findPivots(bars.slice(-120), 3);
  const wyckoff = analyzeWyckoff(bars);
  const elliott = analyzeElliott(bars);

  const parts = [
    `Wyckoff: ${wyckoff.phaseVi} (${wyckoff.confidence}%)`,
    `Elliott: ${elliott.patternVi} (${elliott.confidence}%)`,
  ];
  if (wyckoff.events[0]) parts.push(wyckoff.events[0]);
  if (elliott.notes[0]) parts.push(elliott.notes[0]);

  return {
    wyckoff,
    elliott,
    pivots: pivots.slice(-8),
    summary: parts.join(" · "),
  };
}

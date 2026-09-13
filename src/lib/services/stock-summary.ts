/**
 * ORCA Agent — VN stock answer renderer (pure, framework-free).
 *
 * Turns the structured `StockAnalysisContract` (built by intelligence.ts from
 * real provider + engine output) into the full narrative the analyst persona is
 * expected to give: current price & liquidity, technicals (RSI / MACD / MA),
 * candle patterns, financial health, valuation, risk, and a rule-based
 * conclusion with an explicit MUA / BÁN / TRUNG LẬP call and confidence %.
 *
 * Every number is read off the contract; nothing is invented. Missing inputs
 * degrade to "không khả dụng" lines instead of fabricated figures. Tested in
 * src/lib/services/__tests__/stock-summary.test.ts.
 */

export interface SumPattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: string;
  description: string;
}

/** Minimal structural view of intelligence.StockAnalysisContract (server types stay there). */
export interface StockContract {
  asset?: { symbol?: string };
  market_data?: {
    price?: number | null;
    change_percent?: number | null;
    high?: number | null;
    low?: number | null;
    volume?: number | null;
    value?: number | null;
    avg_volume_20?: number | null;
  } | null;
  technical_state?: {
    rsi14?: number | null;
    macd_histogram?: number | null;
    trend?: { score?: number | null; label?: string } | null;
    sma?: { sma20?: number | null; sma50?: number | null; sma200?: number | null } | null;
    returns?: { d7?: number | null; d30?: number | null; ytd?: number | null; y1?: number | null } | null;
    support?: number[] | null;
    resistance?: number[] | null;
    signals?: string[] | null;
    patterns?: SumPattern[] | null;
  } | null;
  market_state?: { labelVi?: string; strength?: number | null } | null;
  fundamental_state?: {
    financial_health?: {
      scores?: { overall?: number | null; profitability?: number | null; liquidity?: number | null; leverage?: number | null; cashflow?: number | null; efficiency?: number | null };
      coverage?: number | null;
      warnings?: string[];
      riskFlags?: string[];
    } | null;
    valuation?: {
      multiples?: { pe?: number | null; pb?: number | null; evEbitda?: number | null; dividendYield?: number | null };
      confidence?: string | null;
      notes?: string[];
    } | null;
  } | null;
  risk_metrics?: { atr14?: number | null; volatility_30d?: number | null; max_drawdown_52w?: number | null } | null;
}

const num = (v: number | null | undefined, d = 2): string => (v == null || Number.isNaN(v) ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: d }));
const pct = (v: number | null | undefined, d = 2): string => (v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const volM = (v: number | null | undefined): string => {
  if (v == null || Number.isNaN(v) || v <= 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ cp`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr cp`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} k cp`;
  return v.toLocaleString("vi-VN");
};

const TREND_VI: Record<string, string> = {
  "strong-up": "tăng mạnh",
  up: "tăng",
  sideways: "đi ngang",
  down: "giảm",
  "strong-down": "giảm mạnh",
};

const PATTERN_SENTIMENT: Record<SumPattern["type"], string> = {
  bullish: "ủng hộ đảo chiều / tiếp diễn TĂNG",
  bearish: "ủng hộ đảo chiều / tiếp diễn GIẢM",
  neutral: "trung lập — thị trường lưỡng lự",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rule-based call from the real inputs. Returns label + confidence %. */
export function stockCall(c: StockContract): { label: "MUA" | "BÁN" | "TRUNG LẬP"; confidence: number; score: number } {
  const tech = c.technical_state?.trend?.score;
  const techNorm = tech == null ? 0 : clamp(tech / 3, -1, 1);
  const overall = c.fundamental_state?.financial_health?.scores?.overall;
  const healthNorm = overall == null ? 0 : clamp((overall - 50) / 50, -1, 1);
  const pe = c.fundamental_state?.valuation?.multiples?.pe;
  const valNorm = pe == null ? 0 : clamp((18 - pe) / 18, -1, 1);

  const wTech = 0.5;
  const wHealth = 0.3;
  const wVal = 0.2;
  const score = wTech * techNorm + wHealth * healthNorm + wVal * valNorm;

  const hasTech = tech != null;
  const hasHealth = overall != null;
  const hasVal = pe != null;
  const coverage = (hasTech ? 1 : 0) + (hasHealth ? 1 : 0) + (hasVal ? 1 : 0);

  const label: "MUA" | "BÁN" | "TRUNG LẬP" = score >= 0.2 ? "MUA" : score <= -0.2 ? "BÁN" : "TRUNG LẬP";
  const confidence = Math.round(clamp(45 + Math.abs(score) * 40 + coverage * 3, 40, 92));
  return { label, confidence, score };
}

export function summarizeStock(c: StockContract): { lines: string[]; facts: Record<string, unknown> } {
  const sym = c.asset?.symbol ?? "";
  const md = c.market_data;
  const ts = c.technical_state;
  const fh = c.fundamental_state?.financial_health;
  const val = c.fundamental_state?.valuation;
  const rm = c.risk_metrics;
  const lines: string[] = [];

  /* 1 — price & liquidity */
  if (md) {
    const range = md.low != null && md.high != null ? ` · biên phiên ${num(md.low)}–${num(md.high)}` : "";
    const vol = md.volume ? ` · KL ${volM(md.volume)}` : "";
    const avg = md.avg_volume_20 ? ` (TB 20 phiên ${volM(md.avg_volume_20)})` : "";
    const liq = md.volume != null && md.avg_volume_20 ? (md.volume >= md.avg_volume_20 * 1.5 ? " — đột biến" : md.volume <= md.avg_volume_20 * 0.6 ? " — trầm lắng" : "") : "";
    lines.push(`## Giá & thanh khoản`, `${sym}: giá ${num(md.price)} (${pct(md.change_percent)})${range}${vol}${avg}${liq}.`);
  } else {
    lines.push(`## Giá & thanh khoản`, `${sym}: chưa có dữ liệu giá/thanh khoản.`);
  }

  /* 2 — technicals */
  if (ts) {
    const sma = ts.sma ?? {};
    const ma: string[] = [];
    if (md?.price != null) {
      if (sma.sma20 != null) ma.push(`${md.price >= sma.sma20 ? "trên" : "dưới"} SMA20`);
      if (sma.sma50 != null) ma.push(`${md.price >= sma.sma50 ? "trên" : "dưới"} SMA50`);
      if (sma.sma200 != null) ma.push(`${md.price >= sma.sma200 ? "trên" : "dưới"} SMA200`);
    }
    const macd = ts.macd_histogram != null ? ` · MACD hist ${ts.macd_histogram > 0 ? "+" : ""}${num(ts.macd_histogram, 2)} (${ts.macd_histogram > 0 ? "ủng hộ tăng" : "nghiêng về bán"})` : "";
    lines.push(
      `## Kỹ thuật`,
      `RSI14 ${num(ts.rsi14, 1)}${macd} · ${ma.length ? `giá ${ma.join(", ")}` : "chưa đủ MA"}.`,
      `Xu hướng: ${TREND_VI[ts.trend?.label ?? ""] ?? ts.trend?.label ?? "—"} (điểm ${num(ts.trend?.score, 1)}/3)${c.market_state?.strength != null ? ` · trạng thái ${c.market_state.labelVi ?? ""} strength ${c.market_state.strength}/100` : ""}.`,
    );
    if (ts.returns) {
      lines.push(`Hiệu suất: 7 ngày ${pct(ts.returns.d7)} · 30 ngày ${pct(ts.returns.d30)} · 1 năm ${pct(ts.returns.y1)}.`);
    }
    if (ts.signals?.length) lines.push(...ts.signals.map((s) => `- ${s}`));
  } else {
    lines.push(`## Kỹ thuật`, `Chưa đủ chuỗi giá để tính RSI/MACD/MA.`);
  }

  /* 3 — candle patterns */
  const patterns = ts?.patterns ?? [];
  lines.push(`## Mẫu hình nến`);
  if (patterns.length) {
    for (const p of patterns) lines.push(`- ${p.nameVi} (${p.name}) — ${PATTERN_SENTIMENT[p.type]} · độ tin cậy ${p.reliability}.`);
  } else {
    lines.push(`Không ghi nhận mẫu hình nến đáng chú ý ở 5 phiên gần nhất — giá chủ yếu vận động theo xu hướng hiện tại.`);
  }

  /* 4 — financial health */
  lines.push(`## Sức khỏe tài chính`);
  if (fh && fh.scores?.overall != null) {
    lines.push(
      `Điểm tổng hợp ${num(fh.scores.overall, 0)}/100 · sinh lời ${num(fh.scores.profitability, 0)} · thanh khoản ${num(fh.scores.liquidity, 0)} · đòn bẩy ${num(fh.scores.leverage, 0)} · dòng tiền ${num(fh.scores.cashflow, 0)} · hiệu quả ${num(fh.scores.efficiency, 0)}.`,
    );
    if (fh.riskFlags?.length) lines.push(...fh.riskFlags.map((f) => `- Rủi ro: ${f}`));
    if (fh.warnings?.length) lines.push(...fh.warnings.slice(0, 2).map((w) => `- Lưu ý: ${w}`));
  } else {
    lines.push(`Chưa đủ dữ liệu báo cáo tài chính để chấm điểm sức khỏe doanh nghiệp.`);
  }

  /* 5 — valuation */
  lines.push(`## Định giá`);
  if (val) {
    const m = val.multiples ?? {};
    lines.push(`P/E ${num(m.pe, 1)}x · P/B ${num(m.pb, 1)}x · EV/EBITDA ${num(m.evEbitda, 1)}x · cổ tức ${m.dividendYield != null ? `${(m.dividendYield * 100).toFixed(1)}%` : "—"}.`);
    if (val.notes?.length) lines.push(...val.notes.slice(0, 2).map((n) => `- ${n}`));
  } else {
    lines.push(`Chưa đủ dữ liệu để định giá (P/E, P/B).`);
  }

  /* 6 — risk */
  if (rm && (rm.atr14 != null || rm.volatility_30d != null || rm.max_drawdown_52w != null)) {
    lines.push(`## Rủi ro`, `ATR14 ${num(rm.atr14)} · biến động 30 ngày ${rm.volatility_30d != null ? `${(rm.volatility_30d * 100).toFixed(0)}%` : "—"} · drawdown 52 tuần ${rm.max_drawdown_52w != null ? pct(rm.max_drawdown_52w * 100, 0) : "—"}.`);
  }

  /* 7 — conclusion + recommendation */
  const call = stockCall(c);
  const stance =
    call.label === "MUA" ? "nghiêng về MUA / tích lũy" : call.label === "BÁN" ? "nghiêng về BÁN / giảm tỷ trọng" : "TRUNG LẬP — chờ tín hiệu rõ ràng hơn";
  lines.push(`## Kết luận`, `${sym} hiện ${stance}; kỹ thuật ${TREND_VI[ts?.trend?.label ?? ""] ?? "chưa rõ"}, sức khỏe tài chính ${fh?.scores?.overall != null ? `${num(fh.scores.overall, 0)}/100` : "chưa chấm được"}.`);
  lines.push(`Khuyến nghị: ${call.label} (độ tin cậy ${call.confidence}%).`);
  lines.push(`— Phân tích định lượng từ dữ liệu thật tại thời điểm trả lời; không phải khuyến nghị đầu tư.`);

  const facts: Record<string, unknown> = {
    symbol: sym,
    price: md?.price ?? null,
    change_percent: md?.change_percent ?? null,
    volume: md?.volume ?? null,
    avg_volume_20: md?.avg_volume_20 ?? null,
    rsi14: ts?.rsi14 ?? null,
    macd_histogram: ts?.macd_histogram ?? null,
    trend: ts?.trend?.label ?? null,
    patterns: patterns.map((p) => p.name),
    financial_health: fh?.scores?.overall ?? null,
    pe: val?.multiples?.pe ?? null,
    pb: val?.multiples?.pb ?? null,
    recommendation: call.label,
    confidence_pct: call.confidence,
  };
  return { lines, facts };
}

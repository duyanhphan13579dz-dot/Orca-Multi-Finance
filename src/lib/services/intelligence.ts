import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { getVnEquityDetail, vndirectConfigured, type VnEquityDetail } from "./stocks";
import { getCryptoDetail } from "./crypto";
import { getForexDetail } from "./forex";
import { getNews } from "./news";
import { getCryptoKlines, getCryptoMarkets } from "./crypto";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { detectMarketState, STATE_VI, type MarketStateResult } from "../engines/market-state";
import { analyzeScalp, type ScalpSignal } from "../engines/scalp";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation, type ValuationResult } from "../engines/valuation";
import { validateBars, logQualityEvent, qualityToLabel } from "../quality";
import { llmChat, llmConfigured, modelFor } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import type { Meta, OhlcvBar, Quote, QualityStatus } from "../types";

/**
 * MARKET INTELLIGENCE LAYER — builds LLM DATA CONTRACTS from verified data.
 * Pipeline: fetch → validate → quality → quant engines →
 * structured context → (optional) role-selected LLM → output validation.
 */

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export function computeConfidence(args: { freshness: string[]; quality?: QualityStatus; coverage?: number }): Confidence {
  const worst = worstFreshness(args.freshness as Meta["freshness"][]);
  if (worst === "UNAVAILABLE" || args.quality === "INVALID") return "LOW";
  let score = 2;
  if (worst === "LIVE" || worst === "FRESH") score += 1;
  if (worst === "DELAYED") score += 0;
  if (worst === "STALE" || worst === "DEGRADED") score -= 1;
  if (args.quality === "SUSPECT" || args.quality === "STALE") score -= 0.5;
  if (args.coverage != null && args.coverage < 0.4) score -= 1;
  return score >= 3 ? "HIGH" : score >= 1.5 ? "MEDIUM" : "LOW";
}

/* ------------------------------ stock analysis ----------------------------- */

export interface StockAnalysisContract {
  asset: { symbol: string; asset_type: "stock" };
  market_data: Record<string, unknown> | null;
  technical_state: Record<string, unknown> | null;
  market_state: (MarketStateResult & { labelVi: string }) | null;
  fundamental_state: {
    financial_health: FinancialHealthResult;
    valuation: ValuationResult;
  } | null;
  risk_metrics: Record<string, unknown> | null;
  news_context: { title: string; source: string; publishedAt: string }[];
  data_meta: { source: string; fetched_at: string; notes: string[] };
}

export async function buildStockAnalysis(symbol: string): Promise<{
  contract: StockAnalysisContract;
  meta: Meta;
  confidence: Confidence;
  detail: VnEquityDetail;
} | null> {
  if (!vndirectConfigured()) return null;
  const sym = symbol.toUpperCase();
  const r = await getVnEquityDetail(sym);
  if (!r) return null;
  const { detail } = r;

  const marketState = detectMarketState(detail.bars);
  const health = computeFinancialHealth({
    income: detail.financials.income ?? [],
    balance: detail.financials.balance ?? [],
    cashflow: detail.financials.cashflow ?? [],
  });
  const price = detail.quote?.price ?? detail.technical?.last ?? detail.bars[detail.bars.length - 1]?.close ?? 0;
  const valuation = price > 0 ? computeValuation({ price, health }) : null;
  const news = await getNews({ symbol: sym, limit: 5 });

  const contract: StockAnalysisContract = {
    asset: { symbol: sym, asset_type: "stock" },
    market_data: detail.quote
      ? {
          price: detail.quote.price,
          change_percent: detail.quote.changePercent,
          high: detail.quote.high,
          low: detail.quote.low,
          volume: detail.quote.volume,
          value: detail.quote.quoteVolume,
        }
      : null,
    technical_state: detail.technical
      ? {
          rsi14: detail.technical.rsi14,
          macd_histogram: detail.technical.macd?.histogram ?? null,
          trend: detail.technical.trend,
          sma: detail.technical.sma,
          bollinger: detail.technical.bollinger,
          returns: detail.technical.returns,
          support: detail.technical.support,
          resistance: detail.technical.resistance,
          signals: detail.technical.signals,
        }
      : null,
    market_state: marketState ? { ...marketState, labelVi: STATE_VI[marketState.state] } : null,
    fundamental_state: { financial_health: health, valuation: valuation as ValuationResult },
    risk_metrics: detail.technical
      ? {
          atr14: detail.technical.atr14,
          volatility_30d: detail.technical.volatility30d,
          max_drawdown_52w: detail.technical.maxDrawdown,
          rsi_zone: marketState?.rsiZone ?? null,
          volatility_regime: marketState?.volatility ?? null,
        }
      : null,
    news_context: (news?.articles ?? []).map((a) => ({ title: a.title, source: a.source, publishedAt: a.publishedAt })),
    data_meta: {
      source: r.meta.source,
      fetched_at: new Date().toISOString(),
      notes: detail.notes,
    },
  };

  const confidence = computeConfidence({
    freshness: [r.meta.freshness, news?.meta.freshness ?? "UNAVAILABLE"],
    quality: r.meta.qualityStatus,
    coverage: health.coverage,
  });
  const meta = buildMeta({
    source: r.meta.source,
    sourceTimestampMs: detail.quote?.updatedAt ? Date.parse(detail.quote.updatedAt) : Date.now(),
    note: detail.notes[0],
    partial: health.coverage < 0.5,
  });
  meta.qualityStatus = r.meta.qualityStatus ?? (r.meta.freshness === "DEGRADED" ? "SUSPECT" : "VALID");
  return { contract, meta, confidence, detail };
}

/* ------------------------------ forex analysis ----------------------------- */

export async function buildForexAnalysisContract(pair: string) {
  const r = await getForexDetail(pair);
  if (!r) return null;
  const { detail, meta } = r;
  const bars = detail.series;
  const marketState = detectMarketState(bars);
  const tech = detail.technical;
  return {
    contract: {
      asset: { symbol: detail.pair, asset_type: "forex" },
      market_data: detail.current
        ? { price: detail.current.price, change_percent: detail.current.changePercent, updated_at: detail.current.updatedAt }
        : null,
      technical_state: tech
        ? {
            rsi14: tech.rsi14,
            trend: tech.trend,
            returns: tech.returns,
            support: tech.support,
            resistance: tech.resistance,
            signals: tech.signals,
          }
        : null,
      market_state: marketState ? { ...marketState, labelVi: STATE_VI[marketState.state] } : null,
      risk_metrics: tech ? { volatility_30d: tech.volatility30d, max_drawdown: tech.maxDrawdown } : null,
      methodology_note: detail.referenceNote,
      data_meta: { source: meta.source, freshness: meta.freshness, fetched_at: new Date().toISOString() },
    },
    meta,
    confidence: computeConfidence({ freshness: [meta.freshness] }),
  };
}

/* ------------------------------ crypto scalping ---------------------------- */

export interface ScalpResult {
  signal: ScalpSignal;
  quality: QualityStatus;
  wsLive: boolean;
}

export async function buildScalpSignal(symbolRaw: string, timeframe = "5m"): Promise<{ result: ScalpResult; meta: Meta } | null> {
  ensureBinanceWsStarted();
  const sym = symbolRaw.toUpperCase().endsWith("USDT") ? symbolRaw.toUpperCase() : `${symbolRaw.toUpperCase()}USDT`;
  const [klines, markets] = await Promise.all([getCryptoKlines(sym, timeframe, 320), getCryptoMarkets()]);
  if (!klines || klines.bars.length < 60) return null;

  const q = validateBars(klines.bars);
  if (q.status !== "VALID") void logQualityEvent("binance-spot", `scalp:${sym}`, q);
  const signal = analyzeScalp(q.cleaned, {
    timeframe,
    quoteVolume24h: markets?.rows.find((r) => r.symbol === sym)?.quoteVolume ?? null,
  });
  if (!signal) return null;

  const wsTick = binanceWs.getTicker(sym, 10_000);
  const meta = buildMeta({
    source: wsTick ? "binance-ws + binance" : "binance",
    sourceTimestampMs: wsTick?.eventTime ?? klines.bars[klines.bars.length - 1]?.time ?? Date.now(),
    note: wsTick ? "Giá realtime qua centralized WebSocket engine" : "WS engine đang kết nối/chưa khả dụng — dùng nến realtime từ REST",
  });
  meta.qualityStatus = q.status;
  return { result: { signal, quality: q.status, wsLive: Boolean(wsTick) }, meta };
}

/* ------------------------------ stock report ------------------------------- */

export interface StockReport {
  symbol: string;
  title: string;
  generatedAt: string;
  mode: "llm-assisted" | "deterministic";
  model: string | null;
  confidence: Confidence;
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  sections: {
    fact: string[];
    calculation: string[];
    interpretation: string[];
    scenario: string[];
  };
}

export async function generateStockReport(symbol: string): Promise<{ report: StockReport; meta: Meta } | null> {
  const analysis = await buildStockAnalysis(symbol);
  if (!analysis) return null;
  const { contract, meta, confidence } = analysis;
  const c = contract;
  const now = new Date();

  /* ---- FACT + CALCULATION blocks: deterministic, always ---- */
  const fact: string[] = [];
  const calc: string[] = [];
  if (c.market_data) {
    fact.push(
      `Giá hiện tại ${fmt(c.market_data.price as number)} (${pctS(c.market_data.change_percent as number | null)}), biên phiên ${fmt(c.market_data.low as number | null)}–${fmt(c.market_data.high as number | null)}${c.market_data.volume ? `, khối lượng ${(c.market_data.volume as number).toLocaleString("vi-VN")}` : ""}.`,
    );
  }
  if (c.market_state) {
    fact.push(`Market state do engine xác định: ${c.market_state.labelVi} — strength ${c.market_state.strength}/100.`);
    fact.push(...c.market_state.evidence.slice(0, 3));
  }
  const fh = c.fundamental_state?.financial_health;
  if (fh) {
    calc.push(
      `Financial Health Score (engine): ${fh.scores.overall ?? "—"}/100 — Profitability ${fh.scores.profitability ?? "—"}, Leverage ${fh.scores.leverage ?? "—"}, Cashflow ${fh.scores.cashflow ?? "—"}, Liquidity ${fh.scores.liquidity ?? "—"}, Efficiency ${fh.scores.efficiency ?? "—"}. Coverage dữ liệu ${(fh.coverage * 100).toFixed(0)}%.`,
    );
    const p = fh.groups.profitability;
    calc.push(
      `ROE ${pc(p.roe)}, ROA ${pc(p.roa)}, Net margin ${pc(p.netMargin)} · D/E ${numS(fh.groups.leverage.debtToEquity)}x, Net debt/EBITDA ${numS(fh.groups.leverage.netDebtToEbitda)}x · FCF TTM ${bigS(fh.groups.cashflow.fcfTtm)}.`,
    );
    for (const w of fh.warnings) calc.push(`Cảnh báo engine: ${w}.`);
  }
  const v = c.fundamental_state?.valuation;
  if (v) {
    calc.push(
      `Định giá (engine): P/E ${numS(v.multiples.pe)}x · P/B ${numS(v.multiples.pb)}x · EV/EBITDA ${numS(v.multiples.evEbitda)}x · FCF yield ${v.multiples.fcfYield != null ? `${v.multiples.fcfYield}%` : "—"}. Confidence: ${v.confidence}.`,
    );
    if (v.dcf) {
      calc.push(
        `DCF scenarios: ${v.dcf.map((s) => `${s.label} ≈ ${s.intrinsicPerShare.toLocaleString("vi-VN")}đ (${s.marginOfSafetyPct >= 0 ? "+" : ""}${s.marginOfSafetyPct}%)`).join(" · ")}.`,
      );
    }
  }

  /* ---- deterministic fallback interpretation ---- */
  const detInterpretation: string[] = buildDeterministicNarrative(c);
  const detScenario: string[] = buildScenarios(c);

  /* ---- LLM pass (reasoning role) with output validation ---- */
  let mode: StockReport["mode"] = "deterministic";
  let model: string | null = null;
  let interpretation = detInterpretation;
  let scenario = detScenario;
  let outputValidation: Meta["outputValidation"];

  if (llmConfigured()) {
    const facts = collectFactNumbers(c);
    const promptUser = `Cấu trúc phân tích (dữ liệu thật, đã qua engine định lượng):\n${JSON.stringify(c, null, 1).slice(0, 12_000)}\n\nViết phần DIỄN GIẢI (interpretation) văn phong analyst chuyên nghiệp Việt Nam: 2 đoạn văn mạch lạc, nguyên nhân→hệ quả, trích số liệu từ dữ liệu trên, KHÔNG bullet máy móc, KHÔNG thêm con số mới. Sau đó 1 đoạn KỊCH BẢN (scenario) ngắn gọn bọc trong <scenario>...</scenario>.`;
    const sys = `Bạn là buy-side analyst của ORCA Financial. Chỉ dùng số liệu trong context đính kèm. Nếu dữ liệu thiếu, nêu rõ. Không khuyến nghị mua/bán tuyệt đối.`;
    const first = await llmChat("reasoning", { system: sys, user: promptUser, temperature: 0.28, maxTokens: 900 });
    if (first) {
      let val = validateOutput(first.text, facts);
      let text = first.text;
      if (!val.ok) {
        const regen = await llmChat("reasoning", {
          system: `${sys}\nSTRICT MODE: câu trước chứa số liệu không có trong dữ liệu nguồn (${val.unsupported
            .slice(0, 5)
            .map((u) => u.raw)
            .join(", ")}). Chỉ được trích số trong context.`,
          user: promptUser,
          temperature: 0.2,
          maxTokens: 900,
        });
        if (regen) {
          const v2 = validateOutput(regen.text, facts);
          if (v2.ok) {
            text = regen.text;
            val = v2;
            outputValidation = { validated: true, unsupportedClaims: 0, recovered: "regenerated" };
          } else {
            outputValidation = { validated: false, unsupportedClaims: v2.unsupported.length, recovered: "deterministic-fallback" };
            text = "";
          }
        }
      }
      if (text) {
        const scenMatch = text.match(/<scenario>([\s\S]*?)<\/scenario>/i);
        const interpText = text.replace(/<scenario>[\s\S]*?<\/scenario>/i, "").trim();
        interpretation = interpText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
        if (scenMatch?.[1]) scenario = scenMatch[1].split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
        mode = "llm-assisted";
        model = first.model;
        if (!outputValidation) outputValidation = { validated: true, unsupportedClaims: 0 };
      }
    }
  }

  const report: StockReport = {
    symbol: c.asset.symbol,
    title: `ORCA Stock Report — ${c.asset.symbol}`,
    generatedAt: now.toISOString(),
    mode,
    model,
    confidence,
    dataQuality: qualityToLabel(meta.qualityStatus),
    sections: { fact, calculation: calc, interpretation, scenario },
  };
  meta.outputValidation = outputValidation;
  return { report, meta };
}

/* ------------------------------- composers -------------------------------- */

function buildDeterministicNarrative(c: StockAnalysisContract): string[] {
  const out: string[] = [];
  const ms = c.market_state;
  if (ms) {
    out.push(
      `Trên mặt kỹ thuật, cấu trúc hiện tại của ${c.asset.symbol} được engine ghi nhận là ${ms.labelVi.toLowerCase()} với trend score ${ms.trendScore >= 0 ? "+" : ""}${ms.trendScore.toFixed(1)} và vị thế ${(ms.rangePosition * 100).toFixed(0)}% trong dải 120 phiên. ${ms.volatility === "high" ? "Biến động đang ở chế độ cao so với chính lịch sử của mã — vùng điều chỉnh và hồi phục đều có thể diễn ra nhanh, quản trị tỷ trọng là yếu tố then chốt." : ms.volatility === "low" ? "Biên dao động đang nén lại tương đối chặt; các pha tích lũy như vậy thường đi trước những nhịp mở rộng range, vấn đề là hướng đi kèm xác nhận thanh khoản." : "Chế độ biến động tương đối cân bằng, thị trường chưa vào trạng thái stress."}`,
    );
  }
  const fh = c.fundamental_state?.financial_health;
  if (fh && fh.scores.overall != null) {
    const p = fh.groups.profitability;
    const l = fh.groups.leverage;
    out.push(
      `Về cơ bản, sức khỏe tài chính ở mức ${fh.scores.overall}/100${fh.coverage < 0.6 ? " (dựa trên phần dữ liệu hiện có)" : ""}. ${
        p.roe != null && p.roe > 0.15
          ? `ROE ${pc(p.roe)} là điểm sáng rõ nhất`
          : p.roe != null
            ? `ROE ${pc(p.roe)} ở vùng trung bình`
            : "Hiệu suất sinh lời chưa đủ dữ liệu để kết luận"
      }; cơ cấu nợ ${l.debtToEquity != null ? `D/E ${numS(l.debtToEquity)}x${l.netDebtToEbitda != null ? `, nợ ròng/EBITDA ${numS(l.netDebtToEbitda)}x` : ""}` : "chưa rõ"} cho thấy ${
        l.debtToEquity != null && l.debtToEquity > 1.2 ? "đòn bẩy tài chính là nguồn rủi ro cần giám sát sát, đặc biệt khi chu kỳ lãi suất bất lợi" : "bảng cân đối tương đối lành mạnh"
      }. ${fh.groups.cashflow.fcfConversion != null && fh.groups.cashflow.fcfConversion < 0.4 ? "Điểm cần theo dõi là khả năng chuyển hóa lợi nhuận thành dòng tiền còn yếu." : "Chất lượng dòng tiền tương xứng với lợi nhuận kế toán."}`,
    );
  }
  return out;
}

function buildScenarios(c: StockAnalysisContract): string[] {
  const out: string[] = [];
  const v = c.fundamental_state?.valuation;
  const ms = c.market_state;
  if (v?.dcf) {
    const base = v.dcf.find((s) => s.label === "Base");
    if (base) out.push(`Kịch bản Base (growth ${pctS(base.growthY1to5 * 100)}, WACC ${(base.discountRate * 100).toFixed(1)}%): giá trị hợp lý khoảng ${base.intrinsicPerShare.toLocaleString("vi-VN")}đ — ${base.marginOfSafetyPct >= 5 ? "giá hiện tại còn biên an toàn dương" : base.marginOfSafetyPct <= -10 ? "giá đã phản ánh phần lớn kỳ vọng" : "biên an toàn mỏng, nhạy cảm giả định"}.`);
  }
  if (ms) {
    out.push(
      ms.state === "breakout"
        ? "Kịch bản kỹ thuật: breakout chỉ có giá trị khi giữ được trên vùng phá vỡ trong 2-3 phiên tới kèm thanh khoản duy trì; rơi lại dưới đó là tín hiệu false breakout."
        : ms.state === "accumulation"
          ? "Kịch bản kỹ thuật: nền tích lũy cần một phiên bứt qua cản trên với vol mở rộng để xác nhận kết thúc pha gom hàng."
          : ms.state === "distribution"
            ? "Kịch bản kỹ thuật: dấu chân phân phối yêu cầu thận trọng với mọi nhịp hồi yếu thanh khoản — thủng đáy nền sẽ mở nhịp điều chỉnh sâu hơn."
            : "Kịch bản kỹ thuật: theo dõi phản ứng tại các vùng hỗ trợ/kháng cự đã định vị; quyết định chỉ nên đi kèm xác nhận thanh khoản.",
    );
  }
  out.push("Nội dung mang tính phân tích nghiên cứu từ dữ liệu thật — không phải khuyến nghị đầu tư.");
  return out;
}

const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: v >= 1000 ? 0 : 2 }));
const pc = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const pctS = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const numS = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
const bigS = (v: number | null | undefined) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)} tỷ`;
  return v.toLocaleString("vi-VN");
};

/* convenience for the agent */
export { getCryptoDetail, getCryptoKlines };

export type { OhlcvBar, Quote };

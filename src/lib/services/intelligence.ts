import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { getVnStockDetail, vnstockConfigured, type VnStockDetail } from "./stocks";
import { getCryptoDetail } from "./crypto";
import { getForexDetail } from "./forex";
import { getNews } from "./news";
import { getCryptoKlines, getCryptoMarkets } from "./crypto";
import { binanceWs, ensureBinanceWsStarted } from "../realtime/binance-ws";
import { detectMarketState, STATE_VI, type MarketStateResult } from "../engines/market-state";
import { analyzeScalp, analyzeScalpMulti, type ScalpSignal } from "../engines/scalp";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation, type ValuationResult } from "../engines/valuation";
import { validateBars, logQualityEvent, qualityToLabel } from "../quality";
import { llmChat, llmConfigured, modelFor } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import type { Meta, OhlcvBar, Quote, QualityStatus } from "../types";

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
  detail: VnStockDetail;
} | null> {
  if (!vnstockConfigured()) return null;
  const sym = symbol.toUpperCase();
  const r = await getVnStockDetail(sym);
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

export interface ScalpResult {
  signal: ScalpSignal;
  quality: QualityStatus;
  wsLive: boolean;
}

export async function buildScalpSignal(symbolRaw: string, timeframe = "5m"): Promise<{ result: ScalpResult; meta: Meta } | null> {
  ensureBinanceWsStarted();
  const sym = symbolRaw.toUpperCase().endsWith("USDT") ? symbolRaw.toUpperCase() : `${symbolRaw.toUpperCase()}USDT`;

  const [m15, m5, m1, markets, detail] = await Promise.all([
    getCryptoKlines(sym, "15m", 120),
    getCryptoKlines(sym, timeframe === "1m" ? "5m" : timeframe === "15m" ? "15m" : "5m", 320),
    getCryptoKlines(sym, "1m", 120),
    getCryptoMarkets(),
    getCryptoDetail(sym, "15m"),
  ]);

  const primaryBars = m5?.bars ?? m15?.bars;
  if (!primaryBars || primaryBars.length < 60) return null;
  if (!m15 || m15.bars.length < 40) return null;

  const q5 = validateBars(primaryBars);
  const q15 = validateBars(m15.bars);
  if (q5.status !== "VALID") void logQualityEvent("binance-spot", `scalp:${sym}:m5`, q5);
  if (q15.status !== "VALID") void logQualityEvent("binance-spot", `scalp:${sym}:m15`, q15);

  const q1 = m1 && m1.bars.length >= 30 ? validateBars(m1.bars) : null;
  const row = markets?.rows.find((r) => r.symbol === sym);
  const funding = detail?.detail.funding?.fundingRate ?? null;
  const oi = detail?.detail.openInterest?.openInterest ?? null;

  const signal = analyzeScalpMulti({
    symbol: sym,
    barsM15: q15.cleaned,
    barsM5: q5.cleaned,
    barsM1: q1?.cleaned ?? null,
    quoteVolume24h: row?.quoteVolume ?? null,
    fundingRate: funding,
    openInterest: oi,
  });
  if (!signal) return null;

  const wsTick = binanceWs.getTicker(sym, 10_000);
  const meta = buildMeta({
    source: wsTick ? "binance-ws + binance" : "binance",
    sourceTimestampMs: wsTick?.eventTime ?? primaryBars[primaryBars.length - 1]?.time ?? Date.now(),
    note: wsTick
      ? "Scalp multi-TF (M15->M5->M1) · gia realtime qua centralized WebSocket"
      : "Scalp multi-TF (M15->M5->M1) · WS chua live - nen REST",
  });
  meta.qualityStatus = q5.status === "VALID" && q15.status === "VALID" ? "VALID" : "SUSPECT";
  return { result: { signal, quality: meta.qualityStatus, wsLive: Boolean(wsTick) }, meta };
}

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

  const fact: string[] = [];
  const calc: string[] = [];
  if (c.market_data) {
    fact.push(
      `Gia hien tai ${fmt(c.market_data.price as number)} (${pctS(c.market_data.change_percent as number | null)}), bien phien ${fmt(c.market_data.low as number | null)}-${fmt(c.market_data.high as number | null)}${c.market_data.volume ? `, khoi luong ${(c.market_data.volume as number).toLocaleString("vi-VN")}` : ""}.`,
    );
  }
  if (c.market_state) {
    fact.push(`Market state do engine xac dinh: ${c.market_state.labelVi} - strength ${c.market_state.strength}/100.`);
    fact.push(...c.market_state.evidence.slice(0, 3));
  }
  const fh = c.fundamental_state?.financial_health;
  if (fh) {
    calc.push(
      `Financial Health Score (engine): ${fh.scores.overall ?? "-"}/100 - Profitability ${fh.scores.profitability ?? "-"}, Leverage ${fh.scores.leverage ?? "-"}, Cashflow ${fh.scores.cashflow ?? "-"}, Liquidity ${fh.scores.liquidity ?? "-"}, Efficiency ${fh.scores.efficiency ?? "-"}. Coverage ${(fh.coverage * 100).toFixed(0)}%.`,
    );
  }
  const v = c.fundamental_state?.valuation;
  if (v) {
    calc.push(
      `Dinh gia (engine): P/E ${numS(v.multiples.pe)}x - P/B ${numS(v.multiples.pb)}x - EV/EBITDA ${numS(v.multiples.evEbitda)}x. Confidence: ${v.confidence}.`,
    );
  }

  const detInterpretation: string[] = buildDeterministicNarrative(c);
  const detScenario: string[] = buildScenarios(c);

  let mode: StockReport["mode"] = "deterministic";
  let model: string | null = null;
  let interpretation = detInterpretation;
  let scenario = detScenario;
  let outputValidation: Meta["outputValidation"];

  if (llmConfigured()) {
    const facts = collectFactNumbers(c);
    const promptUser = `Cau truc phan tich:\n${JSON.stringify(c, null, 1).slice(0, 12_000)}\n\nViet phan DIEN GIAI (interpretation) 2 doan, trich so lieu, KHONG them so moi. Sau do 1 doan KICH BAN trong <scenario>...</scenario>.`;
    const sys = `Ban la buy-side analyst cua ORCA Financial. Chi dung so lieu trong context. Khong khuyen nghi mua/ban.`;
    const first = await llmChat("reasoning", { system: sys, user: promptUser, temperature: 0.28, maxTokens: 900 });
    if (first) {
      let val = validateOutput(first.text, facts);
      let text = first.text;
      if (!val.ok) {
        const regen = await llmChat("reasoning", {
          system: `${sys}\nSTRICT: chi trich so trong context.`,
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
    title: `ORCA Stock Report - ${c.asset.symbol}`,
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

function buildDeterministicNarrative(c: StockAnalysisContract): string[] {
  const out: string[] = [];
  const ms = c.market_state;
  if (ms) {
    out.push(
      `Ky thuat: ${c.asset.symbol} dang ${ms.labelVi.toLowerCase()} (trend score ${ms.trendScore >= 0 ? "+" : ""}${ms.trendScore.toFixed(1)}, range ${(ms.rangePosition * 100).toFixed(0)}%).`,
    );
  }
  return out;
}

function buildScenarios(c: StockAnalysisContract): string[] {
  const out: string[] = [];
  const ms = c.market_state;
  if (ms) {
    out.push(
      ms.state === "breakout"
        ? "Breakout can giu tren vung pha vo 2-3 phien kem thanh khoan."
        : "Theo doi phan ung tai ho tro/khang cu; quyet dinh can xac nhan thanh khoan.",
    );
  }
  out.push("Noi dung phan tich nghien cuu - khong phai khuyen nghi dau tu.");
  return out;
}

const fmt = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("vi-VN", { maximumFractionDigits: v >= 1000 ? 0 : 2 }));
const pc = (v: number | null | undefined) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const numS = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));
const pctS = (v: number | null | undefined) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const bigS = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("vi-VN"));

import "server-only";
import { env } from "../env";
import { buildMeta, worstFreshness } from "../freshness";
import { getCryptoDetail } from "./crypto";
import { getForexDetail, fmtRate } from "./forex";
import { getCommodityMarket } from "./commodities";
import { vnstockConfigured } from "./stocks";
import { getNews } from "./news";
import { buildMarketSnapshot } from "./market";
import { buildStockAnalysis, computeConfidence, type Confidence } from "./intelligence";
import { llmChat, llmConfigured, type LlmResult } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { qualityToLabel } from "../quality";
import { VN_TICKERS } from "../providers/news";
import type { FreshnessStatus, Meta } from "../types";

/**
 * ORCA AI AGENT — HIGH-LEVEL INTELLIGENCE LAYER.
 *
 * Mandatory pipeline (§14):
 *   intent → determine required data → fetch latest → validate freshness →
 *   run quant engines → build LLM DATA CONTRACT → role-selected LLM →
 *   output validation (anti-hallucination) → repair/regenerate → response.
 *
 * Deterministic composer remains the authoritative fallback — the answer is
 * always grounded in fetched facts, never in model memory.
 */

type Intent =
  | { kind: "crypto"; symbol: string }
  | { kind: "forex"; pair: string }
  | { kind: "vn-stock"; symbol: string }
  | { kind: "commodity"; query: string }
  | { kind: "market" }
  | { kind: "compare"; a: string; b: string }
  | { kind: "news"; query?: string }
  | { kind: "general" };

const KNOWN_CRYPTO = new Set([
  "BTC","ETH","SOL","BNB","XRP","DOGE","ADA","TON","AVAX","LINK","DOT","TRX","LTC","BCH","NEAR","SUI","APT","ARB","OP","INJ","TIA","SEI","PEPE","SHIB","UNI","ATOM","FIL","ETC","AAVE","MKR","ALGO","VET","ICP","FET","RENDER","WLD","JUP","ENA","ONDO","POL","XLM","HBAR","KAS","TAO","IP","PI","ZEC","STRK","PAXG",
]);
const FX_PAIRS = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURJPY","EURGBP","GBPJPY","AUDJPY","USDVND"];
const COMMODITY_WORDS: [RegExp, string][] = [
  [/vàng|gold/i, "gold"], [/bạc|silver/i, "silver"], [/dầu|oil|wti|brent/i, "oil"],
  [/cà phê|coffee/i, "coffee"], [/thép|steel/i, "steel"], [/đường|sugar/i, "sugar"],
  [/khí|gas|natgas/i, "natgas"], [/đồng\b|copper/i, "copper"],
];

export interface AgentPrefs {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
}

interface AgentAnswer {
  answer: string;
  mode: "deterministic" | "llm";
  intent: string;
  model: string | null;
  confidence: Confidence;
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataFreshness: FreshnessStatus;
  context: { sectionsUsed: string[]; symbols: string[] };
}

interface Built {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
}

/* ------------------------------ intent ------------------------------------- */

function detectIntent(q: string): Intent {
  const upper = q.toUpperCase();
  if (/so sánh|compare|\bvs\b|\bversus\b/i.test(q)) {
    const tokens = upper.match(/\b[A-Z]{2,10}\b/g) ?? [];
    const meaningful = tokens.filter((t) => KNOWN_CRYPTO.has(t) || VN_TICKERS.includes(t) || FX_PAIRS.includes(t));
    if (meaningful.length >= 2) return { kind: "compare", a: meaningful[0], b: meaningful[1] };
  }
  const usdt = upper.match(/\b([A-Z]{2,12})USDT\b/);
  if (usdt) return { kind: "crypto", symbol: `${usdt[1]}USDT` };
  const fxMatch = upper.match(/\b(EUR|GBP|USD|JPY|CHF|AUD|CAD|NZD|VND)[\s/]?(USD|JPY|CHF|CAD|NZD|EUR|GBP|AUD|VND)\b/);
  if (fxMatch) {
    const pair = (fxMatch[1] + fxMatch[2]).toUpperCase();
    if (FX_PAIRS.includes(pair)) return { kind: "forex", pair };
  }
  for (const t of upper.match(/\b[A-Z]{2,5}\b/g) ?? []) if (KNOWN_CRYPTO.has(t)) return { kind: "crypto", symbol: `${t}USDT` };
  for (const t of upper.match(/\b[A-Z]{3}\b/g) ?? []) if (VN_TICKERS.includes(t)) return { kind: "vn-stock", symbol: t };
  for (const [re, key] of COMMODITY_WORDS) if (re.test(q)) return { kind: "commodity", query: key };
  if (/thị trường|market|tổng quan|hôm nay|tình hình|đánh giá chung|bức tranh/i.test(q)) return { kind: "market" };
  if (/tin tức|news|sự kiện/i.test(q)) return { kind: "news" };
  return { kind: "general" };
}

/* --------------------------- contract builders ----------------------------- */

const trendVi: Record<string, string> = {
  "strong-up": "tăng mạnh", up: "tăng", sideways: "đi ngang tích lũy", down: "giảm", "strong-down": "giảm mạnh",
};

async function buildCrypto(sym: string): Promise<Built> {
  const sectionsUsed = ["crypto-detail", "technical"];
  const symbols = [sym];
  const freshnesses: FreshnessStatus[] = [];
  const r = await getCryptoDetail(sym, "1h");
  if (!r) {
    return { narrative: `${sym}: dữ liệu không khả dụng từ Binance (kiểm tra ký hiệu hoặc /system).`, contract: { asset: { symbol: sym, asset_type: "crypto" }, error: "unavailable" }, sectionsUsed, symbols, freshnesses, unavailable: true };
  }
  freshnesses.push(r.meta.freshness);
  const { ticker, technical, funding, openInterest, fundingStatus } = r.detail;
  const news = await getNews({ symbol: sym.replace(/USDT$/, ""), limit: 3 });
  if (news?.articles.length) freshnesses.push(news.meta.freshness);

  const contract = {
    asset: { symbol: sym, asset_type: "crypto" },
    market_data: {
      price: ticker.price,
      change_24h_pct: ticker.changePercent,
      range_24h: { low: ticker.low, high: ticker.high },
      quote_volume_24h_usd: ticker.quoteVolume,
      trades_24h: ticker.trades24h,
    },
    technical_state: technical
      ? {
          trend: technical.trend.label,
          trend_score: technical.trend.score,
          rsi14: technical.rsi14 != null ? Number(technical.rsi14.toFixed(1)) : null,
          macd_histogram: technical.macd ? Number(technical.macd.histogram.toPrecision(3)) : null,
          price_vs_sma50: technical.sma.sma50 ? (ticker.price > technical.sma.sma50 ? "above" : "below") : null,
          price_vs_sma200: technical.sma.sma200 ? (ticker.price > technical.sma.sma200 ? "above" : "below") : null,
          volatility_30d_annualized: technical.volatility30d ? Number((technical.volatility30d * 100).toFixed(1)) : null,
          max_drawdown_52w_pct: technical.maxDrawdown ? Number((technical.maxDrawdown * 100).toFixed(1)) : null,
          returns: { d7: technical.returns.d7, d30: technical.returns.d30, y1: technical.returns.y1 },
          support: technical.support,
          resistance: technical.resistance,
          signals: technical.signals,
        }
      : null,
    futures_state: funding
      ? { funding_rate_pct: Number((funding.fundingRate * 100).toFixed(4)), mark_price: funding.markPrice, open_interest: openInterest?.openInterest ?? null }
      : { status: "unavailable (geo-network)", what_is_known: fundingStatus },
    patterns: r.detail.patterns.map((p) => p.nameVi),
    news_context: (news?.articles ?? []).map((a) => ({ title: a.title, source: a.source })),
    data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() },
  };

  const t = technical;
  const narrative = [
    `${sym} — giá ${ticker.price.toLocaleString("en-US")} USDT, 24h ${ticker.changePercent != null ? ticker.changePercent.toFixed(2) + "%" : "?"}, biên ${ticker.low?.toLocaleString("en-US")}–${ticker.high?.toLocaleString("en-US")}, KL quy đổi $${((ticker.quoteVolume ?? 0) / 1e6).toFixed(1)}M.`,
    t
      ? `Kỹ thuật: xu hướng ${trendVi[t.trend.label]} (score ${t.trend.score >= 0 ? "+" : ""}${t.trend.score.toFixed(1)}), RSI14 ${t.rsi14?.toFixed(1) ?? "?"}, MACD hist ${t.macd ? t.macd.histogram.toPrecision(3) : "?"}, giá ${t.sma.sma50 ? (ticker.price > t.sma.sma50 ? "trên" : "dưới") : "?"} SMA50, vol 30d ${t.volatility30d ? (t.volatility30d * 100).toFixed(1) + "%" : "?"}, drawdown 52w ${t.maxDrawdown ? (t.maxDrawdown * 100).toFixed(1) + "%" : "?"}. Hỗ trợ ${t.support.map((s) => s.toLocaleString("en-US")).join(", ") || "—"}; kháng cự ${t.resistance.map((s) => s.toLocaleString("en-US")).join(", ") || "—"}.`
      : "Chưa đủ dữ liệu chuỗi để tính chỉ báo.",
    funding ? `Futures: funding ${(funding.fundingRate * 100).toFixed(4)}%${openInterest ? `, OI ${openInterest.openInterest.toLocaleString("en-US")}` : ""}.` : "Futures (funding/OI): không khả dụng từ vị trí mạng hiện tại — đã ghi rõ, không suy diễn.",
    news?.articles.length ? `Tin liên quan: ${news.articles.map((a) => `"${a.title}" (${a.source})`).join("; ")}.` : "",
  ];
  return { narrative: narrative.filter(Boolean).join("\n\n"), contract, sectionsUsed, symbols, freshnesses };
}

async function buildForex(pair: string): Promise<Built> {
  const r = await getForexDetail(pair);
  if (!r) {
    return { narrative: `Không lấy được dữ liệu ${pair} từ cả Biquote lẫn nguồn dự phòng — không suy diễn con số.`, contract: { asset: { symbol: pair, asset_type: "forex" }, error: "unavailable" }, sectionsUsed: [], symbols: [pair], freshnesses: [], unavailable: true };
  }
  const d = r.detail;
  const contract = {
    asset: { symbol: d.pair, asset_type: "forex" },
    market_data: d.current ? { price: d.current.price, change_pct_vs_prev_fix: d.current.changePercent } : null,
    technical_state: d.technical
      ? {
          trend: d.technical.trend.label, rsi14: d.technical.rsi14, returns: d.technical.returns,
          support: d.technical.support, resistance: d.technical.resistance, signals: d.technical.signals,
        }
      : null,
    methodology_note: d.referenceNote,
    data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() },
  };
  const narrative = [
    d.current ? `${d.base}/${d.quote}: ${fmtRate(d.current.price)}${d.current.changePercent != null ? ` (${d.current.changePercent >= 0 ? "+" : ""}${d.current.changePercent.toFixed(3)}% so với fix trước)` : ""}.` : `${d.base}/${d.quote}: chỉ có chuỗi tham chiếu ECB (không có realtime).`,
    d.technical ? `Kỹ thuật (chuỗi ECB daily): xu hướng ${trendVi[d.technical.trend.label]}, RSI14 ${d.technical.rsi14?.toFixed(1) ?? "?"}, 30 ngày ${d.technical.returns.d30?.toFixed(2) ?? "?"}%, 1 năm ${d.technical.returns.y1?.toFixed(2) ?? "?"}%; hỗ trợ ${d.technical.support.map(fmtRate).join(", ") || "—"}, kháng cự ${d.technical.resistance.map(fmtRate).join(", ") || "—"}.` : "",
    "Phương pháp: chuỗi lịch sử = tỷ giá tham chiếu hằng ngày ECB, phù hợp đọc xu hướng; quyết định giao dịch cần đối chiếu giá streaming từ sàn.",
  ];
  return { narrative: narrative.filter(Boolean).join("\n\n"), contract, sectionsUsed: ["forex-detail", "technical"], symbols: [pair], freshnesses: [r.meta.freshness] };
}

async function buildCommodity(kw: string): Promise<Built> {
  const r = await getCommodityMarket();
  const kwSymbols: Record<string, string[]> = {
    gold: ["XAUUSD", "SJC"], silver: ["XAGUSD"], oil: ["CL", "BZ"], natgas: ["NG"],
    copper: ["HG"], steel: ["HRC"], coffee: ["KC"], sugar: ["SB"],
  };
  const wanted = kwSymbols[kw] ?? [];
  if (!r) return { narrative: "Nguồn hàng hóa tạm không khả dụng.", contract: { error: "unavailable" }, sectionsUsed: [], symbols: [], freshnesses: [], unavailable: true };
  const rows = r.data.rows.filter((c) => wanted.includes(c.symbol));
  const contract = {
    asset: { symbol: kw, asset_type: "commodity" },
    market_data: rows.map((c) => ({
      name: c.commodity, symbol: c.symbol, price: c.price, unit: c.unit, change_pct: c.changePercent,
      sources: c.sourceRecords,
    })),
    unavailable: r.data.unavailable.filter((u) => wanted.some((w) => u.name.toLowerCase().includes(kw))).map((u) => u.reason),
    data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() },
  };
  const narrative = rows.length
    ? rows
        .map(
          (c) =>
            `${c.commodity}: ${c.price.toLocaleString("vi-VN")} ${c.unit ?? ""} (${c.changePercent != null ? `${c.changePercent >= 0 ? "+" : ""}${c.changePercent.toFixed(2)}%` : "chưa có %"}, nguồn ${c.sourceRecords.map((s) => s.source).join("/")})${c.symbol === "XAUUSD" ? ". Vàng bứt phá mạnh thường làm dòng tiền vào tài sản rủi ro chững lại — quan hệ quan sát, không nhân quả." : ""}`,
        )
        .join("\n\n")
    : `Nhóm "${kw}" chưa có nguồn khả dụng (Vietnambiz/Simplize/MSN chưa cấu hình) — hệ thống không tự suy diễn giá.`;
  return { narrative, contract, sectionsUsed: ["commodities"], symbols: rows.map((x) => x.symbol), freshnesses: [r.meta.freshness] };
}

async function buildVn(symbol: string, deep: boolean): Promise<Built> {
  if (!vnstockConfigured()) {
    const news = await getNews({ symbol, limit: 3 });
    const ctx: Record<string, unknown> = { asset: { symbol, asset_type: "stock" }, status: "vnstock_not_configured" };
    if (news?.articles.length) ctx.news_context = news.articles.map((a) => ({ title: a.title, source: a.source }));
    return {
      narrative:
        `${symbol} thuộc chứng khoán Việt Nam — phân khúc phụ thuộc VNStock. Hệ thống chưa có VNSTOCK_API_KEY (hoặc kết nối gián đoạn) nên không có số liệu thật để phân tích, và sẽ không đưa con số suy diễn. Pipeline phân tích đầy đủ (reconciliation VNStock↔VNDirect, financial health engine, valuation engine, market-state engine) đã sẵn sàng và sẽ chạy ngay khi key được cấu hình.` +
        (news?.articles.length ? `\n\nTin mới liên quan: ${news.articles.map((a) => `"${a.title}" (${a.source})`).join("; ")}.` : ""),
      contract: ctx,
      sectionsUsed: news?.articles.length ? ["news"] : [],
      symbols: [symbol],
      freshnesses: news ? [news.meta.freshness] : [],
      unavailable: true,
    };
  }
  const analysis = await buildStockAnalysis(symbol);
  if (!analysis) {
    return { narrative: `Không lấy được dữ liệu ${symbol} từ VNStock/VNDirect — xem /system.`, contract: { asset: { symbol, asset_type: "stock" }, error: "provider_unavailable" }, sectionsUsed: [], symbols: [symbol], freshnesses: [], unavailable: true };
  }
  const c = analysis.contract;
  const cAny = c as unknown as Record<string, Record<string, unknown> | null>;
  const ms = c.market_state;
  const fh = c.fundamental_state?.financial_health;
  const v = c.fundamental_state?.valuation;
  const lines = [
    c.market_data ? `${symbol}: giá ${(c.market_data.price as number).toLocaleString("vi-VN")} (${(c.market_data.change_percent as number)?.toFixed(2) ?? "?"}%).` : `${symbol} (dữ liệu VNStock).`,
    ms ? `Market state (engine): ${ms.labelVi} — strength ${ms.strength}/100. ${ms.evidence[0] ?? ""}` : "",
    fh && fh.scores.overall != null ? `Financial Health (engine): ${fh.scores.overall}/100 · ROE ${fh.groups.profitability.roe != null ? (fh.groups.profitability.roe * 100).toFixed(1) + "%" : "—"} · D/E ${fh.groups.leverage.debtToEquity?.toFixed(2) ?? "—"}x · FCF ${fh.groups.cashflow.fcfTtm != null ? fh.groups.cashflow.fcfTtm.toLocaleString("vi-VN") : "—"}.` : "",
    v && deep ? `Định giá: P/E ${v.multiples.pe ?? "—"}x · P/B ${v.multiples.pb ?? "—"}x${v.dcf ? ` · DCF Base ${v.dcf.find((s) => s.label === "Base")?.intrinsicPerShare.toLocaleString("vi-VN")}đ` : ""}.` : v ? `Định giá: P/E ${v.multiples.pe ?? "—"}x · P/B ${v.multiples.pb ?? "—"}x.` : "",
    cAny.technical_state && Array.isArray((cAny.technical_state as Record<string, unknown>).signals) ? `Tín hiệu: ${((cAny.technical_state as Record<string, unknown>).signals as string[]).join(" | ")}` : "",
  ];
  return {
    narrative: lines.filter(Boolean).join("\n\n"),
    contract: c as unknown as Record<string, unknown>,
    sectionsUsed: ["vn-stock", "market-state-engine", "financial-health-engine", "valuation-engine"],
    symbols: [symbol],
    freshnesses: [analysis.meta.freshness],
  };
}

async function buildMarket(): Promise<Built> {
  const snap = await buildMarketSnapshot();
  const p = snap.snapshot.pulse;
  const contract = {
    scope: "market_snapshot",
    pulse: { score: p.score, headline: p.headline, drivers: p.drivers },
    sections_freshness: snap.meta.sections,
    indices: snap.snapshot.indices?.slice(0, 4) ?? null,
    crypto_summary: snap.snapshot.crypto?.summary ?? null,
    forex_note: snap.snapshot.forex?.usdStrengthNote ?? null,
    commodities: snap.snapshot.commodities?.filter((x) => ["XAUUSD", "CL", "SJC"].includes(x.symbol)) ?? null,
    news_top: snap.snapshot.news?.slice(0, 5).map((n) => ({ title: n.title, source: n.source })) ?? null,
    data_meta: { source: snap.meta.source, freshness: snap.meta.freshness, fetched_at: new Date().toISOString(), note: snap.meta.note },
  };
  return {
    narrative: `${p.headline}.\n\n${p.body.join("\n\n")}`,
    contract,
    sectionsUsed: ["market-snapshot", "pulse-engine"],
    symbols: [],
    freshnesses: Object.values(snap.meta.sections ?? {}),
  };
}

/* --------------------------------- main ------------------------------------ */

const SYS = `Bạn là chuyên viên phân tích cấp cao của ORCA Financial (high-level reasoning layer).
Quy tắc bắt buộc:
- CHỈ dùng số liệu trong STRUCTURED CONTEXT đính kèm — mọi con số phải trace được về context. Không dùng kiến thức giá cũ từ model.
- Phân biệt rõ FACT (dữ liệu) / INTERPRETATION (diễn giải) / SCENARIO (kịch bản có điều kiện).
- Nếu dữ liệu thiếu hoặc stale/unavailable, nêu rõ phần thiếu — không bù đắp bằng phỏng đoán.
- Văn phong analyst Việt Nam chuyên nghiệp: mạch văn tự nhiên, nguyên nhân → hệ quả, KHÔNG bullet/NHÃN máy móc (cấm kiểu "Market - Neutral - Balanced").
- Không khuyến nghị mua/bán tuyệt đối; trình bày điều cần theo dõi.
- Kết thúc bằng 1 dòng: "Nguồn: <source> · <freshness> · <giờ fetch>".`;

export async function answerQuestion(question: string, prefs: AgentPrefs = {}): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = detectIntent(question);
  const deep = prefs.depth === "deep";
  let built: Built;

  if (intent.kind === "crypto") built = await buildCrypto(intent.symbol);
  else if (intent.kind === "forex") built = await buildForex(intent.pair);
  else if (intent.kind === "commodity") built = await buildCommodity(intent.query);
  else if (intent.kind === "vn-stock") built = await buildVn(intent.symbol, deep);
  else if (intent.kind === "market" || intent.kind === "news" || intent.kind === "general") {
    built = await buildMarket();
    if (intent.kind === "news" && built.contract.news_top) {
      const tops = (built.contract as { news_top?: { title: string; source: string }[] }).news_top ?? [];
      built = {
        ...built,
        narrative: tops.length
          ? tops.map((a, i) => `${i + 1}. ${a.title} — ${a.source}`).join("\n")
          : "Chưa có tin nào trong luồng phù hợp.",
      };
    }
  } else {
    // compare: build both sides (crypto-focused contract merge)
    const aIsCrypto = KNOWN_CRYPTO.has(intent.a.replace(/USDT$/, "")) || intent.a.endsWith("USDT");
    const bIsCrypto = KNOWN_CRYPTO.has(intent.b.replace(/USDT$/, "")) || intent.b.endsWith("USDT");
    const buildSide = async (s: string, crypto: boolean) =>
      crypto ? buildCrypto(s.endsWith("USDT") ? s : `${s}USDT`) : FX_PAIRS.includes(s) ? buildForex(s) : buildVn(s, false);
    const [A, B] = await Promise.all([buildSide(intent.a, aIsCrypto), buildSide(intent.b, bIsCrypto)]);
    built = {
      narrative: `Đối chiếu dựa trên dữ liệu vừa truy xuất (cùng các trục: biến động 24h, kỹ thuật, volatility, vị thế trend):\n\n${A.narrative}\n\n${B.narrative}\n\nGóc nhìn: so sánh trên cùng trục lượng hóa giúp tránh cảm giác chủ quan "mã mạnh hơn" chỉ vì vừa tăng giá.`,
      contract: { compare: [{ ...A.contract }, { ...B.contract }] },
      sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])],
      symbols: [intent.a, intent.b],
      freshnesses: [...A.freshnesses, ...B.freshnesses],
    };
  }

  /* depth: concise trims deterministic narrative */
  let narrative = built.narrative;
  if (prefs.depth === "concise") {
    const parts = narrative.split("\n\n");
    narrative = parts.slice(0, 2).join("\n\n");
  }

  /* LLM pass — role selection + output validation + repair */
  let mode: AgentAnswer["mode"] = "deterministic";
  let model: string | null = null;
  let finalAnswer = narrative;
  let outputValidation: Meta["outputValidation"];
  const factNums = collectFactNumbers(built.contract);

  if (llmConfigured() && !built.unavailable) {
    const role = intent.kind === "compare" || intent.kind === "market" ? "reasoning" : "analysis";
    const styleVi = prefs.style === "technical" ? "súc tích, nhấn chỉ báo kỹ thuật" : prefs.style === "brief" ? "rất ngắn gọn (3-5 câu)" : "phân tích chuyên sâu, 2-4 đoạn mạch lạc";
    const user = `CÂU HỎI: ${question}\n\nSTRUCTURED CONTEXT (dữ liệu thật mới nhất, đã qua validation + quant engines):\n${JSON.stringify(built.contract, null, 1).slice(0, 11_000)}\n\nTrả lờì bằng văn phong analyst — phong cách: ${styleVi}.`;
    const first = await llmChat(role, { system: SYS, user, temperature: 0.3, maxTokens: prefs.depth === "deep" ? 1100 : 800 });
    if (first) {
      const use = await validateMaybeRepair(first, user, factNums, role);
      if (use.text) {
        finalAnswer = use.text;
        mode = "llm";
        model = first.model;
        outputValidation = use.validation;
      } else {
        outputValidation = use.validation;
      }
    }
  }

  /* risk disclosure prefs */
  if (prefs.riskDisclosure === "standard" && mode === "deterministic") {
    finalAnswer += "\n\n— Phân tích định lượng từ dữ liệu thật, phục vụ nghiên cứu; không phải khuyến nghị đầu tư.";
  } else if (prefs.riskDisclosure === "detailed") {
    finalAnswer += "\n\n— Lưu ý rủi ro: nội dung sinh ra từ dữ liệu realtime tại thờ điểm trả lờ, có thể đổi nhanh; hãy đối chiếu thanh khoản, khung thờ gian dài hơn và quản trị tỷ trọng trước khi hành động. Không phải khuyến nghị đầu tư.";
  }

  const dataFreshness = built.freshnesses.length ? worstFreshness(built.freshnesses) : built.unavailable ? "UNAVAILABLE" : "LIVE";
  const confidence = computeConfidence({ freshness: built.freshnesses, coverage: built.unavailable ? 0 : 1 });
  const meta = buildMeta({
    source: mode === "llm" ? `orca-agent + ${model}` : "orca-agent (deterministic)",
    sourceTimestampMs: Date.now(),
    note: built.sectionsUsed.length ? `Bối cảnh: ${built.sectionsUsed.join(", ")}${built.symbols.length ? ` | Mã: ${built.symbols.join(", ")}` : ""}` : undefined,
  });
  meta.freshness = dataFreshness;
  meta.outputValidation = outputValidation;
  meta.qualityStatus = built.unavailable ? "STALE" : "VALID";

  const result: AgentAnswer = {
    answer: finalAnswer,
    mode,
    intent: intent.kind,
    model,
    confidence,
    dataQuality: qualityToLabel(meta.qualityStatus),
    dataFreshness,
    context: { sectionsUsed: built.sectionsUsed, symbols: built.symbols },
  };
  return { result, meta };
}

async function validateMaybeRepair(
  first: LlmResult,
  user: string,
  facts: Set<number>,
  role: "reasoning" | "analysis",
): Promise<{ text: string | null; model: string; validation: Meta["outputValidation"] }> {
  let val = validateOutput(first.text, facts);
  if (val.ok) return { text: first.text, model: first.model, validation: { validated: true, unsupportedClaims: 0 } };
  const regen = await llmChat(role, {
    system: `${SYS}\nSTRICT: câu trả lờì trước chứa số không có trong context (${val.unsupported.slice(0, 5).map((u) => u.raw).join(", ")}). Chỉ trích số trong context.`,
    user,
    temperature: 0.2,
    maxTokens: 800,
  });
  if (!regen) return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic" } };
  val = validateOutput(regen.text, facts);
  if (val.ok) return { text: regen.text, model: first.model, validation: { validated: true, unsupportedClaims: 0, recovered: "regenerated" } };
  return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic-fallback" } };
}

/* keep env import used for future provider expansion */
export { env };

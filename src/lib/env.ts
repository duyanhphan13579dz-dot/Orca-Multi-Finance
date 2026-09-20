/**
 * Centralized, server-only environment configuration.
 * Secrets are NEVER exposed to the browser (no NEXT_PUBLIC_* usage here).
 */
import "server-only";

const opt = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/** Comma/semicolon-separated model list → unique non-empty ids */
function parseModelList(v: string | undefined): string[] {
  if (!v?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of v.split(/[,;]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const redisCandidate = opt(process.env.REDIS_URL) ?? opt(process.env.UPSTASH_REDIS_URL);
const redisIsTcp = Boolean(redisCandidate && /^rediss?:\/\//i.test(redisCandidate));
const redisNote = !redisCandidate
  ? undefined
  : redisIsTcp
    ? undefined
    : "Giá trị Redis được cấu hình không phải redis:// hoặc rediss:// (Upstash REST URL không dùng được với ioredis) — mirror Redis đang TẮT, cache chỉ chạy in-memory.";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  vnstockBaseUrl: opt(process.env.VNSTOCK_BASE_URL),
  vnstockApiKey: opt(process.env.VNSTOCK_API_KEY),

  vndirectBaseUrl: opt(process.env.VNDIRECT_BASE_URL) ?? "https://api-finfo.vndirect.com.vn",

  binanceBaseUrl: opt(process.env.BINANCE_BASE_URL),
  binanceFapiBaseUrl: opt(process.env.BINANCE_FAPI_BASE_URL),
  binanceApiKey: opt(process.env.BINANCE_API_KEY),

  biquoteBaseUrl: opt(process.env.BIQUOTE_BASE_URL),
  biquoteApiKey: opt(process.env.BIQUOTE_API_KEY),

  vietnambizBaseUrl: opt(process.env.VIETNAMBIZ_BASE_URL) ?? "https://vietnambiz.vn",
  simplizeBaseUrl: opt(process.env.SIMPLIZE_BASE_URL) ?? "https://api.simplize.vn",
  simplizeApiKey: opt(process.env.SIMPLIZE_API_KEY),

  msnCommodityMap: (() => {
    try {
      return process.env.MSN_COMMODITY_MAP
        ? (JSON.parse(process.env.MSN_COMMODITY_MAP) as Record<string, string>)
        : {};
    } catch {
      return {} as Record<string, string>;
    }
  })(),
  msnApiKey:
    opt(process.env.MSN_FINANCE_API_KEY) ??
    "0QfOX3Vn51YCzitbLaRkTTBadtWpgTN8NZLW0C1SEM",

  redisUrl: redisIsTcp ? redisCandidate : undefined,
  redisNote,
  jwtSecret: opt(process.env.JWT_SECRET) ?? "orca-dev-insecure-secret-change-in-production",

  openrouterApiKey: opt(process.env.OPENROUTER_API_KEY),
  openrouterModel: opt(process.env.OPENROUTER_MODEL),
  groqApiKey: opt(process.env.GROQ_API_KEY),
  groqBaseUrl: opt(process.env.GROQ_BASE_URL) ?? "https://api.groq.com/openai/v1",
  groqModel: opt(process.env.GROQ_MODEL),

  /** Resolved API key for OpenAI-compatible calls: OpenRouter → Groq */
  aiApiKey:
    opt(process.env.OPENROUTER_API_KEY) ??
    opt(process.env.GROQ_API_KEY),
  aiBaseUrl:
    opt(process.env.AI_BASE_URL) ??
    (opt(process.env.OPENROUTER_API_KEY) ? "https://openrouter.ai/api/v1" : undefined) ??
    "",
  aiModel:
    opt(process.env.OPENROUTER_MODEL) ??
    opt(process.env.AI_MODEL) ??
    opt(process.env.AI_MODEL_REPORT) ??
    "qwen/qwen3.8-27b:free",
  aiModelReasoning: opt(process.env.AI_MODEL_REASONING),
  aiModelReport: opt(process.env.AI_MODEL_REPORT),
  aiModelAnalysis: opt(process.env.AI_MODEL_ANALYSIS),

  aiModelAnalysisFallbacks: parseModelList(process.env.AI_MODEL_ANALYSIS_FALLBACKS),
  aiModelReportFallbacks: parseModelList(process.env.AI_MODEL_REPORT_FALLBACKS),
  aiModelReasoningFallbacks: parseModelList(process.env.AI_MODEL_REASONING_FALLBACKS),
  aiModelClassificationFallbacks: parseModelList(process.env.AI_MODEL_CLASSIFICATION_FALLBACKS),

  aiLlmFallbackBackend: (opt(process.env.AI_LLM_FALLBACK_BACKEND)?.toLowerCase() ?? "") as
    | "groq"
    | "none"
    | string,

  aiLlmMaxCascade: opt(process.env.AI_LLM_MAX_CASCADE) ?? "3",
  aiLlmCascadeMode: opt(process.env.AI_LLM_CASCADE_MODE) ?? "race",
};

export const isProd = env.nodeEnv === "production";

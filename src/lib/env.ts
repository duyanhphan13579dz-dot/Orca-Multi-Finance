/**
 * Centralized, server-only environment configuration.
 * Secrets are NEVER exposed to the browser (no NEXT_PUBLIC_* usage here).
 */
import "server-only";

const opt = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/* Redis (optional cache mirror).
   Hosts such as Netlify inject `UPSTASH_REDIS_URL` instead of `REDIS_URL`, so
   both names are accepted. ioredis speaks the Redis TCP wire protocol only: an
   Upstash *REST* endpoint (https://…) cannot be used by it, so a non-TCP value
   is reported through `redisNote` instead of being silently ignored. */
const redisCandidate = opt(process.env.REDIS_URL) ?? opt(process.env.UPSTASH_REDIS_URL);
const redisIsTcp = Boolean(redisCandidate && /^rediss?:\/\//i.test(redisCandidate));
const redisNote = !redisCandidate
  ? undefined
  : redisIsTcp
    ? undefined
    : "Giá trị Redis được cấu hình không phải redis:// hoặc rediss:// (Upstash REST URL không dùng được với ioredis) — mirror Redis đang TẮT, cache chỉ chạy in-memory.";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  /*
   * Vietnam stocks provider strategy:
   *   PRIMARY  = SSI Flashconnect (fc-data.ssi.com.vn) — market data: indices, board, quotes, OHLCV, universe
   *   FALLBACK = VNDirect (api-finfo) — khi SSI không cấu hình hoặc không phản hồi
   *   FINANCIAL = VNDirect giữ làm primary duy nhất cho báo cáo tài chính & phân tích cơ bản
   *     (SSI không nằm trong financial provider router — xem src/lib/financial/providers-registry.ts)
   * VNStock vars kept only for backward-compat env files; service layer no longer calls VNStock.
   */
  vnstockBaseUrl: opt(process.env.VNSTOCK_BASE_URL),
  vnstockApiKey: opt(process.env.VNSTOCK_API_KEY),

  vndirectBaseUrl: opt(process.env.VNDIRECT_BASE_URL) ?? "https://api-finfo.vndirect.com.vn",

  /* Crypto — Binance */
  binanceBaseUrl: opt(process.env.BINANCE_BASE_URL),
  binanceFapiBaseUrl: opt(process.env.BINANCE_FAPI_BASE_URL),
  binanceApiKey: opt(process.env.BINANCE_API_KEY),

  /* Forex — Biquote */
  biquoteBaseUrl: opt(process.env.BIQUOTE_BASE_URL),
  biquoteApiKey: opt(process.env.BIQUOTE_API_KEY),

  /* Commodities — Vietnambiz + Simplize */
  vietnambizBaseUrl: opt(process.env.VIETNAMBIZ_BASE_URL) ?? "https://vietnambiz.vn",
  simplizeBaseUrl: opt(process.env.SIMPLIZE_BASE_URL) ?? "https://api.simplize.vn",
  simplizeApiKey: opt(process.env.SIMPLIZE_API_KEY),

  /* Optional MSN Finance instrument map for world commodities (JSON: {"GOLD":"id",...}) */
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
    "0QfOX3Vn51YCzitbLaRkTTBadtWpgTN8NZLW0C1SEM", // public web key used by MSN frontend

  /* Platform */
  redisUrl: redisIsTcp ? redisCandidate : undefined,
  redisNote,
  jwtSecret: opt(process.env.JWT_SECRET) ?? "orca-dev-insecure-secret-change-in-production",

  /*
   * LLM — ưu tiên OpenRouter (OPENROUTER_API_KEY / OPENROUTER_MODEL).
   * Tương thích ngược: AI_PROVIDER_KEY, AI_MODEL, AI_BASE_URL.
   * Phân vai:
   *   reasoning → AI_MODEL_REASONING → OPENROUTER_MODEL → AI_MODEL
   *   analysis / report → AI_MODEL_REPORT → AI_MODEL_ANALYSIS → OPENROUTER_MODEL → AI_MODEL
   * Groq (GROQ_*) giữ cho task tốc độ cao nếu được gọi riêng sau này.
   */
  openrouterApiKey: opt(process.env.OPENROUTER_API_KEY),
  openrouterModel: opt(process.env.OPENROUTER_MODEL),
  groqApiKey: opt(process.env.GROQ_API_KEY),
  groqBaseUrl: opt(process.env.GROQ_BASE_URL) ?? "https://api.groq.com/openai/v1",
  groqModel: opt(process.env.GROQ_MODEL),

  aiProviderKey:
    opt(process.env.OPENROUTER_API_KEY) ??
    opt(process.env.AI_PROVIDER_KEY) ??
    opt(process.env.GROQ_API_KEY),
  aiBaseUrl:
    opt(process.env.AI_BASE_URL) ??
    (opt(process.env.OPENROUTER_API_KEY) ? "https://openrouter.ai/api/v1" : undefined) ??
    "",
  aiModel:
    opt(process.env.OPENROUTER_MODEL) ??
    opt(process.env.AI_MODEL) ??
    opt(process.env.AI_MODEL_REPORT) ??
    "qwen/qwen3-32b",
  aiModelReasoning: opt(process.env.AI_MODEL_REASONING),
  aiModelReport: opt(process.env.AI_MODEL_REPORT),
  aiModelAnalysis: opt(process.env.AI_MODEL_ANALYSIS),
};

export const isProd = env.nodeEnv === "production";

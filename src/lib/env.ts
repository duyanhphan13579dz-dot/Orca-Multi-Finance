/**
 * Centralized, server-side environment configuration.
 * Secrets are NEVER exposed to the browser (no NEXT_PUBLIC_* usage here).
 */
import "server-only";

const opt = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/** The built-in fallback secret MUST never be used outside development. */
export const INSECURE_JWT_SECRET = "orca-dev-insecure-secret-change-in-production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  /* Vietnam stocks — official provider per product spec */
  vnstockBaseUrl: opt(process.env.VNSTOCK_BASE_URL) ?? "https://api.vnstock.com",
  vnstockApiKey: opt(process.env.VNSTOCK_API_KEY),

  /* Crypto — Binance */
  binanceBaseUrl: opt(process.env.BINANCE_BASE_URL),
  binanceFapiBaseUrl: opt(process.env.BINANCE_FAPI_BASE_URL),
  binanceApiKey: opt(process.env.BINANCE_API_KEY), // only needed for private endpoints

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
      return process.env.MSN_COMMODITY_MAP ? (JSON.parse(process.env.MSN_COMMODITY_MAP) as Record<string, string>) : {};
    } catch {
      return {} as Record<string, string>;
    }
  })(),
  msnApiKey:
    opt(process.env.MSN_FINANCE_API_KEY) ??
    "0QfOX3Vn51YCzitbLaRkTTBadtWpgTN8NZLW0C1SEM", // public web key used by MSN frontend

  /* Platform */
  redisUrl: opt(process.env.REDIS_URL),
  jwtSecret: opt(process.env.JWT_SECRET) ?? INSECURE_JWT_SECRET,

  /* Optional LLM for the AI Agent (OpenAI-compatible) */
  aiProviderKey: opt(process.env.AI_PROVIDER_KEY),
  aiBaseUrl: opt(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1",
  aiModel: opt(process.env.AI_MODEL) ?? "gpt-4o-mini",
};

export const isProd = env.nodeEnv === "production";

/**
 * Fail loudly instead of silently shipping a guessable JWT secret.
 * Returns an error message when the runtime config is unsafe, null otherwise.
 */
export function assertSecureEnv(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!opt(process.env.JWT_SECRET)) return "JWT_SECRET bắt buộc trong production (đang dùng fallback dev-insecure).";
  if ((process.env.JWT_SECRET ?? "").length < 32) return "JWT_SECRET phải dài tối thiểu 32 ký tự trong production.";
  return null;
}

/** True when auth is currently backed by the dev fallback secret. */
export function usingInsecureJwtSecret(): boolean {
  return env.jwtSecret === INSECURE_JWT_SECRET;
}

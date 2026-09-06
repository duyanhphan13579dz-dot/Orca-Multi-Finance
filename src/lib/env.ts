/**
 * Centralized, server-side environment configuration.
 * Secrets are NEVER exposed to the browser (no NEXT_PUBLIC_* usage here).
 */
import "server-only";

const opt = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/** Parse a bounded integer env (ms) with a safe default; never NaN/negative. */
export function parseBoundedIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw?.trim());
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** The built-in fallback secret MUST never be used outside development. */
export const INSECURE_JWT_SECRET = "orca-dev-insecure-secret-change-in-production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  /* Vietnam stocks — VNDirect finfo (keyless public REST; env-overridable base) */
  vndirectBaseUrl: opt(process.env.VNDIRECT_BASE_URL),

  /* Crypto — Binance */
  binanceBaseUrl: opt(process.env.BINANCE_BASE_URL),
  binanceFapiBaseUrl: opt(process.env.BINANCE_FAPI_BASE_URL),
  binanceApiKey: opt(process.env.BINANCE_API_KEY), // only needed for private endpoints

  /* Forex — Biquote */
  biquoteBaseUrl: opt(process.env.BIQUOTE_BASE_URL),
  biquoteApiKey: opt(process.env.BIQUOTE_API_KEY),

  /* Commodities — VietnamBiz Data DUY NHẤT (data.vietnambiz.vn/goods).
   * Simplize đã bỏ khỏi flow hàng hóa (directive 2026-09-06); các biến Simplize
   * còn dùng cho VN STOCK provider chain (ngoài phạm vi commodity). */
  vietnambizBaseUrl: opt(process.env.VIETNAMBIZ_BASE_URL) ?? "https://vietnambiz.vn",
  /** VietnamBiz Data portal (WiFeed/WiGroup) — goods/macro/rates tables (user-provided 2026-09-06) */
  vietnambizDataBaseUrl: opt(process.env.VIETNAMBIZ_DATA_BASE_URL) ?? "https://data.vietnambiz.vn",
  simplizeBaseUrl: opt(process.env.SIMPLIZE_BASE_URL) ?? "https://simplize.vn",
  simplizeApiKey: opt(process.env.SIMPLIZE_API_KEY),
  /** Snapshot cadence cho commodity quotes (user-mandated 3s polling; floor 2s).
   *  Nguồn WiFeed cập nhật theo ngày — cache dữ liệu 3 phút (xem vietnambiz-data). */
  commoditySnapshotTtlMs: parseBoundedIntEnv(process.env.COMMODITY_SNAPSHOT_TTL_MS, 3_000, 2_000, 300_000),
  /** WiFeed /goods chỉ refresh 1 lần/ngày (00:00) — cache parse 6h mặc định (30s..24h) */
  vnbDataTtlMs: parseBoundedIntEnv(process.env.VNB_DATA_TTL_MS, 6 * 3_600_000, 30_000, 24 * 3_600_000),

  /* Vietnam stocks — provider chain (Phase 10 SAFE FALLBACK).
   * Default: VNDirect primary; Simplize = candidate embed-only cho tới khi
   * có giấy phép API bằng văn bản (xem docs/simplize-vn-audit.md). */
  simplizeDataAccess: opt(process.env.SIMPLIZE_DATA_ACCESS) ?? "none", // none | api-partner | approved-api
  /** optional: template chứa {symbol} (+{timeframe}) cho widget embed đã xác minh */
  simplizeWidgetUrlTemplate: opt(process.env.SIMPLIZE_WIDGET_URL_TEMPLATE),
  /** provider order: "vndirect,simplize" (vndirect luôn primary hiện tại) */
  vnProviderOrder: opt(process.env.VN_PROVIDER_ORDER) ?? "vndirect,simplize",

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

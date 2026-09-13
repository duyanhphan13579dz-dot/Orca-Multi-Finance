/**
 * Centralized, server-only environment configuration.
 *
 * SINGLE SOURCE OF TRUTH for `process.env`: every other module reads typed
 * values off `env` instead of touching `process.env` directly, so defaults,
 * trimming and boolean parsing live in exactly one place.
 * Secrets are NEVER exposed to the browser (no NEXT_PUBLIC_* usage here).
 */
import "server-only";

const opt = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/** Base URLs are always consumed without a trailing slash. */
const stripSlash = (v: string): string => v.replace(/\/$/, "");

/** `X=true` (case-sensitive, matching the historical `=== "true"` checks). */
const flag = (v: string | undefined): boolean => opt(v) === "true";

/** Positive integer or fallback — guards against `Number("")`/`Number("abc")`. */
const intOr = (v: string | undefined, fallback: number): number => {
  const n = Number(opt(v));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** `(X ?? "true") !== "false"` — opt-in-by-default switches. */
const onUnlessFalse = (v: string | undefined): boolean => (opt(v) ?? "true") !== "false";

/**
 * DEFAULT LLM MODEL — hằng duy nhất cho toàn hệ thống.
 *
 * gateway.ts (modelFor) và services/agent.ts đều tham chiếu hằng này; KHÔNG nơi
 * nào được hardcode model id nữa, nếu không default sẽ lại trôi nhau.
 *
 * Vì sao `openai/gpt-oss-120b`: đây là model đã kiểm chứng có mặt trên **cả**
 * OpenRouter lẫn Groq. AI Agent gọi song song hai backend đó (services/agent.ts
 * → primaryBackend/secondaryBackend), nên default bắt buộc phải sống được ở cả
 * hai — `qwen/qwen3-32b` chẳng hạn chỉ có trên OpenRouter.
 *
 * Đổi model mặc định = sửa đúng một dòng này.
 */
export const DEFAULT_LLM_MODEL = "openai/gpt-oss-120b";

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

/* ==========================================================================
 * SSI FastConnect — PRIMARY provider cho market data VN.
 * Credential pairs (first non-empty wins):
 *   1. SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET   (canonical)
 *   2. SSI_API_KEY / SSI_API_SECRET                  (Vercel aliases)
 *   3. SSI_CONSUMER_ID / SSI_CONSUMER_SECRET
 * ========================================================================== */
const ssiId =
  opt(process.env.SSI_FC_CONSUMER_ID) ??
  opt(process.env.SSI_API_KEY) ??
  opt(process.env.SSI_CONSUMER_ID);
const ssiSecret =
  opt(process.env.SSI_FC_CONSUMER_SECRET) ??
  opt(process.env.SSI_API_SECRET) ??
  opt(process.env.SSI_CONSUMER_SECRET);

const sscPortalUrl = stripSlash(
  opt(process.env.SSC_PORTAL_URL) ?? "https://congbothongtin.ssc.gov.vn",
);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  /* ---------------------------- Platform / hosting --------------------------- */

  /* Đọc ở đây nhưng Pool vẫn khởi tạo LƯỜI trong src/db/index.ts — `next build`
     không được chết khi host không inject DATABASE_URL vào build environment. */
  databaseUrl: opt(process.env.DATABASE_URL),
  vercelUrl: opt(process.env.VERCEL_URL),
  cronSecret: opt(process.env.CRON_SECRET),

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

  vndirectBaseUrl: stripSlash(
    opt(process.env.VNDIRECT_BASE_URL) ?? "https://api-finfo.vndirect.com.vn",
  ),

  /* ---------------------- SSI FastConnect (REST + DataHub WS) ----------------- */
  ssiConsumerId: ssiId,
  ssiConsumerSecret: ssiSecret,
  ssiConfigured: Boolean(ssiId && ssiSecret),
  ssiFcDataBaseUrl: stripSlash(
    opt(process.env.SSI_FC_DATA_BASE_URL) ?? "https://fc-data.ssi.com.vn",
  ),
  ssiFcHubUrl: stripSlash(
    opt(process.env.SSI_FC_HUB_URL) ?? "https://fc-datahub.ssi.com.vn/v2.0",
  ),
  /** Serverless host không giữ được WS → tắt engine, REST polling vẫn chạy. */
  ssiWsDisabled: flag(process.env.SSI_WS_DISABLED),
  /** `SSI_WS_PROTOCOL=signalr` chọn transport SignalR thay vì WS thuần. */
  ssiWsUseSignalR: opt(process.env.SSI_WS_PROTOCOL) === "signalr",
  /** Preload VN30 + mã thanh khoản khi stream All được cấp (mặc định BẬT). */
  ssiWsPreload: onUnlessFalse(process.env.SSI_WS_PRELOAD),

  /* Crypto — Binance */
  binanceBaseUrl: opt(process.env.BINANCE_BASE_URL),
  binanceFapiBaseUrl: opt(process.env.BINANCE_FAPI_BASE_URL),
  binanceApiKey: opt(process.env.BINANCE_API_KEY),

  /* Binance WebSocket engine */
  binanceWsDisabled: flag(process.env.BINANCE_WS_DISABLED),
  binanceWsSpotUrl:
    opt(process.env.BINANCE_WS_SPOT_URL) ??
    "wss://stream.binance.com:9443/stream?streams=!ticker@arr",
  binanceWsFutUrl:
    opt(process.env.BINANCE_WS_FUT_URL) ??
    "wss://fstream.binance.com/stream?streams=!markPrice@arr",
  binanceWsKlineUrl: opt(process.env.BINANCE_WS_KLINE_URL) ?? "wss://stream.binance.com:9443/ws",
  binanceWsMaxKlines: intOr(process.env.BINANCE_WS_MAX_KLINES, 48),

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
        : {} as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  })(),
  /** Raw string — để ops báo "đã set biến" kể cả khi JSON không parse được. */
  msnCommodityMapRaw: opt(process.env.MSN_COMMODITY_MAP),
  msnApiKey:
    opt(process.env.MSN_FINANCE_API_KEY) ??
    "0QfOX3Vn51YCzitbLaRkTTBadtWpgTN8NZLW0C1SEM", // public web key used by MSN frontend

  /* ---------------------- SSC / official filings (congbothongtin) ------------- */
  sscPortalUrl,
  sscNewsSearchUrl: opt(process.env.SSC_NEWS_SEARCH_URL) ?? `${sscPortalUrl}/faces/NewsSearch`,
  /** `SSC_HEADLESS=1|true` bật Playwright scrape (pdf/ticker coverage đầy đủ). */
  sscHeadless: ["1", "true"].includes(opt(process.env.SSC_HEADLESS) ?? ""),
  sscHttpUa:
    opt(process.env.SSC_HTTP_UA) ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  /** Optional JSON adapters (HOSE/HNX/custom IR) — channel nào có URL thì được probe. */
  officialPortals: [
    { channel: "ssc_ids", url: opt(process.env.SSC_IDS_BASE_URL) },
    { channel: "hose_disclosure", url: opt(process.env.HOSE_DISCLOSURE_URL) },
    { channel: "hnx_disclosure", url: opt(process.env.HNX_DISCLOSURE_URL) },
    { channel: "company_ir", url: opt(process.env.COMPANY_IR_BASE_URL) },
  ] as { channel: string; url: string | undefined }[],

  /* ----------------------------- Report scheduler ---------------------------- */
  reportAutoDaily: onUnlessFalse(process.env.REPORT_AUTO_DAILY),
  reportMorningTime: opt(process.env.REPORT_MORNING_TIME) ?? "08:15",
  reportSummaryTime: opt(process.env.REPORT_SUMMARY_TIME) ?? "15:45",
  commoditiesAutoDaily: onUnlessFalse(process.env.COMMODITIES_AUTO_DAILY),
  commoditiesRefreshTime: opt(process.env.COMMODITIES_REFRESH_TIME) ?? "07:30",

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
  /** `AI_PROVIDER_KEY` thô, KHÔNG fallback — chỉ để /api/v1/system/llm báo
      "biến này có được set hay không" (cờ `llmConfigured` dùng `llmConfigured()`
      của gateway, không dùng field này). */
  aiProviderKeyRaw: opt(process.env.AI_PROVIDER_KEY),
  aiBaseUrl:
    opt(process.env.AI_BASE_URL) ??
    (opt(process.env.OPENROUTER_API_KEY) ? "https://openrouter.ai/api/v1" : undefined) ??
    "",
  aiModel:
    opt(process.env.OPENROUTER_MODEL) ??
    opt(process.env.AI_MODEL) ??
    opt(process.env.AI_MODEL_REPORT) ??
    DEFAULT_LLM_MODEL,
  aiModelReasoning: opt(process.env.AI_MODEL_REASONING),
  aiModelReport: opt(process.env.AI_MODEL_REPORT),
  aiModelAnalysis: opt(process.env.AI_MODEL_ANALYSIS),
};

export const isProd = env.nodeEnv === "production";

import "server-only";
import { isCircuitOpen, recordFailure, recordSuccess } from "./health";

/**
 * Resilient HTTP client for all outbound provider traffic.
 * timeout + retry with exponential backoff + circuit breaker + health recording.
 *
 * Domain timeouts (fail-fast, tuned for realtime screeners):
 *  quote ~3.2s · ohlcv/dchart ~4.5s · financials ~7s · default 7s
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Soft domain budgets for callers that want a semantic default. */
export const DOMAIN_TIMEOUT_MS = {
  quote: 3_200,
  ohlcv: 4_500,
  indices: 4_000,
  financials: 7_000,
  orderbook: 3_500,
  foreign: 4_000,
  news: 7_000,
  crypto: 6_000,
  forex: 5_000,
  commodities: 8_000,
  default: 7_000,
} as const;

export type DomainTimeoutKey = keyof typeof DOMAIN_TIMEOUT_MS;

/**
 * Per-provider defaults when timeoutMs is omitted.
 * Keep these ≤ domain budgets so multi-source races stay within hardStop.
 */
const PROVIDER_TIMEOUT_MS: Record<string, number> = {
  vndirect: 3_800,
  "vndirect-dchart": 4_500,
  "vndirect-company": 4_000,
  "vndirect-foreign": 4_000,
  "ssi-fcdata": 4_500,
  "ssi-iboard": 4_000,
  vps: 4_000,
  vietcap: 4_000,
  "public-vn": 4_000,
  entrade: 5_000,
  binance: 6_000,
  "binance-fapi": 6_000,
  biquote: 4_000,
  yahoo: 4_200,
  "yahoo-fx": 4_200,
  simplize: 6_000,
  vietnambiz: 8_000,
  msn: 8_000,
  exchangerate: 5_000,
  frankfurter: 5_000,
};

export function resolveProviderTimeout(provider: string, explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const exact = PROVIDER_TIMEOUT_MS[provider];
  if (exact != null) return exact;
  const lower = provider.toLowerCase();
  for (const [k, v] of Object.entries(PROVIDER_TIMEOUT_MS)) {
    if (lower.includes(k) || lower.startsWith(k)) return v;
  }
  return DOMAIN_TIMEOUT_MS.default;
}

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  text: string | null;
  error: string | null;
  latencyMs: number;
  attempts: number;
}

interface HttpOptions {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit | null;
  parse?: "json" | "text";
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpJson<T = unknown>(url: string, opts: HttpOptions): Promise<HttpResult<T>> {
  return httpRequest<T>(url, { ...opts, parse: "json" });
}

export async function httpText(url: string, opts: HttpOptions): Promise<HttpResult<never>> {
  return httpRequest<never>(url, { ...opts, parse: "text" });
}

/**
 * Gộp các GET giống hệt đang chạy cùng lúc (cùng provider + url + header) thành một lượt gọi upstream.
 * Trang dashboard thường gọi cùng một nguồn từ nhiều service song song → giảm tải và độ trễ.
 */
const inflightGets = new Map<string, Promise<HttpResult<unknown>>>();

function httpRequest<T>(url: string, opts: HttpOptions): Promise<HttpResult<T>> {
  const method = (opts.method ?? "GET").toUpperCase();
  if (method !== "GET" || opts.body) return httpRequestOnce<T>(url, opts);
  const key = `${opts.provider}|${opts.parse ?? "json"}|${url}|${JSON.stringify(opts.headers ?? {})}`;
  const existing = inflightGets.get(key);
  if (existing) return existing as Promise<HttpResult<T>>;
  const p = httpRequestOnce<T>(url, opts).finally(() => inflightGets.delete(key));
  inflightGets.set(key, p as Promise<HttpResult<unknown>>);
  return p;
}

/** 4xx do yêu cầu sai/không tồn tại (mã không có dữ liệu…) không phải lỗi của provider → không tính vào circuit breaker. */
const CLIENT_ERRORS_NOT_COUNTED = new Set([400, 404, 410, 422]);
/** Lỗi tạm thời đáng thử lại. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function retryDelayMs(res: Response, attempt: number, backoffBase: number): number {
  const ra = Number(res.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return Math.min(2_000, ra * 1_000);
  return backoffBase * 2 ** attempt + Math.random() * 80;
}

async function httpRequestOnce<T>(url: string, opts: HttpOptions): Promise<HttpResult<T>> {
  const provider = opts.provider;
  const timeoutMs = resolveProviderTimeout(provider, opts.timeoutMs);
  // Default 1 retry for transient blips (502/503/429/network reset); callers can pass retries: 0 for strict fail-fast
  const retries = opts.retries ?? 1;
  const backoffBase = opts.backoffBaseMs ?? 180;

  if (isCircuitOpen(provider)) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: null,
      error: `circuit_open:${provider}`,
      latencyMs: 0,
      attempts: 0,
    };
  }

  let lastError = "unknown";
  let lastStatus = 0;
  const started = performance.now();
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      lastError = "aborted";
      break;
    }
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
          ...(opts.headers ?? {}),
        },
        body: opts.body ?? undefined,
        signal,
        cache: "no-store",
      });
      lastStatus = res.status;
      // Timeout bao cả lúc đọc body (trước đây chỉ bao headers → body treo sẽ chặn vô hạn).
      const text = await res.text();
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `http_${res.status}`;
        const retryable = attempt < retries && RETRYABLE_STATUS.has(res.status);
        if (!CLIENT_ERRORS_NOT_COUNTED.has(res.status) && !retryable) recordFailure(provider, lastError);
        if (retryable) {
          await sleep(retryDelayMs(res, attempt, backoffBase));
          continue;
        }
        if (res.status >= 500 && attempt < retries) {
          await sleep(backoffBase * 2 ** attempt + Math.random() * 80);
          continue;
        }
        return {
          ok: false,
          status: res.status,
          data: null,
          text,
          error: lastError,
          latencyMs: Math.round(performance.now() - started),
          attempts,
        };
      }
      let data: T | null = null;
      if (opts.parse === "text") {
        data = null;
      } else {
        try {
          data = text ? (JSON.parse(text) as T) : null;
        } catch {
          lastError = "json_parse";
          recordFailure(provider, lastError);
          return {
            ok: false,
            status: res.status,
            data: null,
            text,
            error: lastError,
            latencyMs: Math.round(performance.now() - started),
            attempts,
          };
        }
      }
      recordSuccess(provider, Math.round(performance.now() - started));
      return {
        ok: true,
        status: res.status,
        data,
        text,
        error: null,
        latencyMs: Math.round(performance.now() - started),
        attempts,
      };
    } catch (e) {
      clearTimeout(timer);
      if (opts.signal?.aborted) {
        lastError = "aborted";
        break;
      }
      lastError =
        e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "network_error";
      if (attempt < retries) {
        await sleep(backoffBase * 2 ** attempt + Math.random() * 100);
        continue;
      }
      recordFailure(provider, lastError);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    data: null,
    text: null,
    error: lastError,
    latencyMs: Math.round(performance.now() - started),
    attempts,
  };
}

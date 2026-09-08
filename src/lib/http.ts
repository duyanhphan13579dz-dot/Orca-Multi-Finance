import "server-only";
import { isCircuitOpen, recordFailure, recordSuccess } from "./health";

/**
 * Resilient HTTP client for all outbound provider traffic.
 * timeout + retry with exponential backoff + circuit breaker + health recording.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
  /** when true, a non-2xx status still resolves ok:false without throwing */
  parse?: "json" | "text";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpJson<T = unknown>(url: string, opts: HttpOptions): Promise<HttpResult<T>> {
  return httpRequest<T>(url, { ...opts, parse: "json" });
}

export async function httpText(url: string, opts: HttpOptions): Promise<HttpResult<never>> {
  return httpRequest<never>(url, { ...opts, parse: "text" });
}

async function httpRequest<T>(url: string, opts: HttpOptions): Promise<HttpResult<T>> {
  const provider = opts.provider;
  // Tighten defaults: 6s timeout + 1 retry is faster failover than 9s + 2 retries (27s worst)
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const retries = opts.retries ?? 1;
  const backoffBase = opts.backoffBaseMs ?? 300;

  if (isCircuitOpen(provider)) {
    return { ok: false, status: 0, data: null, text: null, error: `circuit_open:${provider}`, latencyMs: 0, attempts: 0 };
  }

  let lastError = "unknown";
  let lastStatus = 0;
  const started = performance.now();
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { "User-Agent": DEFAULT_UA, Accept: "application/json,text/plain,*/*", ...(opts.headers ?? {}) },
        body: opts.body ?? null,
        signal: controller.signal,
        cache: "no-store",
      });
      const latencyMs = performance.now() - started;
      lastStatus = res.status;
      if (!res.ok) {
        lastError = `http_${res.status}`;
        if (res.status === 429 || res.status >= 500) {
          recordFailure(provider, `${lastError} ${url}`);
          const retryAfter = Number(res.headers.get("retry-after") ?? 0);
          clearTimeout(timer);
          if (attempt < retries) await sleep(Math.max(backoffBase * 2 ** attempt, retryAfter * 1000) + Math.random() * 200);
          continue;
        }
        recordFailure(provider, `${lastError} ${url}`);
        const text = await safeText(res);
        return { ok: false, status: res.status, data: null, text, error: lastError, latencyMs, attempts };
      }
      recordSuccess(provider, latencyMs);
      if (opts.parse === "text") {
        const text = await res.text();
        return { ok: true, status: res.status, data: null, text, error: null, latencyMs, attempts };
      }
      const text = await res.text();
      try {
        const data = JSON.parse(text) as T;
        return { ok: true, status: res.status, data, text, error: null, latencyMs, attempts };
      } catch {
        recordFailure(provider, `invalid_json ${url}`);
        return { ok: false, status: res.status, data: null, text, error: "invalid_json", latencyMs, attempts };
      }
    } catch (e) {
      lastError = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "network_error";
      recordFailure(provider, `${lastError} ${url}`);
      if (attempt < retries) await sleep(backoffBase * 2 ** attempt + Math.random() * 200);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus, data: null, text: null, error: lastError, latencyMs: performance.now() - started, attempts };
}

async function safeText(res: Response): Promise<string | null> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return null;
  }
}

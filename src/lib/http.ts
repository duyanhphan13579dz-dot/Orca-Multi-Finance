import "server-only";
import { isCircuitOpen, recordFailure, recordSuccess } from "./health";

/**
 * Resilient HTTP client for all outbound provider traffic.
 * timeout + retry with exponential backoff + circuit breaker + health recording.
 *
 * Resilience defaults: timeout 10s, retries 2 — multi-source callers may override per provider.
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
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const backoffBase = opts.backoffBaseMs ?? 280;

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
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/json, text/plain, */*",
          ...(opts.headers ?? {}),
        },
        body: opts.body ?? undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      lastStatus = res.status;
      const text = await res.text();
      if (!res.ok) {
        lastError = `http_${res.status}`;
        recordFailure(provider, lastError);
        if (attempt < retries && res.status >= 500) {
          await sleep(backoffBase * 2 ** attempt + Math.random() * 120);
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
      lastError =
        e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "network_error";
      if (attempt < retries) {
        await sleep(backoffBase * 2 ** attempt + Math.random() * 150);
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

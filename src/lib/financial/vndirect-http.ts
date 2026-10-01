import "server-only";
import { httpJson } from "../http";

const DEFAULT_BASE = "https://api-finfo.vndirect.com.vn";
const DEFAULT_FALLBACKS = ["https://finfo-api.vndirect.com.vn"];

function uniqueBases(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\/$/, "")).filter(Boolean))];
}

/**
 * Resolve financial API hosts once per call. An explicitly configured primary
 * is respected on its own unless operators also configure fallback hosts; this
 * avoids silently sending test/proxy traffic to a public endpoint.
 */
export function getVndirectFinancialBases(): string[] {
  const configuredPrimary = process.env.VNDIRECT_BASE_URL?.trim();
  const primary = configuredPrimary || DEFAULT_BASE;
  const configuredFallbacks = (process.env.VNDIRECT_FALLBACK_BASE_URLS ?? "")
    .split(/[;,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const fallbacks = configuredFallbacks.length
    ? configuredFallbacks
    : configuredPrimary
      ? []
      : DEFAULT_FALLBACKS;
  return uniqueBases([primary, ...fallbacks]);
}

export interface VndirectJsonOptions<T> {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Treat a syntactically valid but structurally empty response as a failed host. */
  accept?: (payload: T) => boolean;
}

export interface VndirectJsonResult<T> {
  data: T;
  baseUrl: string;
  latencyMs: number;
}

/**
 * Small failover client shared by statement/ratio/profile adapters. It keeps
 * the provider's normal circuit/latency instrumentation through httpJson while
 * rotating to the secondary host only when the primary request is unusable.
 */
export async function vndirectJson<T>(
  path: string,
  options: VndirectJsonOptions<T>,
): Promise<VndirectJsonResult<T>> {
  const bases = getVndirectFinancialBases();
  const started = performance.now();
  const errors: string[] = [];

  for (const baseUrl of bases) {
    const result = await httpJson<T>(`${baseUrl}${path}`, {
      provider: options.provider,
      timeoutMs: options.timeoutMs,
      retries: options.retries ?? 1,
      backoffBaseMs: 180,
      headers: options.headers,
    });
    if (result.ok && result.data != null && (options.accept?.(result.data) ?? true)) {
      return {
        data: result.data,
        baseUrl,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    let host = baseUrl;
    try {
      host = new URL(baseUrl).host;
    } catch {
      // Keep a bounded identifier for a malformed override; do not abort failover.
      host = baseUrl.slice(0, 80);
    }
    errors.push(`${host}:${result.error ?? "empty_payload"}`);
  }

  throw new Error(`${options.provider}: all VNDirect hosts failed (${errors.join(", ") || "no host"})`);
}

import "server-only";
import { recordFailure, recordSuccess } from "./health";

/**
 * Network latency monitor — active RTT probes to critical market hosts.
 * Complements passive latency from http.ts (which only records when business
 * code already calls a provider). This module *always* measures path health
 * so ops can see "is the network path up?" independent of app traffic.
 */

export type LatencyProbeTarget = {
  id: string;
  label: string;
  domain: "vn-stock" | "global" | "infra" | "news";
  url: string;
};

export type ProbeResult = {
  id: string;
  label: string;
  domain: LatencyProbeTarget["domain"];
  host: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  error: string | null;
  probedAt: string;
};

export type NetworkLatencyReport = {
  results: ProbeResult[];
  summary: {
    total: number;
    ok: number;
    fail: number;
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    slowest: { id: string; latencyMs: number } | null;
  };
  probedAt: string;
  durationMs: number;
};

export const DEFAULT_TARGETS: LatencyProbeTarget[] = [
  {
    id: "vps-datafeed",
    label: "VPS public datafeed",
    domain: "vn-stock",
    url: "https://bgapidatafeed.vps.com.vn/getliststockdata/VCB",
  },
  {
    id: "vndirect-finfo",
    label: "VNDirect Finfo API",
    domain: "vn-stock",
    url: "https://api-finfo.vndirect.com.vn/v4/indexes?q=code:VNINDEX&size=1",
  },
  {
    id: "entrade-chart",
    label: "Entrade chart API",
    domain: "vn-stock",
    url: "https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=1700000000&to=1700100000&symbol=VCB&resolution=1D",
  },
  {
    id: "ssi-iboard",
    label: "SSI iBoard query",
    domain: "vn-stock",
    url: "https://iboard-query.ssi.com.vn/stock/exchange/hose",
  },
  {
    id: "yahoo-chart",
    label: "Yahoo Finance chart",
    domain: "global",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EVNINDEX?interval=1d&range=5d",
  },
  {
    id: "binance-api",
    label: "Binance public API",
    domain: "global",
    url: "https://api.binance.com/api/v3/ping",
  },
  {
    id: "cafef-rss",
    label: "CafeF market RSS",
    domain: "news",
    url: "https://cafef.vn/thi-truong-chung-khoan.rss",
  },
  {
    id: "vietnambiz-goods",
    label: "VietnamBiz goods (HTML)",
    domain: "vn-stock",
    url: "https://data.vietnambiz.vn/goods",
  },
  {
    id: "vietnambiz-goods-json",
    label: "VietnamBiz goods (Next data)",
    domain: "vn-stock",
    url: "https://data.vietnambiz.vn/_next/data/4rZHofl9s0ftfNuzY0Phf/goods.json",
  },
];

const CACHE_TTL_MS = 12_000;
let cached: { at: number; report: NetworkLatencyReport } | null = null;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

async function probeOne(t: LatencyProbeTarget, timeoutMs: number): Promise<ProbeResult> {
  const started = performance.now();
  const probedAt = new Date().toISOString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(t.url, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "*/*", "User-Agent": "Orca-Network-Probe/1.0" },
    });
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore */
    }
    const latencyMs = Math.round(performance.now() - started);
    const ok = res.status > 0 && res.status < 500;
    if (ok) recordSuccess(`net:${t.id}`, latencyMs, t.domain);
    else recordFailure(`net:${t.id}`, `http_${res.status}`, t.domain);
    return {
      id: t.id,
      label: t.label,
      domain: t.domain,
      host: hostOf(t.url),
      ok,
      latencyMs,
      statusCode: res.status,
      error: ok ? null : `http_${res.status}`,
      probedAt,
    };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    const msg = e instanceof Error ? e.message : String(e);
    const short = msg.includes("abort") || msg.includes("Abort") ? "timeout" : msg.slice(0, 120);
    recordFailure(`net:${t.id}`, short, t.domain);
    return {
      id: t.id,
      label: t.label,
      domain: t.domain,
      host: hostOf(t.url),
      ok: false,
      latencyMs,
      statusCode: null,
      error: short,
      probedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeNetworkLatency(opts?: {
  timeoutMs?: number;
  force?: boolean;
  targets?: LatencyProbeTarget[];
}): Promise<NetworkLatencyReport> {
  const timeoutMs = opts?.timeoutMs ?? 4_500;
  const force = opts?.force ?? false;
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.report;
  }

  const targets = opts?.targets ?? DEFAULT_TARGETS;
  const t0 = performance.now();
  const results = await Promise.all(targets.map((t) => probeOne(t, timeoutMs)));
  const durationMs = Math.round(performance.now() - t0);

  const okLatencies = results
    .filter((r) => r.ok && r.latencyMs != null)
    .map((r) => r.latencyMs as number)
    .sort((a, b) => a - b);

  const avgMs = okLatencies.length
    ? Math.round(okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length)
    : null;

  let slowest: NetworkLatencyReport["summary"]["slowest"] = null;
  for (const r of results) {
    if (r.ok && r.latencyMs != null) {
      if (!slowest || r.latencyMs > slowest.latencyMs) slowest = { id: r.id, latencyMs: r.latencyMs };
    }
  }

  const report: NetworkLatencyReport = {
    results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      avgMs,
      p50Ms: percentile(okLatencies, 50),
      p95Ms: percentile(okLatencies, 95),
      slowest,
    },
    probedAt: new Date().toISOString(),
    durationMs,
  };
  cached = { at: Date.now(), report };
  return report;
}

export function getLastNetworkLatency(): NetworkLatencyReport | null {
  return cached?.report ?? null;
}

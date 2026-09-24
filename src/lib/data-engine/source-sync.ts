import "server-only";
import { getProviderHealth, isCircuitOpen, recordFailure, recordSuccess } from "../health";
import { SOURCE_CATALOG, type SourceDomain } from "./catalog";
import { rankSourceIds } from "./resilience";

/**
 * Source synchronization layer:
 * - lightweight parallel RTT probes for catalog primaries/fallbacks
 * - latency ranking cached briefly in-process
 * - ordered route lists consumed by hub getters
 */

export type SyncProbe = {
  id: string;
  domain: SourceDomain;
  role: string;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  circuitOpen: boolean;
};

export type SourceSyncReport = {
  probedAt: string;
  durationMs: number;
  probes: SyncProbe[];
  /** domain → ordered source ids (fastest healthy first) */
  routes: Record<string, string[]>;
  summary: {
    total: number;
    ok: number;
    fail: number;
    openCircuits: number;
  };
};

/** Probe endpoints keyed by catalog source id (best-effort, public GETs). */
const PROBE_URL: Partial<Record<string, string>> = {
  vndirect: "https://api-finfo.vndirect.com.vn/v4/indexes?q=code:VNINDEX&size=1",
  "ssi-fcdata": "https://fc-data.ssi.com.vn/",
  "ssi-iboard": "https://iboard-query.ssi.com.vn/stock/exchange/hose",
  vps: "https://bgapidatafeed.vps.com.vn/getliststockdata/VCB",
  vietcap: "https://trading.vietcap.com.vn/",
  binance: "https://api.binance.com/api/v3/ping",
  coingecko: "https://api.coingecko.com/api/v3/ping",
  "forex-feed": "https://api.exchangerate.host/latest?base=USD",
  yahoo: "https://query1.finance.yahoo.com/v8/finance/chart/%5EVNINDEX?interval=1d&range=1d",
  commodities: "https://data.vietnambiz.vn/goods",
  cafef: "https://cafef.vn/thi-truong-chung-khoan.rss",
  "vietnambiz-economy": "https://vietnambiz.vn/",
};

const CACHE_TTL_MS = 20_000;
let cached: { at: number; report: SourceSyncReport } | null = null;

async function probeUrl(id: string, url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number; error: string | null }> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "*/*", "User-Agent": "Orca-SourceSync/1.0" },
    });
    try {
      await res.arrayBuffer();
    } catch {
      /* body optional */
    }
    const ms = Math.round(performance.now() - t0);
    const ok = res.status > 0 && res.status < 500;
    if (ok) recordSuccess(`sync:${id}`, ms, "source-sync");
    else recordFailure(`sync:${id}`, `http_${res.status}`, "source-sync");
    return { ok, ms, error: ok ? null : `http_${res.status}` };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    const short = /abort/i.test(msg) ? "timeout" : msg.slice(0, 120);
    recordFailure(`sync:${id}`, short, "source-sync");
    return { ok: false, ms, error: short };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parallel probe of catalog sources that have known public endpoints.
 * Results are cached ~20s to avoid stampeding on every agent turn.
 */
export async function syncAllSources(opts?: {
  force?: boolean;
  timeoutMs?: number;
}): Promise<SourceSyncReport> {
  const now = Date.now();
  if (!opts?.force && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.report;
  }

  const timeoutMs = opts?.timeoutMs ?? 2_500;
  const started = performance.now();
  const entries = SOURCE_CATALOG.filter((s) => PROBE_URL[s.id]);

  const probes = await Promise.all(
    entries.map(async (s): Promise<SyncProbe> => {
      const url = PROBE_URL[s.id]!;
      const circuitOpen = isCircuitOpen(s.id);
      if (circuitOpen) {
        return {
          id: s.id,
          domain: s.domain,
          role: s.role,
          ok: false,
          latencyMs: null,
          error: "circuit_open",
          circuitOpen: true,
        };
      }
      const r = await probeUrl(s.id, url, timeoutMs);
      return {
        id: s.id,
        domain: s.domain,
        role: s.role,
        ok: r.ok,
        latencyMs: r.ms,
        error: r.error,
        circuitOpen: false,
      };
    }),
  );

  const health = getProviderHealth();
  const routes: Record<string, string[]> = {};
  const domains = [...new Set(SOURCE_CATALOG.map((s) => s.domain))];
  for (const d of domains) {
    const ids = SOURCE_CATALOG.filter((s) => s.domain === d).map((s) => s.id);
    const enriched = health.map((h) => {
      const p = probes.find((x) => x.id === h.provider);
      const avg =
        p?.ok && p.latencyMs != null
          ? Math.min(h.avgLatencyMs ?? p.latencyMs, p.latencyMs)
          : h.avgLatencyMs;
      return { ...h, avgLatencyMs: avg };
    });
    for (const p of probes.filter((x) => x.domain === d)) {
      if (!enriched.some((h) => h.provider === p.id)) {
        enriched.push({
          provider: p.id,
          status: p.ok ? "healthy" : "down",
          avgLatencyMs: p.latencyMs,
          circuit: p.circuitOpen ? "open" : "closed",
        } as (typeof enriched)[number]);
      }
    }
    routes[d] = rankSourceIds(ids, enriched);
  }

  const report: SourceSyncReport = {
    probedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    probes,
    routes,
    summary: {
      total: probes.length,
      ok: probes.filter((p) => p.ok).length,
      fail: probes.filter((p) => !p.ok).length,
      openCircuits: probes.filter((p) => p.circuitOpen).length,
    },
  };
  cached = { at: now, report };
  return report;
}

/** Ordered source ids for a domain (uses last sync cache or catalog order). */
export function routeForDomain(domain: SourceDomain): string[] {
  if (cached?.report.routes[domain]?.length) return cached.report.routes[domain];
  return SOURCE_CATALOG.filter((s) => s.domain === domain)
    .sort((a, b) => {
      const rank = (r: string) => (r === "primary" ? 0 : r === "fallback" ? 1 : r === "secondary" ? 2 : 3);
      return rank(a.role) - rank(b.role);
    })
    .map((s) => s.id);
}

export function getLastSync(): SourceSyncReport | null {
  return cached?.report ?? null;
}

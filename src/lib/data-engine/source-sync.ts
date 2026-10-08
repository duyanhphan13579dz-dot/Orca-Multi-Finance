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
  /** false when the source needs env config that is not present in this deployment */
  configured: boolean;
  /** Human-readable note (skipped reason, probed URL host…) */
  note?: string;
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
    /** sources that need env config which is absent in this deployment */
    skipped: number;
    catalogTotal: number;
    probed: number;
  };
};

/** Cheap public GET used to verify a source is reachable from this deployment. */
type ProbeUrl = string | (() => string);

const VND_BASE = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");
const YAHOO_HOST = "https://query1.finance.yahoo.com";

function unixWindow(days = 30): { from: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  return { from: to - days * 86_400, to };
}

/** Probe endpoints keyed by catalog probeKey (best-effort, public GETs). */
const PROBE_URL: Record<string, ProbeUrl> = {
  // VN equities
  vndirect: () => `${VND_BASE()}/v4/vnmarket_prices?q=code:VNINDEX&size=1`,
  "vndirect-dchart": () => {
    const { from, to } = unixWindow(30);
    return `https://dchart-api.vndirect.com.vn/dchart/history?symbol=VCB&resolution=D&from=${from}&to=${to}`;
  },
  "vndirect-fs": () =>
    `${VND_BASE()}/v4/financial_statements?q=${encodeURIComponent("code:VNM~reportType:QUARTER")}&size=1`,
  "vndirect-company": () => `${VND_BASE()}/v4/company_profiles?q=code:VNM&size=1`,
  "ssi-fcdata": "https://fc-data.ssi.com.vn/",
  "ssi-iboard": "https://iboard-query.ssi.com.vn/stock/exchange/hose?boardId=MAIN",
  vps: "https://bgapidatafeed.vps.com.vn/getliststockdata/VCB",
  entrade: () => {
    const { from, to } = unixWindow(30);
    return `https://services.entrade.com.vn/chart-api/v2/stock?symbol=VCB&resolution=1D&from=${from}&to=${to}`;
  },
  "vps-hist": () => {
    const { from, to } = unixWindow(30);
    return `https://histdatafeed.vps.com.vn/tradingview/history?symbol=VCB&resolution=D&from=${from}&to=${to}`;
  },
  vietcap: "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/VNM",
  "yahoo-vn": `${YAHOO_HOST}/v8/finance/chart/VCB.VN?interval=1d&range=5d`,

  // Crypto
  "binance-spot": "https://api.binance.com/api/v3/ping",
  "binance-futures": "https://fapi.binance.com/fapi/v1/ping",
  coingecko: () => `${(process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com/api/v3").replace(/\/$/, "")}/ping`,

  // Forex
  "biquote-forex": () => `${(process.env.BIQUOTE_BASE_URL ?? "").replace(/\/$/, "")}/v1/quotes/EURUSD`,
  "biquote-public": "https://biquote.io/api/EURUSD/ohlc?interval=1d&limit=5",
  "exchangerate-api": "https://open.er-api.com/v6/latest/USD",
  "frankfurter-ecb": "https://api.frankfurter.dev/v1/latest?base=USD&symbols=VND",
  yahoo: `${YAHOO_HOST}/v8/finance/chart/%5EVNINDEX?interval=1d&range=1d`,

  // Commodities
  "vietnambiz-data": () =>
    `${(process.env.VIETNAMBIZ_BASE_URL ?? "https://data.vietnambiz.vn").replace(/\/$/, "")}/goods`,
  simplize: () => `${(process.env.SIMPLIZE_BASE_URL ?? "https://api.simplize.vn").replace(/\/$/, "")}/`,
  "msn-finance": "https://www.msn.com/vi-vn/money/commodities",

  // News / macro
  cafef: "https://cafef.vn/thi-truong-chung-khoan.rss",
  "rss-news": "https://vnexpress.net/rss/kinh-doanh.rss",
  "vietnambiz-economy": "https://vietnambiz.vn/",

  // Rates / derivatives
  "hnx-derivatives": () => process.env.DERIVATIVES_QUOTE_URL ?? "https://www.hnx.vn/",
};

/** Sources that are only probed when their deployment env is present. */
const PROBE_ENV: Record<string, string[]> = {
  vnstock: ["VNSTOCK_BASE_URL", "VNSTOCK_API_KEY"],
  polygon: ["POLYGON_API_KEY"],
  "biquote-forex": ["BIQUOTE_BASE_URL"],
  "hnx-derivatives": [],
};

function envConfigured(keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k] && String(process.env[k]).trim()));
}

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
  const entries = SOURCE_CATALOG.filter((s) => PROBE_URL[s.probeKey ?? s.id]);

  const probes = await Promise.all(
    entries.map(async (s): Promise<SyncProbe> => {
      const key = s.probeKey ?? s.id;
      const base = { id: s.id, domain: s.domain, role: s.role, configured: true };
      const required = PROBE_ENV[key] ?? [];
      if (required.length && !envConfigured(required)) {
        return {
          ...base,
          ok: false,
          latencyMs: null,
          error: null,
          circuitOpen: false,
          configured: false,
          note: `not_configured (missing ${required.join(", ")})`,
        };
      }
      let url: string;
      try {
        const raw = PROBE_URL[key]!;
        url = typeof raw === "function" ? raw() : raw;
      } catch {
        return {
          ...base,
          ok: false,
          latencyMs: null,
          error: "bad_probe_url",
          circuitOpen: false,
          note: "probe URL thay đổi theo env nhưng env chưa hợp lệ",
        };
      }
      if (!url || !/^https?:\/\//i.test(url)) {
        return {
          ...base,
          ok: false,
          latencyMs: null,
          error: null,
          circuitOpen: false,
          configured: false,
          note: "not_configured (no base URL)",
        };
      }
      const circuitOpen = isCircuitOpen(s.id);
      if (circuitOpen) {
        return { ...base, ok: false, latencyMs: null, error: "circuit_open", circuitOpen: true };
      }
      const r = await probeUrl(s.id, url, timeoutMs);
      return {
        ...base,
        ok: r.ok,
        latencyMs: r.ms,
        error: r.error,
        circuitOpen: false,
        note: new URL(url).host,
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
      skipped: probes.filter((p) => !p.configured).length,
      catalogTotal: SOURCE_CATALOG.length,
      probed: probes.filter((p) => p.configured).length,
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

/** Catalog ids that the connectivity self-test can actually probe (used by tests/docs). */
export function probedSourceIds(): string[] {
  return SOURCE_CATALOG.filter((s) => PROBE_URL[s.probeKey ?? s.id]).map((s) => s.id);
}

/** Env gate for a probe key, exposed for diagnostics on /system/connectivity. */
export function probeEnvRequirement(sourceId: string): string[] {
  const entry = SOURCE_CATALOG.find((s) => s.id === sourceId);
  const key = entry?.probeKey ?? sourceId;
  return PROBE_ENV[key] ?? [];
}

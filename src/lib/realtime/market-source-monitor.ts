import "server-only";

export type MarketSourceId =
  | "vndirect"
  | "vndirect-dchart"
  | "vps"
  | "vps-hist"
  | "ssi-iboard"
  | "ssi-fcdata"
  | "vietcap"
  | "public-vn"
  | "yahoo-public"
  | "entrade";

/** Map an OHLCV/quote source label (e.g. `public:yahoo`) to a monitor id. */
export function marketSourceIdFor(label: string): MarketSourceId | null {
  const raw = String(label ?? "").toLowerCase().trim();
  if (!raw) return null;
  const tail = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  switch (tail) {
    case "vndirect":
      return "vndirect";
    case "vndirect-dchart":
    case "dchart":
      return "vndirect-dchart";
    case "vps":
      return "vps";
    case "vps-hist":
    case "vps-histdatafeed":
      return "vps-hist";
    case "ssi-iboard":
      return "ssi-iboard";
    case "ssi-fcdata":
      return "ssi-fcdata";
    case "vietcap":
      return "vietcap";
    case "entrade":
      return "entrade";
    case "yahoo":
    case "yahoo-vn":
    case "yahoo-public":
    case "yahoo-asia":
      return "yahoo-public";
    case "public":
    case "public-vn":
      return "public-vn";
    default:
      return null;
  }
}

type Sample = { ok: boolean; latencyMs: number; at: number };

const WINDOW_MS = 5 * 60_000;
const MAX_SAMPLES = 120;
const state = globalThis as typeof globalThis & {
  __orcaMarketSourceSamples?: Map<MarketSourceId, Sample[]>;
};
const samples = state.__orcaMarketSourceSamples ?? new Map<MarketSourceId, Sample[]>();
state.__orcaMarketSourceSamples = samples;

export function recordMarketSource(source: MarketSourceId, ok: boolean, latencyMs: number): void {
  const list = samples.get(source) ?? [];
  list.push({ ok, latencyMs: Math.max(0, Math.round(latencyMs)), at: Date.now() });
  while (list.length > MAX_SAMPLES) list.shift();
  samples.set(source, list);
}

export function getMarketSourceStats(source: MarketSourceId) {
  const cutoff = Date.now() - WINDOW_MS;
  const list = (samples.get(source) ?? []).filter((item) => item.at >= cutoff);
  const successful = list.filter((item) => item.ok);
  return {
    attempts: list.length,
    successRate: list.length ? successful.length / list.length : null,
    avgLatencyMs: successful.length
      ? Math.round(successful.reduce((sum, item) => sum + item.latencyMs, 0) / successful.length)
      : null,
    lastSuccessAt: successful.at(-1)?.at ?? null,
    lastFailureAt: list.filter((item) => !item.ok).at(-1)?.at ?? null,
  };
}

export function getMarketSourceStatus(
  source: MarketSourceId,
  configured = true,
): "healthy" | "degraded" | "down" | "not_configured" {
  if (!configured) return "not_configured";
  const stats = getMarketSourceStats(source);
  if (stats.attempts === 0) return "healthy";
  if (stats.successRate != null && stats.successRate >= 0.8) return "healthy";
  if (stats.successRate != null && stats.successRate >= 0.4) return "degraded";
  return "down";
}

export function getMarketSourceMonitor() {
  return Object.fromEntries(
    (
      [
        "vndirect",
        "vndirect-dchart",
        "vps",
        "vps-hist",
        "ssi-iboard",
        "ssi-fcdata",
        "vietcap",
        "public-vn",
        "yahoo-public",
        "entrade",
      ] as MarketSourceId[]
    ).map((source) => [
      source,
      { ...getMarketSourceStats(source), status: getMarketSourceStatus(source) },
    ]),
  );
}

export function getMarketSourceWindowMs(): number {
  return WINDOW_MS;
}

export function resetMarketSourceMonitor(): void {
  samples.clear();
}

export function recordMarketSourceResult(source: MarketSourceId, startedAt: number, ok: boolean): void {
  recordMarketSource(source, ok, performance.now() - startedAt);
}

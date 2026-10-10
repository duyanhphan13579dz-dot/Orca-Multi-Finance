import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * World Bank Open Data API — no API key.
 * Structured annual / multi-year series for Vietnam (and optional other ISO2).
 * https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
 */

export const WORLDBANK = "worldbank";

const BASE = "https://api.worldbank.org/v2";

export type WorldBankObservation = {
  date: string;
  value: number | null;
};

export type WorldBankSeries = {
  id: string;
  name: string;
  unit: string | null;
  country: string;
  countryName: string;
  observations: WorldBankObservation[];
  lastUpdated: string | null;
};

/** Curated Vietnam-first indicator set for ORCA macro panel. */
export const VN_MACRO_INDICATORS: {
  id: string;
  name: string;
  unit: string;
  group: "growth" | "prices" | "labor" | "external" | "fiscal" | "money";
}[] = [
  { id: "NY.GDP.MKTP.KD.ZG", name: "GDP growth (annual %)", unit: "%", group: "growth" },
  { id: "NY.GDP.PCAP.KD.ZG", name: "GDP per capita growth (annual %)", unit: "%", group: "growth" },
  { id: "FP.CPI.TOTL.ZG", name: "Inflation, consumer prices (annual %)", unit: "%", group: "prices" },
  { id: "SL.UEM.TOTL.ZS", name: "Unemployment, total (% of labor force)", unit: "%", group: "labor" },
  { id: "NE.EXP.GNFS.ZS", name: "Exports of goods and services (% of GDP)", unit: "%", group: "external" },
  { id: "NE.IMP.GNFS.ZS", name: "Imports of goods and services (% of GDP)", unit: "%", group: "external" },
  { id: "BN.CAB.XOKA.GD.ZS", name: "Current account balance (% of GDP)", unit: "%", group: "external" },
  { id: "BX.KLT.DINV.WD.GD.ZS", name: "Foreign direct investment, net inflows (% of GDP)", unit: "%", group: "external" },
  { id: "GC.DOD.TOTL.GD.ZS", name: "Central government debt, total (% of GDP)", unit: "%", group: "fiscal" },
  { id: "FM.LBL.BMNY.ZG", name: "Broad money growth (annual %)", unit: "%", group: "money" },
];

type WbPageMeta = {
  page?: number;
  pages?: number;
  per_page?: number;
  total?: number;
  lastupdated?: string;
};

type WbRow = {
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string };
  countryiso3code?: string;
  date?: string;
  value?: number | null;
  unit?: string;
};

async function fetchIndicator(
  countryIso2: string,
  indicatorId: string,
  perPage = 40,
): Promise<{ series: WorldBankSeries; latencyMs: number }> {
  const started = performance.now();
  const url =
    `${BASE}/country/${encodeURIComponent(countryIso2.toUpperCase())}` +
    `/indicator/${encodeURIComponent(indicatorId)}` +
    `?format=json&per_page=${Math.min(Math.max(perPage, 5), 100)}`;

  const res = await httpJson<[WbPageMeta, WbRow[]] | { message?: unknown }>(url, {
    provider: WORLDBANK,
    timeoutMs: 10_000,
    retries: 1,
  });

  if (!res.ok || !Array.isArray(res.data) || res.data.length < 2) {
    throw new ProviderError(
      `worldbank ${indicatorId}: ${res.error ?? "empty_or_malformed"}`,
      WORLDBANK,
    );
  }

  const meta = res.data[0] as WbPageMeta;
  const rows = (res.data[1] as WbRow[]) ?? [];
  const first = rows[0];
  const observations: WorldBankObservation[] = [];
  for (const r of rows) {
    const date = String(r.date ?? "").trim();
    if (!date) continue;
    const raw = r.value;
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    observations.push({ date, value });
  }
  // API returns newest-first; keep that order for UI convenience
  const known = VN_MACRO_INDICATORS.find((x) => x.id === indicatorId);
  return {
    series: {
      id: indicatorId,
      name: first?.indicator?.value ?? known?.name ?? indicatorId,
      unit: known?.unit ?? (first?.unit || null),
      country: countryIso2.toUpperCase(),
      countryName: first?.country?.value ?? countryIso2.toUpperCase(),
      observations,
      lastUpdated: meta?.lastupdated ?? null,
    },
    latencyMs: Math.round(performance.now() - started),
  };
}

export type WorldBankMacroBundle = {
  country: string;
  series: WorldBankSeries[];
  groups: typeof VN_MACRO_INDICATORS;
  fetchedAt: string;
  warnings: string[];
  latencyMs: number;
};

/** Parallel fetch of curated VN (or other) macro indicators. Partial success allowed. */
export async function fetchWorldBankMacro(
  countryIso2 = "VN",
  indicatorIds?: string[],
): Promise<WorldBankMacroBundle> {
  const ids =
    indicatorIds?.length ?
      indicatorIds
    : VN_MACRO_INDICATORS.map((x) => x.id);

  const started = performance.now();
  const settled = await Promise.allSettled(ids.map((id) => fetchIndicator(countryIso2, id)));
  const series: WorldBankSeries[] = [];
  const warnings: string[] = [];

  settled.forEach((r, i) => {
    const id = ids[i]!;
    if (r.status === "fulfilled") {
      series.push(r.value.series);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warnings.push(`${id}: ${msg}`);
    }
  });

  if (!series.length) {
    throw new ProviderError(
      `worldbank: all indicators failed (${warnings.slice(0, 3).join("; ")})`,
      WORLDBANK,
    );
  }

  return {
    country: countryIso2.toUpperCase(),
    series,
    groups: VN_MACRO_INDICATORS,
    fetchedAt: new Date().toISOString(),
    warnings,
    latencyMs: Math.round(performance.now() - started),
  };
}

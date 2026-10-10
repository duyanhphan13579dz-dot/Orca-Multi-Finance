import "server-only";
import { fetchVndirectFinancials } from "./vndirect-fs";
import { fetchVnstockFinancials } from "./vnstock-provider";
import { getFinancialPackage } from "./service";
import type { NormalizedPeriod } from "./types";

export type FsPack = {
  periods: NormalizedPeriod[];
  latencyMs: number;
  sources: string[];
};

/** Parallel public BCTC race — richest period set wins. */
export async function fetchFinancialStatementsMulti(symbol: string): Promise<FsPack | null> {
  type Pack = { periods: NormalizedPeriod[]; latencyMs: number; source: string };
  const jobs: Promise<Pack | null>[] = [
    (async () => {
      try {
        const primary = await Promise.race([
          fetchVndirectFinancials(symbol, { limitPeriods: 16 }),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        if (primary?.periods?.length)
          return {
            periods: primary.periods,
            latencyMs: primary.latencyMs ?? 0,
            source: primary.periods[0]?.source ?? "vndirect-fs",
          };
      } catch {
        /* */
      }
      return null;
    })(),
    (async () => {
      try {
        const pack = await Promise.race([
          getFinancialPackage(symbol),
          new Promise<null>((r) => setTimeout(() => r(null), 14_000)),
        ]);
        const periods = pack?.pkg?.periods;
        if (periods?.length)
          return {
            periods,
            latencyMs: 0,
            source: pack?.meta?.source ?? pack?.pkg?.meta?.primarySource ?? "financial-package",
          };
      } catch {
        /* */
      }
      return null;
    })(),
    (async () => {
      try {
        const fb = await Promise.race([
          fetchVnstockFinancials(symbol, { limitPeriods: 16 }),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        if (fb?.periods?.length)
          return {
            periods: fb.periods,
            latencyMs: fb.latencyMs ?? 0,
            source: fb.periods[0]?.source ?? "vnstock",
          };
      } catch {
        /* */
      }
      return null;
    })(),
  ];
  const settled = await Promise.all(jobs);
  const ok = settled.filter((x): x is Pack => Boolean(x?.periods?.length));
  if (!ok.length) return null;
  ok.sort((a, b) => b.periods.length - a.periods.length);
  const best = ok[0]!;
  return {
    periods: best.periods,
    latencyMs: best.latencyMs,
    sources: ok.map((x) => x.source),
  };
}

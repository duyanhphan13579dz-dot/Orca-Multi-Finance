import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol } from "../financial/service";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getSsiDailyOhlc,
  getSsiFullBoard,
  getSsiIndices,
  getSsiQuotes,
  getSsiUniverse,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain — SSI FastConnect PRIMARY when keys set.
 * VNDirect = fallback only.
 */

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function bootSsiLive() {
  if (!ssiFcConfigured()) return;
  if (process.env.SSI_WS_DISABLED === "true") return;
  try {
    bootSsiMarketDataPipeline();
  } catch {
    try {
      ensureSsiWsStarted();
    } catch {
      /* non-fatal */
    }
  }
}

export function vnMarketConfigured(): boolean {
  return true;
}

/** @deprecated Use vnMarketConfigured */
export function vnstockConfigured(): boolean {
  return vnMarketConfigured();
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
}

function liveQuoteFromWs(symbol: string): Quote | null {
  const t = ssiWs.getQuote(symbol, 30_000);
  if (!t) return null;
  return {
    symbol: t.symbol,
    assetClass: "stock",
    price: t.price,
    change: t.change,
    changePercent: t.changePercent,
    open: t.open,
    high: t.high,
    low: t.low,
    volume: t.volume,
    quoteVolume: t.value,
    referencePrice: t.ref,
    ceilingPrice: t.ceiling,
    floorPrice: t.floor,
    updatedAt: new Date(t.eventTime).toISOString(),
  };
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  bootSsiLive();

  // 1) LIVE WS indices
  if (ssiFcConfigured() && process.env.SSI_WS_DISABLED !== "true") {
    const live: IndexQuote[] = [];
    for (const code of ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM"]) {
      const idx = ssiWs.getIndex(code, 30_000);
      if (!idx) continue;
      live.push({
        code: idx.code,
        name: idx.code,
        value: idx.value,
        change: idx.change,
        changePercent: idx.changePercent,
        volume: idx.volume,
        updatedAt: new Date(idx.eventTime).toISOString(),
      });
    }
    if (live.length >= 2) {
      return {
        items: sortIndices(live),
        meta: buildMeta({
          source: "ssi-ws",
          sourceTimestampMs: Math.max(...live.map((x) => Date.parse(x.updatedAt ?? "") || 0)),
          note: "Chỉ số LIVE — SSI DataHub",
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
        }),
      };
    }
  }

  // 2) SSI REST DailyIndex
  if (ssiFcConfigured()) {
    try {
      const res = await cached("vn:indices:ssi:v1", {
        ttlMs: 20_000,
        staleMs: 120_000,
        producer: async () => {
          const r = await getSsiIndices();
          if (!v.items?.length && !(r as { items?: IndexQuote[] }).items?.length) {
            /* type guard */
          }
          if (!r.items.length) throw new Error("ssi empty indices");
          return r;
        },
      });
      return {
        items: sortIndices(res.value.items),
        meta: buildMeta({
          source: "ssi-fcdata",
          sourceTimestampMs: Date.now(),
          cached: res.cached,
          note: "Chỉ số VN — SSI FastConnect DailyIndex",
          slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
        }),
      };
    } catch {
      /* fallback */
    }
  }

  try {
    const res = await cached("vn:indices:vnd:v1", {
      ttlMs: 30_000,
      staleMs: 180_000,
      producer: () => vndirect.getVndIndices(),
    });
    return {
      items: sortIndices(res.value.items),
      meta: buildMeta({
        source: "vndirect",
        sourceTimestampMs: Date.now(),
        cached: res.cached,
        note: ssiFcConfigured() ? "Chỉ số fallback VNDirect" : "Chỉ số VN — VNDirect",
        slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
      }),
    };
  } catch {
    return null;
  }
}

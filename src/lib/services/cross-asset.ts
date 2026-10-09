import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getYahooQuotes } from "../providers/yahoo";
import { getCryptoMarkets } from "./crypto";
import { validateQuote } from "../quality";
import type { Meta } from "../types";

/**
 * CROSS-ASSET MARKET SNAPSHOT — global macro context:
 * DXY · WTI · GOLD · SILVER · BTC · ETH · USD/VND (+ Brent)
 */

export interface CrossAssetItem {
  key: "DXY" | "WTI" | "GOLD" | "SILVER" | "BTC" | "ETH" | "BRENT" | "USDVND";
  label: string;
  value: number | null;
  changePercent: number | null;
  unit: string;
  source: string;
  sourceTimestamp: string | null;
  quality: "VALID" | "SUSPECT" | "UNAVAILABLE";
  note?: string;
}

const YAHOO_MAP: { key: CrossAssetItem["key"]; ticker: string; label: string; unit: string }[] = [
  { key: "DXY", ticker: "DX-Y.NYB", label: "DXY — Chỉ số USD", unit: "index" },
  { key: "WTI", ticker: "CL=F", label: "WTI Crude", unit: "USD/bbl" },
  { key: "GOLD", ticker: "GC=F", label: "Gold (XAU)", unit: "USD/oz" },
  { key: "SILVER", ticker: "SI=F", label: "Silver (XAG)", unit: "USD/oz" },
  { key: "BRENT", ticker: "BZ=F", label: "Brent Crude", unit: "USD/bbl" },
  { key: "USDVND", ticker: "VND=X", label: "USD/VND", unit: "VND" },
];

const BTC_FB = "BTC-USD";
const ETH_FB = "ETH-USD";

export async function getCrossAsset(): Promise<{ items: CrossAssetItem[]; meta: Meta }> {
  const res = await cached("cross-asset:v2", {
    ttlMs: 45_000,
    staleMs: 6 * 3_600_000,
    softSwr: true,
    producer: async () => {
      const [yq, crypto] = await Promise.allSettled([
        getYahooQuotes([...YAHOO_MAP.map((y) => y.ticker), BTC_FB, ETH_FB]),
        getCryptoMarkets(),
      ]);
      const yahoo = yq.status === "fulfilled" ? yq.value : new Map();
      const items: CrossAssetItem[] = [];
      let newest: number | null = null;

      for (const def of YAHOO_MAP) {
        const q = yahoo.get(def.ticker);
        if (!q) {
          items.push({
            key: def.key,
            label: def.label,
            value: null,
            changePercent: null,
            unit: def.unit,
            source: "yahoo",
            sourceTimestamp: null,
            quality: "UNAVAILABLE",
          });
          continue;
        }
        const v = validateQuote(
          {
            price: q.price,
            open: null,
            high: q.dayHigh,
            low: q.dayLow,
            volume: null,
            changePercent: q.changePercent,
            updatedAt: q.marketTime ? new Date(q.marketTime).toISOString() : null,
          },
          {
            assetClass: def.key === "USDVND" ? "forex" : "commodity",
            sourceTimestampMs: q.marketTime ?? null,
          },
        );
        if (q.marketTime) newest = Math.max(newest ?? 0, q.marketTime);
        items.push({
          key: def.key,
          label: def.label,
          value: q.price,
          changePercent: q.changePercent,
          unit: def.unit,
          source: "Yahoo Finance (public)",
          sourceTimestamp: q.marketTime ? new Date(q.marketTime).toISOString() : null,
          quality: v.status === "VALID" ? "VALID" : v.status === "INVALID" ? "UNAVAILABLE" : "SUSPECT",
        });
      }

      const cryptoRows =
        crypto.status === "fulfilled" && crypto.value ? crypto.value.rows : [];
      const btc = cryptoRows.find((r) => r.symbol === "BTCUSDT");
      const eth = cryptoRows.find((r) => r.symbol === "ETHUSDT");
      const btcFb = yahoo.get(BTC_FB);
      const ethFb = yahoo.get(ETH_FB);

      if (btc) {
        items.unshift({
          key: "BTC",
          label: "BTC/USDT",
          value: btc.price,
          changePercent: btc.changePercent ?? null,
          unit: "USDT",
          source: "crypto-pipeline",
          sourceTimestamp: btc.updatedAt ?? null,
          quality: "VALID",
        });
      } else if (btcFb?.price) {
        items.unshift({
          key: "BTC",
          label: "BTC/USD",
          value: btcFb.price,
          changePercent: btcFb.changePercent,
          unit: "USD",
          source: "yahoo-BTC-USD",
          sourceTimestamp: btcFb.marketTime ? new Date(btcFb.marketTime).toISOString() : null,
          quality: "VALID",
        });
      } else {
        items.unshift({
          key: "BTC",
          label: "BTC",
          value: null,
          changePercent: null,
          unit: "USD",
          source: "crypto/yahoo",
          sourceTimestamp: null,
          quality: "UNAVAILABLE",
        });
      }

      if (eth) {
        items.splice(1, 0, {
          key: "ETH",
          label: "ETH/USDT",
          value: eth.price,
          changePercent: eth.changePercent ?? null,
          unit: "USDT",
          source: "crypto-pipeline",
          sourceTimestamp: eth.updatedAt ?? null,
          quality: "VALID",
        });
      } else if (ethFb?.price) {
        items.splice(1, 0, {
          key: "ETH",
          label: "ETH/USD",
          value: ethFb.price,
          changePercent: ethFb.changePercent,
          unit: "USD",
          source: "yahoo-ETH-USD",
          sourceTimestamp: ethFb.marketTime ? new Date(ethFb.marketTime).toISOString() : null,
          quality: "VALID",
        });
      } else {
        items.splice(1, 0, {
          key: "ETH",
          label: "ETH",
          value: null,
          changePercent: null,
          unit: "USD",
          source: "crypto/yahoo",
          sourceTimestamp: null,
          quality: "UNAVAILABLE",
        });
      }

      return { items, newest };
    },
  });

  return {
    items: res.value.items,
    meta: buildMeta({
      source: "cross-asset",
      sourceTimestampMs: res.value.newest ?? Date.now(),
      cached: res.cached,
      stale: res.stale,
    }),
  };
}

export function pickCross(
  items: CrossAssetItem[],
): Record<"dxy" | "wti" | "gold" | "silver" | "btc" | "eth", CrossAssetItem | undefined> {
  const pick = (k: CrossAssetItem["key"]) => items.find((i) => i.key === k);
  return {
    dxy: pick("DXY"),
    wti: pick("WTI"),
    gold: pick("GOLD"),
    silver: pick("SILVER"),
    btc: pick("BTC"),
    eth: pick("ETH"),
  };
}

export function crossAssetChanges(items: CrossAssetItem[]) {
  const pick = (k: CrossAssetItem["key"]) => items.find((i) => i.key === k)?.changePercent ?? null;
  return {
    dxy: pick("DXY"),
    wti: pick("WTI"),
    gold: pick("GOLD"),
    silver: pick("SILVER"),
    btc: pick("BTC"),
    eth: pick("ETH"),
  };
}

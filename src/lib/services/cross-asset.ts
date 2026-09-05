import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getYahooQuotes } from "../providers/yahoo";
import { getCryptoMarkets } from "./crypto";
import { validateQuote } from "../quality";
import type { Meta } from "../types";

/**
 * CROSS-ASSET MARKET SNAPSHOT — global macro context for the Vietnam market:
 * DXY · WTI · GOLD · BTC (+ Brent, USD/VND) with per-item source + freshness.
 */

export interface CrossAssetItem {
  key: "DXY" | "WTI" | "GOLD" | "BTC" | "BRENT" | "USDVND";
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
  { key: "GOLD", ticker: "GC=F", label: "Gold", unit: "USD/oz" },
  { key: "BRENT", ticker: "BZ=F", label: "Brent Crude", unit: "USD/bbl" },
  { key: "USDVND", ticker: "VND=X", label: "USD/VND", unit: "VND" },
];

const BTC_FALLBACK_TICKER = "BTC-USD";

export async function getCrossAsset(): Promise<{ items: CrossAssetItem[]; meta: Meta }> {
  const res = await cached("cross-asset:v1", {
    ttlMs: 60_000,
    staleMs: 6 * 3_600_000,
    producer: async () => {
      const [yq, crypto] = await Promise.allSettled([
        getYahooQuotes([...YAHOO_MAP.map((y) => y.ticker), BTC_FALLBACK_TICKER]),
        getCryptoMarkets(),
      ]);
      const yahoo = yq.status === "fulfilled" ? yq.value : new Map();
      const items: CrossAssetItem[] = [];
      let newest: number | null = null;

      for (const def of YAHOO_MAP) {
        const q = yahoo.get(def.ticker);
        if (!q) {
          items.push({ key: def.key, label: def.label, value: null, changePercent: null, unit: def.unit, source: "yahoo-fx", sourceTimestamp: null, quality: "UNAVAILABLE" });
          continue;
        }
        const v = validateQuote(
          { price: q.price, open: null, high: q.dayHigh, low: q.dayLow, volume: null, changePercent: q.changePercent, updatedAt: q.marketTime ? new Date(q.marketTime).toISOString() : null },
          { assetClass: def.key === "USDVND" ? "forex" : "commodity", sourceTimestampMs: q.marketTime, staleMs: 5 * 86_400_000 },
        );
        if (q.marketTime && (newest == null || q.marketTime > newest)) newest = q.marketTime;
        items.push({
          key: def.key,
          label: def.label,
          value: q.price,
          changePercent: q.changePercent,
          unit: def.unit,
          source: "Yahoo Finance (public reference)",
          sourceTimestamp: q.marketTime ? new Date(q.marketTime).toISOString() : null,
          quality: v.status === "VALID" ? "VALID" : v.status === "INVALID" ? "UNAVAILABLE" : "SUSPECT",
        });
      }

      // BTC: Binance realtime primary → Yahoo BTC-USD reference fallback
      const btc = crypto.status === "fulfilled" && crypto.value ? crypto.value.rows.find((r) => r.symbol === "BTCUSDT") : null;
      const btcFb = yahoo.get(BTC_FALLBACK_TICKER);
      if (btc) {
        items.unshift({
          key: "BTC", label: "BTC/USDT", value: btc.price, changePercent: btc.changePercent ?? null,
          unit: "USDT", source: "Binance (realtime)", sourceTimestamp: btc.updatedAt ?? null, quality: "VALID",
        });
        if (btc.updatedAt) {
          const t = Date.parse(btc.updatedAt);
          if (newest == null || t > newest) newest = t;
        }
      } else if (btcFb) {
        items.unshift({
          key: "BTC", label: "BTC/USD", value: btcFb.price, changePercent: btcFb.changePercent,
          unit: "USD", source: "Yahoo Finance (fallback — Binance tạm gián đoạn)",
          sourceTimestamp: btcFb.marketTime ? new Date(btcFb.marketTime).toISOString() : null, quality: "SUSPECT",
          note: "Nguồn dự phòng: Binance realtime không khả dụng từ vị trí máy chủ",
        });
      } else {
        items.unshift({ key: "BTC", label: "BTC", value: null, changePercent: null, unit: "USD", source: "binance/yahoo", sourceTimestamp: null, quality: "UNAVAILABLE" });
      }
      return { items, newest };
    },
  });

  const meta = buildMeta({
    source: "cross-asset engine (Binance + Yahoo public reference)",
    sourceTimestampMs: res.value.newest,
    cached: res.cached,
    stale: res.stale,
    slas: { liveSlaMs: 60_000, freshSlaMs: 15 * 60_000, delayedSlaMs: 6 * 3_600_000 },
  });
  return { items: res.value.items, meta };
}

export function crossAssetChanges(items: CrossAssetItem[]) {
  const pick = (k: CrossAssetItem["key"]) => items.find((i) => i.key === k)?.changePercent ?? null;
  return { dxy: pick("DXY"), wti: pick("WTI"), gold: pick("GOLD"), btc: pick("BTC") };
}

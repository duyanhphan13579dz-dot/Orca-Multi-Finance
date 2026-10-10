import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getYahooQuotes } from "../providers/yahoo";
import { getCryptoMarkets } from "./crypto";
import type { Meta } from "../types";

/**
 * CROSS-ASSET for homepage ticker + regime panels.
 * Multi-source soft-fill so Workers never return an all-empty strip.
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

type Pack = { items: CrossAssetItem[]; newest: number | null };

function lastGoodStore(): { current: { pack: Pack; at: number } | null } {
  const g = globalThis as typeof globalThis & {
    __orcaCrossAssetLast?: { current: { pack: Pack; at: number } | null };
  };
  if (!g.__orcaCrossAssetLast) g.__orcaCrossAssetLast = { current: null };
  return g.__orcaCrossAssetLast;
}

function remember(pack: Pack) {
  if (!pack.items.some((i) => i.value != null)) return;
  lastGoodStore().current = { pack, at: Date.now() };
}

function recall(maxAgeMs = 2 * 3_600_000): Pack | null {
  const lg = lastGoodStore().current;
  if (!lg || Date.now() - lg.at > maxAgeMs) return null;
  return {
    items: lg.pack.items.map((i) =>
      i.value != null
        ? { ...i, source: `${i.source}+last-good`, quality: "SUSPECT" as const }
        : i,
    ),
    newest: lg.pack.newest,
  };
}

function emptyItem(
  key: CrossAssetItem["key"],
  label: string,
  unit: string,
): CrossAssetItem {
  return {
    key,
    label,
    value: null,
    changePercent: null,
    unit,
    source: "none",
    sourceTimestamp: null,
    quality: "UNAVAILABLE",
  };
}

function setItem(
  map: Map<CrossAssetItem["key"], CrossAssetItem>,
  item: CrossAssetItem,
) {
  const prev = map.get(item.key);
  if (prev?.value != null && item.value == null) return;
  if (prev?.value != null && item.value != null && prev.quality === "VALID") return;
  map.set(item.key, item);
}

async function loadYahooBatch(): Promise<
  Map<string, { price: number; changePercent: number | null; marketTime: number | null }>
> {
  try {
    const map = await getYahooQuotes([
      "DX-Y.NYB",
      "CL=F",
      "GC=F",
      "SI=F",
      "BZ=F",
      "VND=X",
      "BTC-USD",
      "ETH-USD",
    ]);
    const out = new Map<
      string,
      { price: number; changePercent: number | null; marketTime: number | null }
    >();
    for (const [k, q] of map) {
      if (q?.price && q.price > 0) {
        out.set(k, {
          price: q.price,
          changePercent: q.changePercent ?? null,
          marketTime: q.marketTime ?? null,
        });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

async function loadCryptoPair(): Promise<{
  btc: { price: number; changePercent: number | null; updatedAt: string | null; source: string } | null;
  eth: { price: number; changePercent: number | null; updatedAt: string | null; source: string } | null;
}> {
  try {
    const m = await getCryptoMarkets();
    const btcR = m?.rows.find((r) => r.symbol === "BTCUSDT");
    const ethR = m?.rows.find((r) => r.symbol === "ETHUSDT");
    return {
      btc: btcR
        ? {
            price: btcR.price,
            changePercent: btcR.changePercent,
            updatedAt: btcR.updatedAt,
            source: m?.meta.source ?? "crypto",
          }
        : null,
      eth: ethR
        ? {
            price: ethR.price,
            changePercent: ethR.changePercent,
            updatedAt: ethR.updatedAt,
            source: m?.meta.source ?? "crypto",
          }
        : null,
    };
  } catch {
    return { btc: null, eth: null };
  }
}

async function loadMetalsFxLive(): Promise<
  Map<string, { price: number; changePercent: number | null; source: string; ts: number | null }>
> {
  const out = new Map<
    string,
    { price: number; changePercent: number | null; source: string; ts: number | null }
  >();
  try {
    const { getRealtimeFxQuotes } = await import("../providers/forex");
    const live = await getRealtimeFxQuotes(["XAUUSD", "XAGUSD", "USDVND", "EURUSD"]);
    for (const p of ["XAUUSD", "XAGUSD", "USDVND"] as const) {
      const price = live.rates[p];
      if (price == null || !(price > 0)) continue;
      const tick = live.ticks?.[p];
      out.set(p, {
        price,
        changePercent: tick?.dayDiffPercent ?? null,
        source: live.source || "fx-live",
        ts: live.ts ?? null,
      });
    }
  } catch {
    /* */
  }
  return out;
}

async function produceCrossAsset(): Promise<Pack> {
  const byKey = new Map<CrossAssetItem["key"], CrossAssetItem>();
  for (const [key, label, unit] of [
    ["BTC", "BTC/USDT", "USDT"],
    ["ETH", "ETH/USDT", "USDT"],
    ["DXY", "DXY — Chỉ số USD", "index"],
    ["WTI", "WTI Crude", "USD/bbl"],
    ["GOLD", "Gold (XAU)", "USD/oz"],
    ["SILVER", "Silver (XAG)", "USD/oz"],
    ["BRENT", "Brent Crude", "USD/bbl"],
    ["USDVND", "USD/VND", "VND"],
  ] as const) {
    byKey.set(key, emptyItem(key, label, unit));
  }

  let newest: number | null = null;

  const [yahoo, crypto, metals] = await Promise.all([
    loadYahooBatch(),
    loadCryptoPair(),
    loadMetalsFxLive(),
  ]);

  if (crypto.btc) {
    setItem(byKey, {
      key: "BTC",
      label: "BTC/USDT",
      value: crypto.btc.price,
      changePercent: crypto.btc.changePercent,
      unit: "USDT",
      source: crypto.btc.source,
      sourceTimestamp: crypto.btc.updatedAt,
      quality: "VALID",
    });
    if (crypto.btc.updatedAt) {
      const t = Date.parse(crypto.btc.updatedAt);
      if (Number.isFinite(t)) newest = Math.max(newest ?? 0, t);
    }
  }
  if (crypto.eth) {
    setItem(byKey, {
      key: "ETH",
      label: "ETH/USDT",
      value: crypto.eth.price,
      changePercent: crypto.eth.changePercent,
      unit: "USDT",
      source: crypto.eth.source,
      sourceTimestamp: crypto.eth.updatedAt,
      quality: "VALID",
    });
  }

  const yBtc = yahoo.get("BTC-USD");
  if (yBtc && byKey.get("BTC")?.value == null) {
    setItem(byKey, {
      key: "BTC",
      label: "BTC/USD",
      value: yBtc.price,
      changePercent: yBtc.changePercent,
      unit: "USD",
      source: "yahoo-BTC-USD",
      sourceTimestamp: yBtc.marketTime ? new Date(yBtc.marketTime).toISOString() : null,
      quality: "VALID",
    });
  }
  const yEth = yahoo.get("ETH-USD");
  if (yEth && byKey.get("ETH")?.value == null) {
    setItem(byKey, {
      key: "ETH",
      label: "ETH/USD",
      value: yEth.price,
      changePercent: yEth.changePercent,
      unit: "USD",
      source: "yahoo-ETH-USD",
      sourceTimestamp: yEth.marketTime ? new Date(yEth.marketTime).toISOString() : null,
      quality: "VALID",
    });
  }

  const xau = metals.get("XAUUSD");
  if (xau) {
    setItem(byKey, {
      key: "GOLD",
      label: "Gold (XAU)",
      value: xau.price,
      changePercent: xau.changePercent,
      unit: "USD/oz",
      source: xau.source,
      sourceTimestamp: xau.ts ? new Date(xau.ts).toISOString() : null,
      quality: "VALID",
    });
  }
  const xag = metals.get("XAGUSD");
  if (xag) {
    setItem(byKey, {
      key: "SILVER",
      label: "Silver (XAG)",
      value: xag.price,
      changePercent: xag.changePercent,
      unit: "USD/oz",
      source: xag.source,
      sourceTimestamp: xag.ts ? new Date(xag.ts).toISOString() : null,
      quality: "VALID",
    });
  }
  const vnd = metals.get("USDVND");
  if (vnd) {
    setItem(byKey, {
      key: "USDVND",
      label: "USD/VND",
      value: vnd.price,
      changePercent: vnd.changePercent,
      unit: "VND",
      source: vnd.source,
      sourceTimestamp: vnd.ts ? new Date(vnd.ts).toISOString() : null,
      quality: "VALID",
    });
  }

  const yahooMap: { key: CrossAssetItem["key"]; ticker: string; label: string; unit: string }[] = [
    { key: "DXY", ticker: "DX-Y.NYB", label: "DXY — Chỉ số USD", unit: "index" },
    { key: "WTI", ticker: "CL=F", label: "WTI Crude", unit: "USD/bbl" },
    { key: "GOLD", ticker: "GC=F", label: "Gold (XAU)", unit: "USD/oz" },
    { key: "SILVER", ticker: "SI=F", label: "Silver (XAG)", unit: "USD/oz" },
    { key: "BRENT", ticker: "BZ=F", label: "Brent Crude", unit: "USD/bbl" },
    { key: "USDVND", ticker: "VND=X", label: "USD/VND", unit: "VND" },
  ];
  for (const def of yahooMap) {
    if (byKey.get(def.key)?.value != null) continue;
    const q = yahoo.get(def.ticker);
    if (!q) continue;
    if (q.marketTime) newest = Math.max(newest ?? 0, q.marketTime);
    setItem(byKey, {
      key: def.key,
      label: def.label,
      value: q.price,
      changePercent: q.changePercent,
      unit: def.unit,
      source: `yahoo:${def.ticker}`,
      sourceTimestamp: q.marketTime ? new Date(q.marketTime).toISOString() : null,
      quality: "VALID",
    });
  }

  if (byKey.get("USDVND")?.value == null) {
    try {
      const { getErApiLatest } = await import("../providers/forex");
      const er = await getErApiLatest();
      const rate = er.rates?.VND;
      if (rate && rate > 0) {
        setItem(byKey, {
          key: "USDVND",
          label: "USD/VND",
          value: rate,
          changePercent: null,
          unit: "VND",
          source: er.source || "er-api",
          sourceTimestamp: er.ts ? new Date(er.ts).toISOString() : null,
          quality: "SUSPECT",
        });
      }
    } catch {
      /* */
    }
  }

  const order: CrossAssetItem["key"][] = [
    "BTC",
    "ETH",
    "DXY",
    "WTI",
    "GOLD",
    "SILVER",
    "BRENT",
    "USDVND",
  ];
  const items = order.map((k) => byKey.get(k)!);
  const pack = { items, newest };
  if (items.some((i) => i.value != null)) remember(pack);
  return pack;
}

export async function getCrossAsset(): Promise<{ items: CrossAssetItem[]; meta: Meta }> {
  try {
    const res = await cached("cross-asset:v3", {
      ttlMs: 30_000,
      staleMs: 2 * 3_600_000,
      softSwr: true,
      producer: async () => {
        try {
          return await produceCrossAsset();
        } catch {
          const lg = recall();
          if (lg) return lg;
          throw new Error("cross-asset empty");
        }
      },
    });

    let pack = res.value;
    if (!pack.items.some((i) => i.value != null)) {
      const lg = recall();
      if (lg) pack = lg;
    }

    const filled = pack.items.filter((i) => i.value != null).length;
    return {
      items: pack.items,
      meta: buildMeta({
        source: "cross-asset-multi",
        sourceTimestampMs: pack.newest ?? Date.now(),
        cached: res.cached,
        stale: res.stale,
        partial: filled < 4,
        note: `filled=${filled}/8`,
      }),
    };
  } catch {
    const lg = recall();
    if (lg) {
      return {
        items: lg.items,
        meta: buildMeta({
          source: "cross-asset-last-good",
          sourceTimestampMs: lg.newest ?? Date.now(),
          stale: true,
          partial: true,
          note: "last-good",
        }),
      };
    }
    return {
      items: [
        emptyItem("BTC", "BTC", "USD"),
        emptyItem("ETH", "ETH", "USD"),
        emptyItem("DXY", "DXY", "index"),
        emptyItem("WTI", "WTI", "USD/bbl"),
        emptyItem("GOLD", "Gold", "USD/oz"),
        emptyItem("SILVER", "Silver", "USD/oz"),
        emptyItem("BRENT", "Brent", "USD/bbl"),
        emptyItem("USDVND", "USD/VND", "VND"),
      ],
      meta: buildMeta({
        source: "cross-asset-empty",
        sourceTimestampMs: Date.now(),
        partial: true,
        note: "all sources unavailable",
      }),
    };
  }
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

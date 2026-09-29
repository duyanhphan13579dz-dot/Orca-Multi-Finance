/**
 * Market snapshot — VN · Asia · US · Forex for ticker tape.
 * Optimized: parallel sources + soft SWR cache + per-source timeout budget.
 */

import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "@/lib/vn/sessions";
import { buildMeta } from "@/lib/freshness";
import { cached } from "@/lib/cache";
import type { Meta } from "@/lib/types";

export type SnapshotIndexRow = {
  code: string;
  label: string;
  region: "vn" | "asia" | "us" | "forex";
  value: number;
  changePercent: number | null;
  href: string;
};

export type GlobalPulseRow = {
  symbol: string;
  price: number;
  changePercent: number | null;
  source: string;
};

export type MarketSnapshot = {
  vnSession: VnSessionInfo;
  vnSessionHint: string;
  checkedAt: string;
  indices: SnapshotIndexRow[];
  global?: {
    us: GlobalPulseRow[];
    asia: GlobalPulseRow[];
    forex: GlobalPulseRow[];
    cryptoTip: GlobalPulseRow[];
    sources: string[];
  };
  news?: unknown[];
  crypto?: unknown;
  forex?: unknown;
};

const ASIA_YAHOO: { yahoo: string; code: string; label: string }[] = [
  { yahoo: "^N225", code: "N225", label: "Nikkei" },
  { yahoo: "^HSI", code: "HSI", label: "Hang Seng" },
  { yahoo: "000001.SS", code: "SSEC", label: "Shanghai" },
  { yahoo: "^KS11", code: "KOSPI", label: "KOSPI" },
];

const US_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
const FOREX_MAJORS = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCNH", "USDCHF", "USDCAD"]);

const BUDGET_VN_MS = 2_800;
const BUDGET_ASIA_MS = 3_200;
const BUDGET_US_MS = 3_000;
const BUDGET_FX_MS = 2_800;
const BUDGET_CRYPTO_MS = 2_500;

const SNAP_TTL_MS = 20_000;
const SNAP_STALE_MS = 120_000;

function vnLabel(code: string): string {
  if (code === "VNINDEX" || code === "VN-INDEX") return "VN-Index";
  if (code === "HNXINDEX") return "HNX";
  return code;
}

function vnHref(code: string): string {
  return `/market/index/${encodeURIComponent(code === "VNINDEX" ? "VNINDEX" : code)}`;
}

function raceTimeout<T>(ms: number, p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

type PartialPack = {
  indices: SnapshotIndexRow[];
  sources: string[];
  us?: GlobalPulseRow[];
  asia?: GlobalPulseRow[];
  forex?: GlobalPulseRow[];
  cryptoTip?: GlobalPulseRow[];
};

async function loadVn(): Promise<PartialPack> {
  const empty: PartialPack = { indices: [], sources: [] };
  try {
    const { getVnIndices } = await import("@/lib/services/stocks");
    const pack = await getVnIndices();
    if (!pack?.items?.length) return empty;
    const priority = ["VNINDEX", "VN30", "HNX", "HNXINDEX", "UPCOM", "HNX30", "VN100"];
    const sorted = [...pack.items].sort((a, b) => {
      const ia = priority.indexOf(a.code);
      const ib = priority.indexOf(b.code);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const indices: SnapshotIndexRow[] = [];
    for (const i of sorted.slice(0, 6)) {
      if (!Number.isFinite(i.value)) continue;
      indices.push({
        code: i.code,
        label: vnLabel(i.code),
        region: "vn",
        value: i.value,
        changePercent: i.changePercent ?? null,
        href: vnHref(i.code),
      });
    }
    return { indices, sources: [String(pack.meta?.source ?? "vndirect")] };
  } catch {
    return empty;
  }
}

async function loadAsia(): Promise<PartialPack> {
  const empty: PartialPack = { indices: [], sources: [], asia: [] };
  try {
    const { getYahooQuotes } = await import("@/lib/providers/yahoo");
    const map = await getYahooQuotes(ASIA_YAHOO.map((a) => a.yahoo));
    const indices: SnapshotIndexRow[] = [];
    const asia: GlobalPulseRow[] = [];
    for (const def of ASIA_YAHOO) {
      const q = map.get(def.yahoo) ?? map.get(def.code);
      if (!q || !Number.isFinite(q.price)) continue;
      asia.push({
        symbol: def.code,
        price: q.price,
        changePercent: q.changePercent ?? null,
        source: "yahoo",
      });
      indices.push({
        code: def.code,
        label: def.label,
        region: "asia",
        value: q.price,
        changePercent: q.changePercent ?? null,
        href: "/market",
      });
    }
    return { indices, sources: asia.length ? ["yahoo-asia"] : [], asia };
  } catch {
    return empty;
  }
}

async function loadUs(): Promise<PartialPack> {
  const empty: PartialPack = { indices: [], sources: [], us: [] };
  const polyP = (async (): Promise<GlobalPulseRow[]> => {
    try {
      const { getPolygonIndexSnapshots } = await import("@/lib/providers/polygon");
      const poly = await getPolygonIndexSnapshots([...US_SYMBOLS]);
      return poly.rows.map((r) => ({
        symbol: r.symbol,
        price: r.price,
        changePercent: r.changePercent,
        source: "polygon",
      }));
    } catch {
      return [];
    }
  })();
  const yahooP = (async (): Promise<GlobalPulseRow[]> => {
    try {
      const { getYahooQuotes } = await import("@/lib/providers/yahoo");
      const map = await getYahooQuotes([...US_SYMBOLS]);
      const rows: GlobalPulseRow[] = [];
      for (const sym of US_SYMBOLS) {
        const q = map.get(sym);
        if (!q || !Number.isFinite(q.price)) continue;
        rows.push({
          symbol: sym,
          price: q.price,
          changePercent: q.changePercent ?? null,
          source: "yahoo",
        });
      }
      return rows;
    } catch {
      return [];
    }
  })();

  const [polyRows, yahooRows] = await Promise.all([polyP, yahooP]);
  const us = polyRows.length ? polyRows : yahooRows;
  if (!us.length) return empty;
  const indices: SnapshotIndexRow[] = us.map((u) => ({
    code: u.symbol,
    label: u.symbol,
    region: "us" as const,
    value: u.price,
    changePercent: u.changePercent,
    href: "/market",
  }));
  return {
    indices,
    sources: [us[0]?.source === "polygon" ? "polygon" : "yahoo-us"],
    us,
  };
}

async function loadForex(): Promise<PartialPack> {
  const empty: PartialPack = { indices: [], sources: [], forex: [] };
  try {
    const { getForexMarkets } = await import("@/lib/services/forex");
    const fx = await getForexMarkets();
    const rows = fx?.data?.rows ?? [];
    const majors = rows.filter((r) => {
      const pair = String(r.pair ?? r.symbol ?? "")
        .toUpperCase()
        .replace(/[\/\s]/g, "");
      return r.group === "major" || FOREX_MAJORS.has(pair);
    });
    const pick = (majors.length ? majors : rows).slice(0, 5);
    const indices: SnapshotIndexRow[] = [];
    const forex: GlobalPulseRow[] = [];
    for (const r of pick) {
      const pair = String(r.pair ?? r.symbol ?? "")
        .toUpperCase()
        .replace(/[\/\s]/g, "");
      const px = r.price != null ? Number(r.price) : NaN;
      if (!pair || !Number.isFinite(px)) continue;
      forex.push({
        symbol: pair,
        price: px,
        changePercent: r.changePercent != null ? Number(r.changePercent) : null,
        source: String(fx?.meta?.source ?? "forex"),
      });
      indices.push({
        code: pair,
        label: pair.length === 6 ? `${pair.slice(0, 3)}/${pair.slice(3)}` : pair,
        region: "forex",
        value: px,
        changePercent: r.changePercent != null ? Number(r.changePercent) : null,
        href: `/forex/${pair}`,
      });
    }
    return {
      indices,
      sources: forex.length ? [String(fx?.meta?.source ?? "forex")] : [],
      forex,
    };
  } catch {
    return empty;
  }
}

async function loadCryptoTip(): Promise<PartialPack> {
  const empty: PartialPack = { indices: [], sources: [], cryptoTip: [] };
  try {
    const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
    const cg = await getCoinGeckoSimplePrices();
    const cryptoTip: GlobalPulseRow[] = cg.rows
      .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
      .map((r) => ({
        symbol: r.baseAsset,
        price: r.price,
        changePercent: r.changePercent,
        source: "coingecko",
      }));
    return {
      indices: [],
      sources: cryptoTip.length ? ["coingecko"] : [],
      cryptoTip,
    };
  } catch {
    return empty;
  }
}

async function produceSnapshot(): Promise<{ snapshot: MarketSnapshot; meta: Meta }> {
  const vnSession = getVnSession();
  const checkedAt = new Date().toISOString();

  const [vn, asia, us, fx, crypto] = await Promise.all([
    raceTimeout(BUDGET_VN_MS, loadVn(), { indices: [], sources: [] }),
    raceTimeout(BUDGET_ASIA_MS, loadAsia(), { indices: [], sources: [], asia: [] }),
    raceTimeout(BUDGET_US_MS, loadUs(), { indices: [], sources: [], us: [] }),
    raceTimeout(BUDGET_FX_MS, loadForex(), { indices: [], sources: [], forex: [] }),
    raceTimeout(BUDGET_CRYPTO_MS, loadCryptoTip(), { indices: [], sources: [], cryptoTip: [] }),
  ]);

  const indices: SnapshotIndexRow[] = [
    ...vn.indices,
    ...asia.indices,
    ...us.indices,
    ...fx.indices,
  ];
  const sources = [
    "vn-session",
    ...vn.sources,
    ...asia.sources,
    ...us.sources,
    ...fx.sources,
    ...crypto.sources,
  ];
  const usRows = us.us ?? [];
  const asiaRows = asia.asia ?? [];
  const forexRows = fx.forex ?? [];
  const cryptoTip = crypto.cryptoTip ?? [];

  const snapshot: MarketSnapshot = {
    vnSession,
    vnSessionHint: sessionFreshnessHint(vnSession.state),
    checkedAt,
    indices,
    global:
      usRows.length || asiaRows.length || forexRows.length || cryptoTip.length
        ? {
            us: usRows,
            asia: asiaRows,
            forex: forexRows,
            cryptoTip,
            sources: sources.filter((s) => s !== "vn-session"),
          }
        : undefined,
  };

  const meta = buildMeta({
    source: sources.join("+"),
    sourceTimestampMs: Date.now(),
    hasData: indices.length > 0,
    note: `${indices.length} chỉ số · ${vnSession.labelVi}`,
  });
  return { snapshot, meta };
}

/** Cached — soft SWR: fresh 20s · stale 120s (background refresh). */
export async function buildMarketSnapshot(): Promise<{
  snapshot: MarketSnapshot;
  meta: Meta;
}> {
  const res = await cached<{ snapshot: MarketSnapshot; meta: Meta }>({
    key: "market:snapshot:v2",
    ttlMs: SNAP_TTL_MS,
    staleMs: SNAP_STALE_MS,
    softSwr: true,
    producer: produceSnapshot,
  });
  const { snapshot, meta } = res.value;
  const session = getVnSession();
  return {
    snapshot: {
      ...snapshot,
      vnSession: session,
      vnSessionHint: sessionFreshnessHint(session.state),
      checkedAt: res.cached ? snapshot.checkedAt : new Date().toISOString(),
    },
    meta: {
      ...meta,
      cached: res.cached,
      stale: res.stale,
      note: res.cached
        ? `${meta.note ?? ""} · cache${res.stale ? " stale" : ""}`.trim()
        : meta.note,
    },
  };
}

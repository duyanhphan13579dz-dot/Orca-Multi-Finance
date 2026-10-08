/**
 * Market snapshot — VN · Asia · US · Forex for ticker + report composers.
 * Parallel sources + soft SWR + per-source timeout budget.
 */

import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "@/lib/vn/sessions";
import { buildMeta } from "@/lib/freshness";
import { cached } from "@/lib/cache";
import type { Meta, NewsArticle } from "@/lib/types";

export type SnapshotIndexRow = {
  code: string;
  label: string;
  region: "vn" | "asia" | "us" | "forex";
  value: number;
  change: number | null;
  changePercent: number | null;
  href: string;
};

export type SnapshotPulse = {
  score: number;
  headline: string;
  body: string[];
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
  pulse: SnapshotPulse;
  global?: {
    us: GlobalPulseRow[];
    asia: GlobalPulseRow[];
    forex: GlobalPulseRow[];
    cryptoTip: GlobalPulseRow[];
    sources: string[];
  };
  news?: NewsArticle[];
  crypto?: {
    summary: {
      marketCount: number;
      advancers: number;
      decliners: number;
      avgChangePercent: number;
      totalQuoteVolume: number;
      btcChangePercent: number | null;
      ethChangePercent: number | null;
    };
    top: Array<{
      baseAsset: string;
      symbol: string;
      price: number;
      changePercent: number | null;
    }>;
  };
  forex?: {
    rows: Array<{
      pair?: string;
      symbol?: string;
      price?: number;
      changePercent?: number | null;
      group?: string;
    }>;
    usdStrengthNote?: string;
  };
  commodities?: Array<{
    symbol: string;
    name?: string;
    price?: number;
    changePercent?: number | null;
  }>;
};

const ASIA_YAHOO: { yahoo: string; code: string; label: string }[] = [
  { yahoo: "^N225", code: "N225", label: "Nikkei" },
  { yahoo: "^HSI", code: "HSI", label: "Hang Seng" },
  { yahoo: "000001.SS", code: "SSEC", label: "Shanghai" },
  { yahoo: "^KS11", code: "KOSPI", label: "KOSPI" },
];

const US_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
const FOREX_MAJORS = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCNH", "USDCHF", "USDCAD"]);

const BUDGET_VN_MS = 4_500;
const BUDGET_ASIA_MS = 3_200;
const BUDGET_US_MS = 3_200;
const BUDGET_FX_MS = 3_000;
const BUDGET_CRYPTO_MS = 2_500;

const SNAP_TTL_MS = 25_000;
const SNAP_STALE_MS = 180_000;

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
  const priority = ["VNINDEX", "VN30", "HNX", "HNXINDEX", "UPCOM", "HNX30", "VN100"];

  const toRows = (items: Array<{ code: string; value: number; change?: number | null; changePercent?: number | null }>, source: string): PartialPack => {
    const sorted = [...items].sort((a, b) => {
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
        change: i.change ?? null,
        changePercent: i.changePercent ?? null,
        href: vnHref(i.code),
      });
    }
    return { indices, sources: indices.length ? [source] : [] };
  };

  try {
    const { getVnIndices, getVnMarketBoard } = await import("@/lib/services/stocks");
    // Primary: multi-source indices (SSI / VNDirect / public)
    const pack = await getVnIndices();
    if (pack?.items?.length) {
      return toRows(pack.items as any, String(pack.meta?.source ?? "vndirect"));
    }
    // Soft fallback: market board (indices + liquid quotes) so dashboard never blank
    try {
      const board = await getVnMarketBoard();
      if (board?.indices?.length) {
        return toRows(board.indices as any, String(board.meta?.source ?? "board"));
      }
    } catch {
      /* board soft-fail */
    }
    return empty;
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
        change: null,
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
    change: null,
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
        change: null,
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
  // Parallel public sources: CoinGecko + Binance 24h ticker (BTC/ETH)
  const cgP = (async (): Promise<GlobalPulseRow[]> => {
    try {
      const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
      const cg = await getCoinGeckoSimplePrices();
      return (cg.rows ?? [])
        .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
        .map((r) => ({
          symbol: r.baseAsset,
          price: r.price,
          changePercent: r.changePercent,
          source: "coingecko",
        }));
    } catch {
      return [];
    }
  })();
  const bnP = (async (): Promise<GlobalPulseRow[]> => {
    try {
      const { getAllSpotTickers } = await import("@/lib/providers/binance");
      const tickers = await getAllSpotTickers();
      const want = new Set(["BTCUSDT", "ETHUSDT"]);
      const rows: GlobalPulseRow[] = [];
      for (const t of tickers ?? []) {
        if (!want.has(t.symbol)) continue;
        const price = Number(t.lastPrice);
        if (!(price > 0)) continue;
        rows.push({
          symbol: t.symbol.replace(/USDT$/, ""),
          price,
          changePercent: Number(t.priceChangePercent) || null,
          source: "binance",
        });
      }
      return rows;
    } catch {
      return [];
    }
  })();
  try {
    const [cgRows, bnRows] = await Promise.all([cgP, bnP]);
    // Prefer CoinGecko when present; fill gaps from Binance
    const by = new Map<string, GlobalPulseRow>();
    for (const r of bnRows) by.set(r.symbol, r);
    for (const r of cgRows) by.set(r.symbol, r); // cg wins
    const cryptoTip = [...by.values()];
    const sources = [...new Set(cryptoTip.map((r) => r.source))];
    return {
      indices: [],
      sources,
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

  const vnIdx =
    indices.find((i) => i.region === "vn" && (i.code === "VNINDEX" || i.code === "VN-INDEX")) ??
    indices.find((i) => i.region === "vn") ??
    null;
  const pulseScoreRaw =
    vnIdx?.changePercent != null
      ? Math.max(-1, Math.min(1, vnIdx.changePercent / 2))
      : indices.length
        ? Math.max(
            -1,
            Math.min(
              1,
              indices.reduce((s, i) => s + (i.changePercent ?? 0), 0) / indices.length / 2,
            ),
          )
        : 0;
  const pulse: SnapshotPulse = {
    score: pulseScoreRaw,
    headline: vnIdx
      ? `${vnIdx.label} ${vnIdx.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${vnIdx.changePercent != null && vnIdx.changePercent >= 0 ? "+" : ""}${vnIdx.changePercent?.toFixed(2) ?? "—"}%)`
      : indices.length
        ? `${indices.length} chỉ số đã cập nhật`
        : "Chưa có chỉ số LIVE — chờ nguồn",
    body: [
      vnIdx
        ? `VN: ${vnIdx.label} ${vnIdx.changePercent != null ? (vnIdx.changePercent >= 0 ? "+" : "") + vnIdx.changePercent.toFixed(2) + "%" : "—"}`
        : "VN-Index chưa có dữ liệu trong snapshot.",
      usRows.length
        ? `Mỹ: ${usRows
            .map(
              (u) =>
                `${u.symbol} ${u.changePercent != null ? (u.changePercent >= 0 ? "+" : "") + u.changePercent.toFixed(2) + "%" : "—"}`,
            )
            .slice(0, 3)
            .join(" · ")}`
        : "Mỹ: chưa có SPY/QQQ trong snapshot.",
      forexRows.length
        ? `Forex: ${forexRows.slice(0, 3).map((f) => f.symbol).join(", ")}`
        : "Forex: chưa có majors LIVE.",
    ],
  };

  let cryptoBlock: MarketSnapshot["crypto"];
  if (cryptoTip.length) {
    const btc = cryptoTip.find((c) => /BTC/i.test(c.symbol));
    const eth = cryptoTip.find((c) => /ETH/i.test(c.symbol));
    const chgs = cryptoTip
      .map((c) => c.changePercent)
      .filter((x): x is number => x != null && Number.isFinite(x));
    cryptoBlock = {
      summary: {
        marketCount: cryptoTip.length,
        advancers: chgs.filter((x) => x > 0).length,
        decliners: chgs.filter((x) => x < 0).length,
        avgChangePercent: chgs.length ? chgs.reduce((a, b) => a + b, 0) / chgs.length : 0,
        totalQuoteVolume: 0,
        btcChangePercent: btc?.changePercent ?? null,
        ethChangePercent: eth?.changePercent ?? null,
      },
      top: cryptoTip.map((c) => ({
        baseAsset: c.symbol,
        symbol: `${c.symbol}USDT`,
        price: c.price,
        changePercent: c.changePercent,
      })),
    };
  }

  let forexBlock: MarketSnapshot["forex"];
  if (forexRows.length || fx.indices.length) {
    const rows = forexRows.length
      ? forexRows.map((f) => ({
          pair: f.symbol,
          symbol: f.symbol,
          price: f.price,
          changePercent: f.changePercent,
          group: "major",
        }))
      : fx.indices.map((i) => ({
          pair: i.code,
          symbol: i.code,
          price: i.value,
          changePercent: i.changePercent,
          group: "major",
        }));
    const usdUp = rows.filter((r) => r.pair?.startsWith("USD") && (r.changePercent ?? 0) > 0).length;
    const usdDown = rows.filter((r) => r.pair?.startsWith("USD") && (r.changePercent ?? 0) < 0).length;
    forexBlock = {
      rows,
      usdStrengthNote:
        usdUp + usdDown > 0
          ? `USD majors: ${usdUp} tăng / ${usdDown} giảm trong snapshot — theo dõi DXY/USDVND.`
          : rows.length
            ? `Majors: ${rows.slice(0, 3).map((r) => r.pair).join(", ")}.`
            : undefined,
    };
  }

  const snapshot: MarketSnapshot = {
    vnSession,
    vnSessionHint: sessionFreshnessHint(vnSession.state),
    checkedAt,
    indices,
    pulse,
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
    crypto: cryptoBlock,
    forex: forexBlock,
  };

  const meta = buildMeta({
    source: sources.join("+"),
    sourceTimestampMs: Date.now(),
    hasData: indices.length > 0,
    note: `${indices.length} chỉ số · ${vnSession.labelVi}`,
  });
  return { snapshot, meta };
}

/** Cached — soft SWR: fresh 25s · stale 180s. Signature: cached(key, opts). */
export async function buildMarketSnapshot(): Promise<{
  snapshot: MarketSnapshot;
  meta: Meta;
}> {
  const res = await cached<{ snapshot: MarketSnapshot; meta: Meta }>("market:snapshot:v2", {
    ttlMs: SNAP_TTL_MS,
    staleMs: SNAP_STALE_MS,
    softSwr: true,
    producer: produceSnapshot,
  });
  const { snapshot, meta } = res.value;
  const session = getVnSession();
  const safePulse = snapshot.pulse ?? {
    score: 0,
    headline: "Chưa có pulse",
    body: [] as string[],
  };
  return {
    snapshot: {
      ...snapshot,
      pulse: safePulse,
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

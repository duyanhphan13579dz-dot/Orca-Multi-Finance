/**
 * Market snapshot — VN indices + Asia + US + Forex majors for ticker tape & shell.
 */

import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "@/lib/vn/sessions";
import { buildMeta } from "@/lib/freshness";
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
  /** Unified ticker rows — VN / Asia / US / Forex */
  indices: SnapshotIndexRow[];
  /** Legacy shape kept for other consumers */
  global?: {
    us: GlobalPulseRow[];
    asia: GlobalPulseRow[];
    forex: GlobalPulseRow[];
    cryptoTip: GlobalPulseRow[];
    sources: string[];
  };
  /** Optional — composers may attach later */
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
const FOREX_MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCNH"] as const;

function vnLabel(code: string): string {
  if (code === "VNINDEX" || code === "VN-INDEX") return "VN-Index";
  if (code === "HNXINDEX") return "HNX";
  return code;
}

function vnHref(code: string): string {
  return `/market/index/${encodeURIComponent(code === "VNINDEX" ? "VNINDEX" : code)}`;
}

export async function buildMarketSnapshot(): Promise<{
  snapshot: MarketSnapshot;
  meta: Meta;
}> {
  const vnSession = getVnSession();
  const checkedAt = new Date().toISOString();
  const sources: string[] = ["vn-session"];
  const indices: SnapshotIndexRow[] = [];
  let us: GlobalPulseRow[] = [];
  let asia: GlobalPulseRow[] = [];
  let forex: GlobalPulseRow[] = [];
  let cryptoTip: GlobalPulseRow[] = [];

  // —— VN indices ——
  try {
    const { getVnIndices } = await import("@/lib/services/stocks");
    const pack = await getVnIndices();
    if (pack?.items?.length) {
      sources.push(String(pack.meta?.source ?? "vndirect"));
      const priority = ["VNINDEX", "VN30", "HNX", "HNXINDEX", "UPCOM", "HNX30", "VN100"];
      const sorted = [...pack.items].sort((a, b) => {
        const ia = priority.indexOf(a.code);
        const ib = priority.indexOf(b.code);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
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
    }
  } catch {
    /* optional */
  }

  // —— Asia (Yahoo) ——
  try {
    const { getYahooQuotes } = await import("@/lib/providers/yahoo");
    const map = await getYahooQuotes(ASIA_YAHOO.map((a) => a.yahoo));
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
    if (asia.length) sources.push("yahoo-asia");
  } catch {
    /* optional */
  }

  // —— US (Polygon → Yahoo ETF) ——
  try {
    const { getPolygonIndexSnapshots } = await import("@/lib/providers/polygon");
    const poly = await getPolygonIndexSnapshots([...US_SYMBOLS]);
    us = poly.rows.map((r) => ({
      symbol: r.symbol,
      price: r.price,
      changePercent: r.changePercent,
      source: "polygon",
    }));
    if (us.length) sources.push("polygon");
  } catch {
    /* optional */
  }
  if (!us.length) {
    try {
      const { getYahooQuotes } = await import("@/lib/providers/yahoo");
      const map = await getYahooQuotes([...US_SYMBOLS]);
      for (const sym of US_SYMBOLS) {
        const q = map.get(sym);
        if (!q || !Number.isFinite(q.price)) continue;
        us.push({
          symbol: sym,
          price: q.price,
          changePercent: q.changePercent ?? null,
          source: "yahoo",
        });
      }
      if (us.length) sources.push("yahoo-us");
    } catch {
      /* optional */
    }
  }
  for (const u of us) {
    indices.push({
      code: u.symbol,
      label: u.symbol,
      region: "us",
      value: u.price,
      changePercent: u.changePercent,
      href: "/market",
    });
  }

  // —— Forex majors ——
  try {
    const { getForexMarkets } = await import("@/lib/services/forex");
    const fx = await getForexMarkets();
    const rows = fx?.data?.rows ?? [];
    const majors = rows.filter(
      (r) =>
        r.group === "major" ||
        FOREX_MAJORS.includes(
          String(r.pair ?? r.symbol ?? "")
            .toUpperCase()
            .replace(/[\/\s]/g, "") as (typeof FOREX_MAJORS)[number],
        ),
    );
    const pick = (majors.length ? majors : rows).slice(0, 5);
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
    if (forex.length) sources.push(String(fx?.meta?.source ?? "forex"));
  } catch {
    /* optional */
  }

  // —— Crypto tip ——
  try {
    const { getCoinGeckoSimplePrices } = await import("@/lib/providers/coingecko");
    const cg = await getCoinGeckoSimplePrices();
    cryptoTip = cg.rows
      .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
      .map((r) => ({
        symbol: r.baseAsset,
        price: r.price,
        changePercent: r.changePercent,
        source: "coingecko",
      }));
    if (cryptoTip.length) sources.push("coingecko");
  } catch {
    /* optional */
  }

  const snapshot: MarketSnapshot = {
    vnSession,
    vnSessionHint: sessionFreshnessHint(vnSession.state),
    checkedAt,
    indices,
    global:
      us.length || asia.length || forex.length || cryptoTip.length
        ? {
            us,
            asia,
            forex,
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

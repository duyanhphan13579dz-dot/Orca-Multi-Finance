import { safeApi } from "@/lib/safe-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const ASIA_YAHOO: { yahoo: string; key: string; label: string }[] = [
  { yahoo: "^N225", key: "N225", label: "Nikkei 225" },
  { yahoo: "^HSI", key: "HSI", label: "Hang Seng" },
  { yahoo: "000001.SS", key: "SSEC", label: "Shanghai" },
  { yahoo: "^KS11", key: "KOSPI", label: "KOSPI" },
];

const US_ETF = ["SPY", "QQQ", "DIA", "IWM"] as const;

type UsRow = { symbol: string; price: number; changePercent: number | null };
type CryptoRow = {
  symbol: string;
  baseAsset: string;
  price: number;
  changePercent: number | null;
};
type AsiaRow = {
  symbol: string;
  label: string;
  price: number;
  changePercent: number | null;
};

async function loadUs(): Promise<{ rows: UsRow[]; source: string }> {
  try {
    const { getYahooQuotes } = await import("@/lib/providers/yahoo");
    const map = await getYahooQuotes([...US_ETF]);
    const rows: UsRow[] = [];
    for (const sym of US_ETF) {
      const q = map.get(sym);
      if (!q || !(q.price > 0)) continue;
      rows.push({ symbol: sym, price: q.price, changePercent: q.changePercent ?? null });
    }
    if (rows.length) return { rows, source: "yahoo-us" };
  } catch {
    /* */
  }
  return { rows: [], source: "none" };
}

async function loadCrypto(): Promise<{ rows: CryptoRow[]; source: string }> {
  try {
    const { getCryptoMarkets } = await import("@/lib/services/crypto");
    const m = await getCryptoMarkets();
    if (m?.rows?.length) {
      const rows = m.rows
        .filter((r) => r.symbol === "BTCUSDT" || r.symbol === "ETHUSDT")
        .map((r) => ({
          symbol: r.symbol,
          baseAsset: r.baseAsset,
          price: r.price,
          changePercent: r.changePercent,
        }));
      if (rows.length) return { rows, source: m.meta.source ?? "crypto" };
    }
  } catch {
    /* */
  }
  return { rows: [], source: "none" };
}

async function loadAsia(): Promise<{ rows: AsiaRow[]; source: string }> {
  try {
    const { getYahooQuotes } = await import("@/lib/providers/yahoo");
    const map = await getYahooQuotes(ASIA_YAHOO.map((a) => a.yahoo));
    const rows: AsiaRow[] = [];
    for (const def of ASIA_YAHOO) {
      const q = map.get(def.yahoo);
      if (!q || !(q.price > 0)) continue;
      rows.push({
        symbol: def.key,
        label: def.label,
        price: q.price,
        changePercent: q.changePercent ?? null,
      });
    }
    if (rows.length) return { rows, source: "yahoo-asia" };
  } catch {
    /* */
  }
  return { rows: [], source: "none" };
}

async function loadLiqSpark(): Promise<{
  volumes: number[];
  times: (string | null)[];
  source: string;
  symbol: string;
} | null> {
  try {
    const { getVnOhlcv } = await import("@/lib/services/stocks");
    const pack = await getVnOhlcv("VNINDEX", 20);
    const bars = pack?.bars ?? [];
    const withVol = bars.filter((b) => b.volume != null && b.volume > 0);
    if (withVol.length >= 4) {
      const slice = withVol.slice(-12);
      return {
        volumes: slice.map((b) => Number(b.volume) || 0),
        times: slice.map((b) => (b.time ? new Date(b.time).toISOString().slice(0, 10) : null)),
        source: pack?.meta?.source ?? "vn-ohlcv",
        symbol: "VNINDEX",
      };
    }
  } catch {
    /* */
  }
  return null;
}

export async function GET() {
  return safeApi({
    label: "market-global",
    guard: { wallMs: 12_000, maxSubrequests: 18, maxConcurrent: 3 },
    produce: async () => {
      const [usP, cryptoP, asiaP, liqP] = await Promise.all([
        loadUs(),
        loadCrypto(),
        loadAsia(),
        loadLiqSpark(),
      ]);

      const sources = [usP.source, cryptoP.source, asiaP.source].filter((s) => s && s !== "none");
      if (liqP) sources.push(`liq:${liqP.source}`);

      return {
        data: {
          us: usP.rows,
          crypto: cryptoP.rows,
          asia: asiaP.rows,
          liquiditySpark: liqP,
          sources,
          at: new Date().toISOString(),
        },
        meta: {
          source: sources.join("+") || "partial",
          sourceTimestampMs: Date.now(),
          partial: !usP.rows.length || !cryptoP.rows.length || !asiaP.rows.length,
          note: `us=${usP.rows.length} crypto=${cryptoP.rows.length} asia=${asiaP.rows.length}`,
        },
        headers: {
          "Cache-Control": "private, max-age=20, stale-while-revalidate=90",
        },
      };
    },
    fallback: async () => ({
      data: {
        us: [],
        crypto: [],
        asia: [],
        liquiditySpark: null,
        sources: [],
        at: new Date().toISOString(),
      },
      meta: {
        source: "global-shell",
        partial: true,
        stale: true,
        note: "Global market shell — đang kết nối lại",
      },
    }),
    unavailableSource: "global",
    unavailableNote: "Global market data tạm gián đoạn",
  });
}

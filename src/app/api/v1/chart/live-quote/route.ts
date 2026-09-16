import { ok, badRequest } from "@/lib/envelope";
import { ensureVndirectWsStarted, vndirectWs } from "@/lib/realtime/vndirect-ws";
import { getVnQuotes } from "@/lib/services/stocks";
import * as vndirect from "@/lib/providers/vndirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INDEX_ALIASES: Record<string, string[]> = {
  VNINDEX: ["VNINDEX", "VNI"],
  VNI: ["VNINDEX", "VNI"],
  HNX: ["HNX", "HNXINDEX"],
  HNXINDEX: ["HNX", "HNXINDEX"],
  UPCOM: ["UPCOM", "UPCOMINDEX"],
  UPCOMINDEX: ["UPCOM", "UPCOMINDEX"],
};

/**
 * GET /api/v1/chart/live-quote?symbol=EURUSD&assetType=forex
 * stock: VNDirect WS→REST · forex: Yahoo→Biquote→ER-API
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const assetType = (url.searchParams.get("assetType") ?? "stock").toLowerCase();
  if (!symbol) return badRequest("symbol required");

  if (assetType === "forex") {
    const pair = symbol.length >= 6 ? symbol.slice(0, 6) : symbol;
    const ySym = `${pair.slice(0, 3)}${pair.slice(3, 6)}=X`;

    try {
      const { getYahooQuote } = await import("@/lib/providers/yahoo");
      const q = await getYahooQuote(ySym);
      if (q?.price && q.price > 0) {
        return ok(
          {
            symbol: pair,
            price: q.price,
            open: q.previousClose,
            high: q.dayHigh,
            low: q.dayLow,
            volume: 0,
            ts: q.marketTime ?? Date.now(),
            source: "yahoo-fx",
          },
          { source: "yahoo-fx", sourceTimestampMs: q.marketTime ?? Date.now() },
        );
      }
    } catch {
      /* next */
    }

    try {
      const { getBiquoteQuotes } = await import("@/lib/providers/forex");
      const bq = await getBiquoteQuotes([pair, `${pair.slice(0, 3)}/${pair.slice(3, 6)}`]);
      const price = bq.rates[pair] ?? bq.rates[Object.keys(bq.rates)[0] ?? ""];
      if (price && price > 0) {
        return ok(
          {
            symbol: pair,
            price,
            open: null,
            high: null,
            low: null,
            volume: 0,
            ts: bq.ts ?? Date.now(),
            source: "biquote",
          },
          { source: "biquote", sourceTimestampMs: bq.ts ?? Date.now() },
        );
      }
    } catch {
      /* next */
    }

    try {
      const { getErApiLatest } = await import("@/lib/providers/forex");
      const base = pair.slice(0, 3);
      const quote = pair.slice(3, 6);
      const er = await getErApiLatest();
      let rate: number | null = null;
      if (base === "USD" && er.rates[quote]) rate = er.rates[quote];
      else if (quote === "USD" && er.rates[base]) rate = 1 / er.rates[base];
      else if (er.rates[base] && er.rates[quote]) rate = er.rates[quote] / er.rates[base];
      if (rate && rate > 0) {
        return ok(
          {
            symbol: pair,
            price: rate,
            open: null,
            high: null,
            low: null,
            volume: 0,
            ts: er.ts ?? Date.now(),
            source: er.source ?? "exchangerate-api",
          },
          { source: er.source ?? "exchangerate-api", sourceTimestampMs: er.ts ?? Date.now() },
        );
      }
    } catch {
      /* next */
    }

    return ok(null, { source: "none", note: "forex live quote unavailable" });
  }

  if (process.env.VNDIRECT_WS_DISABLED !== "true") {
    try {
      ensureVndirectWsStarted();
      if (vndirect.isVnIndexSymbol(symbol)) vndirectWs.ensureCoreIndices();
      else vndirectWs.watchSymbol(symbol);
    } catch {
      /* non-fatal */
    }
  }

  if (vndirect.isVnIndexSymbol(symbol)) {
    const codes = INDEX_ALIASES[symbol] ?? [vndirect.vndIndexCode(symbol)];
    for (const c of codes) {
      const idx = vndirectWs.getIndex(c, 60_000);
      if (idx && idx.value > 0) {
        return ok(
          {
            symbol: idx.code,
            price: idx.value,
            open: null,
            high: null,
            low: null,
            volume: idx.volume ?? 0,
            ts: idx.eventTime,
            source: "vndirect-ws",
          },
          { source: "vndirect-ws", sourceTimestampMs: idx.eventTime },
        );
      }
    }
  } else {
    const q = vndirectWs.getQuote(symbol, 60_000);
    if (q && q.price > 0) {
      return ok(
        {
          symbol: q.symbol,
          price: q.price,
          open: q.open,
          high: q.high,
          low: q.low,
          volume: q.volume,
          ts: q.eventTime,
          source: "vndirect-ws",
        },
        { source: "vndirect-ws", sourceTimestampMs: q.eventTime },
      );
    }
  }

  try {
    const r = await getVnQuotes([symbol]);
    const qq = r?.quotes?.[0];
    if (qq && qq.price > 0) {
      const ts = qq.updatedAt ? Date.parse(qq.updatedAt) || Date.now() : Date.now();
      return ok(
        {
          symbol: qq.symbol,
          price: qq.price,
          open: qq.open,
          high: qq.high,
          low: qq.low,
          volume: qq.volume ?? 0,
          ts,
          source: r?.meta?.source ?? "vndirect",
        },
        r?.meta ?? { source: "vndirect", sourceTimestampMs: ts },
      );
    }
  } catch {
    /* fallthrough */
  }

  return ok(null, { source: "none", note: "no live quote" });
}

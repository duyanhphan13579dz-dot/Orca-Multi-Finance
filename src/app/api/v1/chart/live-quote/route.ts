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

/** GET /api/v1/chart/live-quote?symbol=VNM — lightweight last price (WS → REST). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return badRequest("symbol required");

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

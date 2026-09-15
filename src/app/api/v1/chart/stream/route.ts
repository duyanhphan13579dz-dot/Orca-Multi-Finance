import { eventBus } from "@/lib/events";
import { candleAggregator } from "@/lib/realtime/candles";
import { ensureBinanceWsStarted } from "@/lib/realtime/binance-ws";
import { ensureVndirectWsStarted, vndirectWs } from "@/lib/realtime/vndirect-ws";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INDEX_CODES = new Set([
  "VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VNXALL", "VN100", "HNXINDEX", "UPCOMINDEX", "VNI",
]);

const INDEX_ALIASES: Record<string, string[]> = {
  VNINDEX: ["VNINDEX", "VNI"],
  VNI: ["VNINDEX", "VNI"],
  HNX: ["HNX", "HNXINDEX"],
  HNXINDEX: ["HNX", "HNXINDEX"],
  UPCOM: ["UPCOM", "UPCOMINDEX"],
  UPCOMINDEX: ["UPCOM", "UPCOMINDEX"],
};

/**
 * REALTIME CHART STREAM (SSE).
 * VN: VNDirect WS + 1.5s poll (WS cache → REST) — realtime ổn định, seed nhanh.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const assetType = (url.searchParams.get("assetType") ?? "crypto") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "5m";

  if (!symbol || !tfsFor(assetType).includes(timeframe)) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "params không hợp lệ" } }),
      { status: 400 },
    );
  }

  if (assetType === "crypto") ensureBinanceWsStarted();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let unwatchVnd: (() => void) | null = null;
  let offFns: (() => void)[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastPollPrice: number | null = null;

  const isIndex = assetType === "stock" && INDEX_CODES.has(symbol);

  if (assetType === "stock") {
    ensureVndirectWsStarted();
    if (isIndex) {
      vndirectWs.ensureCoreIndices();
      unwatchVnd = null;
    } else {
      unwatchVnd = vndirectWs.watchSymbol(symbol);
    }

    await Promise.race([
      (async () => {
        try {
          const { getVnOhlcv } = await import("@/lib/services/stocks");
          const r = await getVnOhlcv(symbol, 2);
          const last = r?.bars?.at(-1);
          if (last && last.time > 0 && last.close > 0) {
            candleAggregator.seed(
              symbol,
              timeframe,
              {
                time: last.time,
                open: last.open,
                high: last.high,
                low: last.low,
                close: last.close,
                volume: last.volume,
              },
              "vndirect",
            );
          }
        } catch {
          /* best-effort */
        }
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 180)),
    ]);
  }

  const injectTick = (price: number, ts: number, volume: number, source: "vndirect" | "ssi-fallback") => {
    if (!Number.isFinite(price) || price <= 0) return;
    lastPollPrice = price;
    eventBus.emit(`market-tick:${symbol}`, {
      symbol,
      price,
      cumVolume: Math.max(0, volume),
      cumQuoteVolume: 0,
      ts: ts > 0 ? ts : Date.now(),
      source,
      degraded: source !== "vndirect",
    });
  };

  const resolveLivePrice = async (): Promise<{
    price: number;
    ts: number;
    volume: number;
    source: "vndirect" | "ssi-fallback";
  } | null> => {
    if (isIndex) {
      const codes = INDEX_ALIASES[symbol] ?? [symbol];
      for (const c of codes) {
        const idx = vndirectWs.getIndex(c, 60_000);
        if (idx && idx.value > 0) {
          return { price: idx.value, ts: idx.eventTime, volume: idx.volume ?? 0, source: "vndirect" };
        }
      }
    } else {
      const q = vndirectWs.getQuote(symbol, 60_000);
      if (q && q.price > 0) {
        return { price: q.price, ts: q.eventTime, volume: q.volume, source: "vndirect" };
      }
    }
    try {
      const { getVnQuotes } = await import("@/lib/services/stocks");
      const r = await getVnQuotes([symbol]);
      const qq = r?.quotes?.[0];
      if (qq && qq.price > 0) {
        return {
          price: qq.price,
          ts: qq.updatedAt ? Date.parse(qq.updatedAt) || Date.now() : Date.now(),
          volume: qq.volume ?? 0,
          source: "vndirect",
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };

      if (assetType === "crypto") {
        unsubscribe = candleAggregator.subscribe(symbol, timeframe, { assetClass: "crypto" });
        offFns = [
          eventBus.on(`candle.updated:${symbol}:${timeframe}`, (p) => send("chart.candle.updated", p)),
          eventBus.on(`candle.closed:${symbol}:${timeframe}`, (p) => send("chart.candle.closed", p)),
        ];
        const snap = candleAggregator.snapshot(symbol, timeframe);
        send("snapshot", {
          symbol,
          timeframe,
          candle: snap,
          live: Boolean(snap),
          note: snap ? undefined : "chờ tick đầu tiên / stream đang kết nối",
        });
      } else if (assetType === "stock") {
        unsubscribe = candleAggregator.subscribe(symbol, timeframe, {
          assetClass: isIndex ? "vn-index" : "vn-stock",
        });
        offFns = [
          eventBus.on(`candle.updated:${symbol}:${timeframe}`, (p) => send("chart.candle.updated", p)),
          eventBus.on(`candle.closed:${symbol}:${timeframe}`, (p) => send("chart.candle.closed", p)),
        ];

        void resolveLivePrice().then((live) => {
          if (live) injectTick(live.price, live.ts, live.volume, live.source);
        });

        pollTimer = setInterval(() => {
          void resolveLivePrice().then((live) => {
            if (live) injectTick(live.price, live.ts, live.volume, live.source);
          });
        }, 1_500);
        pollTimer.unref?.();

        const snap = candleAggregator.snapshot(symbol, timeframe);
        const vndDisabled = process.env.VNDIRECT_WS_DISABLED === "true";
        send("snapshot", {
          symbol,
          timeframe,
          candle: snap,
          live: true,
          source: vndDisabled ? "ssi-fallback+http-poll" : "vndirect-ws+poll",
          note: snap ? undefined : "đang kết nối VNDirect (WS + poll 1.5s)",
        });
      } else {
        send("snapshot", {
          symbol,
          timeframe,
          candle: null,
          live: false,
          source: "frankfurter-http",
          note: "Frankfurter/ECB chart history dùng HTTP",
        });
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 12_000);
      heartbeat.unref?.();
    },
    cancel() {
      unsubscribe?.();
      unwatchVnd?.();
      for (const f of offFns) f();
      if (heartbeat) clearInterval(heartbeat);
      if (pollTimer) clearInterval(pollTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

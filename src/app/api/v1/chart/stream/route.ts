import { eventBus } from "@/lib/events";
import { candleAggregator } from "@/lib/realtime/candles";
import { ensureBinanceWsStarted } from "@/lib/realtime/binance-ws";
import { ensureVndirectWsStarted, vndirectWs } from "@/lib/realtime/vndirect-ws";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * REALTIME CHART STREAM (SSE) — centralized subscription manager.
 *
 * GET /api/v1/chart/stream?symbol=BTCUSDT&assetType=crypto&timeframe=5m
 * GET /api/v1/chart/stream?symbol=VNM&assetType=stock&timeframe=1d
 *
 * Events: snapshot, chart.candle.updated, chart.candle.closed, heartbeat.
 * One provider feed per symbol regardless of viewer count (subscription
 * dedup enforced by candleAggregator).
 *
 * Stock path: VNDirect WS (primary) → marketTickRouter → candleAggregator;
 * SSI WS remains fallback inside market-ticks.
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

  if (assetType === "stock") {
    ensureVndirectWsStarted();
    unwatchVnd = vndirectWs.watchSymbol(symbol);
    const isIndex = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VNXALL", "VN100"].includes(symbol);
    if (isIndex) vndirectWs.ensureCoreIndices();
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
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
        const isIndex = ["VNINDEX", "VN30", "HNX", "HNX30", "UPCOM", "VNXALL", "VN100"].includes(symbol);
        unsubscribe = candleAggregator.subscribe(symbol, timeframe, {
          assetClass: isIndex ? "vn-index" : "vn-stock",
        });
        offFns = [
          eventBus.on(`candle.updated:${symbol}:${timeframe}`, (p) => send("chart.candle.updated", p)),
          eventBus.on(`candle.closed:${symbol}:${timeframe}`, (p) => send("chart.candle.closed", p)),
        ];
        const snap = candleAggregator.snapshot(symbol, timeframe);
        const vndDisabled = process.env.VNDIRECT_WS_DISABLED === "true";
        send("snapshot", {
          symbol,
          timeframe,
          candle: snap,
          live: Boolean(snap) || !vndDisabled,
          source: vndDisabled ? "ssi-fallback+http" : "vndirect-ws",
          note: snap
            ? undefined
            : vndDisabled
              ? "VNDirect WS disabled — fallback SSI/HTTP; chờ tick hoặc history"
              : "chờ tick VNDirect/SSI / stream đang kết nối",
        });
      } else {
        send("snapshot", {
          symbol,
          timeframe,
          candle: null,
          live: false,
          source: "frankfurter-http",
          note: "Frankfurter/ECB chart history dùng HTTP; không có websocket FX công khai.",
        });
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 15_000);
      heartbeat.unref?.();
    },
    cancel() {
      unsubscribe?.();
      unwatchVnd?.();
      for (const f of offFns) f();
      if (heartbeat) clearInterval(heartbeat);
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

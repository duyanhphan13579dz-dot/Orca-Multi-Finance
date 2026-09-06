import { eventBus } from "@/lib/events";
import { payloadOf } from "@/lib/realtime/event-envelope";
import { candleAggregator } from "@/lib/realtime/candles";
import { ensureBinanceWsStarted } from "@/lib/realtime/binance-ws";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * REALTIME CHART STREAM (SSE) — centralized subscription manager.
 *
 * GET /api/v1/chart/stream?symbol=BTCUSDT&assetType=crypto&timeframe=5m
 *
 * Events: snapshot, chart.candle.updated, chart.candle.closed, heartbeat.
 * One provider feed per symbol regardless of viewer count (subscription
 * dedup enforced by candleAggregator).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const assetType = (url.searchParams.get("assetType") ?? "crypto") as ChartAssetType;
  const timeframe = url.searchParams.get("timeframe") ?? "5m";

  if (!symbol || !tfsFor(assetType).includes(timeframe)) {
    return new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "params không hợp lệ" } }), { status: 400 });
  }

  ensureBinanceWsStarted();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let offFns: (() => void)[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;

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
        unsubscribe = candleAggregator.subscribe(symbol, timeframe, { crypto: true });
        offFns = [
          // unwrap typed envelopes → keep the public SSE payload contract stable
          eventBus.on(`candle.updated:${symbol}:${timeframe}`, (p) => send("chart.candle.updated", payloadOf(p))),
          eventBus.on(`candle.closed:${symbol}:${timeframe}`, (p) => send("chart.candle.closed", payloadOf(p))),
        ];
        const snap = candleAggregator.snapshot(symbol, timeframe);
        send("snapshot", { symbol, timeframe, candle: snap, live: Boolean(snap), note: snap ? undefined : "chờ tick đầu tiên / stream đang kết nối" });
      } else {
        send("snapshot", { symbol, timeframe, candle: null, live: false, note: `${assetType} hiện stream qua REST refresh — nến mới cập nhật khi poll cycle chạy` });
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

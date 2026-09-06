import { candleAggregator } from "@/lib/realtime/candles";
import { ensureBinanceWsStarted, binanceWs } from "@/lib/realtime/binance-ws";
import { eventBus } from "@/lib/events";
import { buildScalpSignal } from "@/lib/services/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * REALTIME SCALP SIGNAL STREAM (SSE)
 *
 * GET /api/v1/crypto/{symbol}/scalp/stream?tf=5m
 *
 * - Subscribes centralized Binance kline WS via candleAggregator (M15/M5/M1)
 * - Recomputes quant scalp signal on candle close (and throttled updates)
 * - Events: snapshot, scalp.signal, heartbeat
 */

const TF = new Set(["1m", "5m", "15m"]);

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  if (!/^[A-Za-z0-9]{2,20}$/.test(raw)) {
    return new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Symbol khong hop le" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const tf = new URL(req.url).searchParams.get("tf") ?? "5m";
  if (!TF.has(tf)) {
    return new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "tf phai la 1m | 5m | 15m" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sym = raw.toUpperCase().endsWith("USDT") ? raw.toUpperCase() : `${raw.toUpperCase()}USDT`;
  ensureBinanceWsStarted();

  const encoder = new TextEncoder();
  let closed = false;
  const unsubs: (() => void)[] = [];
  const offFns: (() => void)[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastPush = 0;
  let computing = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      const pushSignal = async (reason: string) => {
        if (closed || computing) return;
        const now = Date.now();
        if (reason !== "close" && now - lastPush < 2_500) return;
        computing = true;
        try {
          const r = await buildScalpSignal(sym, tf);
          if (!r || closed) return;
          lastPush = Date.now();
          const wsLive = Boolean(binanceWs.getTicker(sym, 10_000)) || r.result.wsLive;
          send(reason === "init" ? "snapshot" : "scalp.signal", {
            ...r.result,
            wsLive,
            reason,
            pushedAt: new Date().toISOString(),
            meta: {
              source: r.meta.source,
              freshness: r.meta.freshness,
              ageMs: r.meta.ageMs,
              qualityStatus: r.meta.qualityStatus,
            },
          });
        } catch {
          /* keep stream alive */
        } finally {
          computing = false;
        }
      };

      unsubs.push(
        candleAggregator.subscribe(sym, "15m", { crypto: true }),
        candleAggregator.subscribe(sym, "5m", { crypto: true }),
        candleAggregator.subscribe(sym, "1m", { crypto: true }),
      );

      for (const interval of ["15m", "5m", "1m"] as const) {
        offFns.push(
          eventBus.on(`candle.closed:${sym}:${interval}`, () => {
            void pushSignal("close");
          }),
        );
        if (interval === tf) {
          offFns.push(
            eventBus.on(`candle.updated:${sym}:${interval}`, () => {
              void pushSignal("tick");
            }),
          );
        }
      }

      await pushSignal("init");

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          const tick = binanceWs.getTicker(sym, 15_000);
          controller.enqueue(
            encoder.encode(
              `event: heartbeat\ndata: ${JSON.stringify({
                t: Date.now(),
                wsLive: Boolean(tick),
                price: tick?.price ?? null,
                klineStreams: binanceWs.getStats().klineStreams,
              })}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      }, 12_000);
      heartbeat.unref?.();
    },
    cancel() {
      closed = true;
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* noop */
        }
      }
      for (const f of offFns) {
        try {
          f();
        } catch {
          /* noop */
        }
      }
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

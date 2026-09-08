import { candleAggregator } from "@/lib/realtime/candles";
import { ensureBinanceWsStarted, binanceWs } from "@/lib/realtime/binance-ws";
import { eventBus } from "@/lib/events";
import { buildScalpSignal } from "@/lib/services/intelligence";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * REALTIME SCALP SIGNAL STREAM (SSE) — compute-light
 *
 * Full quant rebuild only on: init + candle close (M15/M5/M1).
 * Tick updates push last price only (no multi-TF REST).
 * Heartbeat carries price + ws state without recomputing signal.
 */

const TF = new Set(["1m", "5m", "15m"]);

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const session = await getSessionUser();
  if (!session) {
    return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED", message: "Đăng nhập để sử dụng Crypto" } }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
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
  let lastFull = 0;
  let computing = false;
  let lastResult: unknown = null;

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

      const pushFull = async (reason: string) => {
        if (closed || computing) return;
        if (reason === "close" && Date.now() - lastFull < 1_200) return;
        computing = true;
        try {
          const r = await buildScalpSignal(sym, tf);
          if (!r || closed) return;
          lastFull = Date.now();
          const wsLive = Boolean(binanceWs.getTicker(sym, 10_000)) || r.result.wsLive;
          lastResult = r.result;
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
          /* keep alive */
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
            void pushFull("close");
          }),
        );
      }

      offFns.push(
        eventBus.on(`tick:${sym}`, (p) => {
          if (closed || !lastResult) return;
          const tick = p as { price: number };
          if (!Number.isFinite(tick.price)) return;
          send("scalp.price", { symbol: sym, price: tick.price, t: Date.now() });
        }),
      );

      await pushFull("init");

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
      }, 15_000);
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

import { eventBus } from "@/lib/events";
import { ssiFcConfigured } from "@/lib/providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "@/lib/realtime/ssi-ws";
import { getVnOrderBook } from "@/lib/services/stock-orderbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE — live order book + trades (push, không poll).
 * GET /api/v1/stocks/{symbol}/orderbook/stream
 *
 * Events: snapshot | orderbook | trade | tick | heartbeat | error
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length > 12) {
    return new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "symbol không hợp lệ" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ssiFcConfigured() || process.env.SSI_WS_DISABLED === "true") {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "SSI WS chưa bật — cần credentials + SSI_WS_DISABLED=false",
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  ensureSsiWsStarted();
  const unwatch = ssiWs.watchSymbol(symbol);

  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const offs: (() => void)[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };

      try {
        const snap = await getVnOrderBook(symbol);
        if (snap) send("snapshot", { book: snap.book, meta: snap.meta, pushedAt: Date.now() });
        else send("snapshot", { book: null, note: "chờ tick X đầu tiên", pushedAt: Date.now() });
      } catch {
        send("snapshot", { book: null, note: "snapshot lỗi — tiếp tục stream", pushedAt: Date.now() });
      }

      offs.push(
        eventBus.on(`ssi:orderbook:${symbol}`, (ob) => {
          send("orderbook", { orderBook: ob, pushedAt: Date.now() });
        }),
        eventBus.on(`ssi:trade:${symbol}`, (tr) => {
          send("trade", { trade: tr, pushedAt: Date.now() });
        }),
        eventBus.on(`ssi:tick:${symbol}`, (q) => {
          send("tick", { quote: q, pushedAt: Date.now() });
        }),
      );

      heartbeat = setInterval(() => {
        send("heartbeat", {
          t: Date.now(),
          ws: ssiWs.getStats().state,
          lastMessageAt: ssiWs.getStats().lastMessageAt,
        });
      }, 8_000);
      heartbeat.unref?.();
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      for (const off of offs) off();
      unwatch();
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

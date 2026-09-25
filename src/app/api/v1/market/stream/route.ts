/**
 * Multi-symbol realtime quote stream (SSE).
 * VNDirect/SSI WS (stock) + Binance WS (crypto) + REST poll fallback.
 * GET /api/v1/market/stream?symbols=VCB,FPT,BTCUSDT&asset=stock|crypto|auto
 */
import { eventBus } from "@/lib/events";
import { ensureVndirectWsStarted, vndirectWs } from "@/lib/realtime/vndirect-ws";
import { ensureSsiWsStarted, ssiWs } from "@/lib/realtime/ssi-ws";
import { ensureBinanceWsStarted, binanceWs } from "@/lib/realtime/binance-ws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type StreamQuote = {
  symbol: string;
  price: number;
  changePercent: number | null;
  ceiling: number | null;
  floor: number | null;
  volume: number | null;
  ts: number;
  source: string;
};

function parseSymbols(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean),
    ),
  ].slice(0, 40);
}

function isCryptoSym(sym: string): boolean {
  return sym.endsWith("USDT") || sym.endsWith("BUSD");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = parseSymbols(url.searchParams.get("symbols") ?? "");
  const assetParam = (url.searchParams.get("asset") ?? "auto").toLowerCase();

  if (!symbols.length) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "symbols required" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stockSyms =
    assetParam === "crypto" ? [] : symbols.filter((s) => assetParam === "stock" || !isCryptoSym(s));
  const cryptoSyms =
    assetParam === "stock" ? [] : symbols.filter((s) => assetParam === "crypto" || isCryptoSym(s));

  if (stockSyms.length) {
    ensureVndirectWsStarted();
    ensureSsiWsStarted();
  }
  if (cryptoSyms.length) ensureBinanceWsStarted();

  const encoder = new TextEncoder();
  const unsubs: (() => void)[] = [];
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const lastSent = new Map<string, number>();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send("hello", {
        symbols,
        stock: stockSyms.length,
        crypto: cryptoSyms.length,
        at: Date.now(),
      });

      const emitQuote = (q: StreamQuote) => {
        const prev = lastSent.get(q.symbol);
        if (prev != null && prev === q.price) return;
        lastSent.set(q.symbol, q.price);
        send("quote", q);
      };

      for (const sym of stockSyms) {
        unsubs.push(vndirectWs.watchSymbol(sym));
        try {
          ssiWs.watchSymbol(sym);
        } catch {
          /* */
        }

        const onTick = (payload: unknown) => {
          const p = payload as {
            price?: number;
            changePercent?: number | null;
            ceiling?: number | null;
            floor?: number | null;
            volume?: number | null;
            ts?: number;
            eventTime?: number;
            source?: string;
          };
          if (!p?.price || !Number.isFinite(p.price)) return;
          emitQuote({
            symbol: sym,
            price: p.price,
            changePercent: p.changePercent ?? null,
            ceiling: p.ceiling ?? null,
            floor: p.floor ?? null,
            volume: p.volume ?? null,
            ts: p.ts ?? p.eventTime ?? Date.now(),
            source: p.source ?? "vndirect",
          });
        };

        unsubs.push(eventBus.on(`market-tick:${sym}`, onTick));
        unsubs.push(eventBus.on(`tick:${sym}`, onTick));

        const vq = vndirectWs.getQuote(sym, 60_000);
        if (vq?.price) {
          emitQuote({
            symbol: sym,
            price: vq.price,
            changePercent: vq.changePercent ?? null,
            ceiling: vq.ceiling ?? null,
            floor: vq.floor ?? null,
            volume: vq.volume ?? null,
            ts: vq.eventTime ?? Date.now(),
            source: "vndirect-cache",
          });
        } else {
          const sq = ssiWs.getQuote(sym, 60_000);
          if (sq?.price) {
            emitQuote({
              symbol: sym,
              price: sq.price,
              changePercent: sq.changePercent ?? null,
              ceiling: sq.ceiling ?? null,
              floor: sq.floor ?? null,
              volume: sq.volume ?? null,
              ts: sq.eventTime ?? Date.now(),
              source: "ssi-cache",
            });
          }
        }
      }

      for (const sym of cryptoSyms) {
        const onCrypto = (payload: unknown) => {
          const p = payload as {
            price?: number;
            changePercent?: number;
            volume?: number;
            eventTime?: number;
          };
          if (!p?.price) return;
          emitQuote({
            symbol: sym,
            price: p.price,
            changePercent: p.changePercent ?? null,
            ceiling: null,
            floor: null,
            volume: p.volume ?? null,
            ts: p.eventTime ?? Date.now(),
            source: "binance",
          });
        };
        unsubs.push(eventBus.on(`tick:${sym}`, onCrypto));
        const t = binanceWs.getTicker(sym, 30_000);
        if (t) {
          emitQuote({
            symbol: sym,
            price: t.price,
            changePercent: t.changePercent,
            ceiling: null,
            floor: null,
            volume: t.volume,
            ts: t.eventTime,
            source: "binance-cache",
          });
        }
      }

      const poll = async () => {
        if (closed || !stockSyms.length) return;
        try {
          const { getVnQuotes } = await import("@/lib/services/stocks");
          const result = await getVnQuotes(stockSyms);
          for (const q of result?.quotes ?? []) {
            if (!q?.symbol || !Number.isFinite(q.price)) continue;
            emitQuote({
              symbol: String(q.symbol).toUpperCase(),
              price: Number(q.price),
              changePercent: q.changePercent ?? null,
              ceiling: (q as { ceilingPrice?: number | null }).ceilingPrice ?? null,
              floor: (q as { floorPrice?: number | null }).floorPrice ?? null,
              volume: q.volume ?? null,
              ts: Date.now(),
              source: result?.meta?.source ?? "rest",
            });
          }
        } catch {
          /* */
        }
      };

      void poll();
      pollTimer = setInterval(() => void poll(), 2_500);
      heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pollTimer) clearInterval(pollTimer);
        for (const u of unsubs) {
          try {
            u();
          } catch {
            /* */
          }
        }
        try {
          controller.close();
        } catch {
          /* */
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (pollTimer) clearInterval(pollTimer);
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* */
        }
      }
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

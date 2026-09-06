import { getSessionUser } from "@/lib/auth";
import { marketStore } from "@/lib/realtime/market-store";
import { multiTfCandles } from "@/lib/realtime/multi-tf-candles";
import { vnMarketEngine } from "@/lib/realtime/vn-market-engine";
import { ensureBinanceWsStarted } from "@/lib/realtime/binance-ws";
import { onAnyEvent, payloadOf, type RealtimeEvent } from "@/lib/realtime/event-envelope";
import { listAlerts, persistTriggers, type EvaluationResult } from "@/lib/services/alerts";
import { defaultWatchlistItems } from "@/lib/services/watchlist";
import { getChartHistory } from "@/lib/services/chart";
import { getVnOhlcv } from "@/lib/services/stocks";
import { evaluateAlert } from "@/lib/engines/alerts";
import { tfsFor, type ChartAssetType } from "@/lib/chart-const";
import type { OhlcvBar } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * REALTIME SSE GATEWAY (Phase 1)
 *
 * GET /api/v1/realtime/stream?topic=market&symbols=BTCUSDT,VNM&assetType=crypto|stock|all
 * GET /api/v1/realtime/stream?topic=watchlist            (auth required)
 * GET /api/v1/realtime/stream?topic=alerts               (auth required)
 * GET /api/v1/realtime/stream?topic=candle&symbol=BTCUSDT&assetType=crypto&timeframes=5m,15m
 *
 * Events: snapshot, quote, candle, candle.closed, index, alert, heartbeat.
 * One reader stream per connection; producers are centralized + refcounted.
 * Redis fanout: typed envelopes are published via the event model bridge, so
 * any instance of the app receives the same stream (multi-worker safe).
 */

const TOPICS = new Set(["market", "watchlist", "alerts", "candle"]);

interface Params {
  topic: string;
  symbols: string[];
  assetType: string;
  timeframes: string[];
  symbol: string;
}

function parseParams(url: URL): { ok: true; p: Params } | { ok: false; msg: string } {
  const topic = url.searchParams.get("topic") ?? "market";
  if (!TOPICS.has(topic)) return { ok: false, msg: "topic phải là market|watchlist|alerts|candle" };
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9._\-]/g, ""))
    .filter((s) => /^[A-Z0-9._-]{2,20}$/.test(s))
    .slice(0, 200);
  const assetType = url.searchParams.get("assetType") ?? "all";
  if (!["all", "crypto", "stock", "forex", "commodity", "index", "metal"].includes(assetType)) return { ok: false, msg: "assetType không hợp lệ" };
  const timeframes = (url.searchParams.get("timeframes") ?? "5m,15m,1h,1d")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => tfsFor(assetType === "all" ? "crypto" : (assetType as ChartAssetType)).includes(t) || ["1m"].includes(t))
    .slice(0, 10);
  return { ok: true, p: { topic, symbols, assetType, timeframes, symbol: (url.searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") } };
}

interface Wire {
  offs: (() => void)[];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseParams(url);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: parsed.msg } }), { status: 400 });
  }
  const { topic, symbols, assetType, timeframes, symbol } = parsed.p;

  ensureBinanceWsStarted();

  // Auth-gated topics
  let session = null;
  if (topic === "watchlist" || topic === "alerts") {
    session = await getSessionUser();
    if (!session) {
      return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED", message: "Chưa đăng nhập" } }), { status: 401 });
    }
  }

  const encoder = new TextEncoder();
  const wire: Wire = { offs: [] };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 20_000);
      heartbeat.unref?.();

      if (topic === "market") await startMarket(send, wire, symbols, assetType);
      else if (topic === "watchlist") await startWatchlist(send, wire, session!.id);
      else if (topic === "alerts") await startAlerts(send, wire, session!.id);
      else if (topic === "candle") await startCandle(send, wire, symbol, assetType, timeframes);
    },
    cancel() {
      for (const f of wire.offs) f();
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

/* ------------------------------- market ----------------------------------- */

function attachQuoteFanout(send: (e: string, d: unknown) => void, wire: Wire, symbols: string[] | null): void {
  const unsub = marketStore.subscribe(symbols ?? [], (q) => send("quote", q));
  wire.offs.push(unsub);
  // index events (VN) — global
  wire.offs.push(
    onAnyEvent((e) => {
      if (e.type !== "vn.index") return;
      send("index", payloadOf(e));
    }),
  );
}

async function startMarket(send: (e: string, d: unknown) => void, wire: Wire, symbols: string[], assetType: string): Promise<void> {
  // Ensure underlying engines are awake for requested classes
  const wantsStock = assetType === "all" || assetType === "stock";
  let watchSymbols = symbols;
  if (!symbols.length) {
    watchSymbols = marketStore.snapshot().map((q) => q.symbol);
    if (wantsStock) watchSymbols = [...new Set(watchSymbols)];
  }
  if ((wantsStock || (symbols.length && assetType === "stock")) && vnMarketEngine.enabled()) {
    const stockSyms = [...new Set(watchSymbols.filter((s) => !/^[A-Z]+USDT$/.test(s)))];
    if (stockSyms.length) vnMarketEngine.start(stockSyms);
  }
  attachQuoteFanout(send, wire, symbols.length ? symbols : null);
  const quotes = symbols.length ? marketStore.getMany(symbols) : marketStore.snapshot(assetType === "all" ? undefined : (assetType as "crypto" | "stock" | "forex" | "commodity" | "index" | "metal"));
  send("snapshot", {
    topic: "market",
    symbols: symbols.length ? symbols : undefined,
    assetType,
    quotes,
    session: assetType === "stock" || assetType === "all" ? vnMarketEngine.session() : undefined,
    ts: Date.now(),
  });
}

/* ------------------------------ watchlist --------------------------------- */

async function startWatchlist(send: (e: string, d: unknown) => void, wire: Wire, userId: string): Promise<void> {
  const items = await defaultWatchlistItems(userId);
  const stockSyms = items.filter((i) => i.assetType === "stock").map((i) => i.symbol);
  if (stockSyms.length) vnMarketEngine.start(stockSyms);
  attachQuoteFanout(send, wire, items.map((i) => i.symbol));
  send("snapshot", {
    topic: "watchlist",
    items: items.map((i) => ({ assetType: i.assetType, symbol: i.symbol })),
    quotes: marketStore.getMany(items.map((i) => i.symbol)),
    ts: Date.now(),
  });
}

/* -------------------------------- alerts ---------------------------------- */

async function startAlerts(send: (e: string, d: unknown) => void, wire: Wire, userId: string): Promise<void> {
  const alerts = await listAlerts(userId);
  const symbols = [...new Set(alerts.map((a) => a.symbol))];
  const stockSyms = alerts.filter((a) => a.assetType === "stock").map((a) => a.symbol);
  if (stockSyms.length) vnMarketEngine.start(stockSyms);
  const firedLocal = new Set<string>();
  const sub = marketStore.subscribe(symbols, (q) => {
    for (const alert of alerts) {
      if (alert.assetType !== q.assetType || alert.symbol !== q.symbol || alert.threshold == null) continue;
      const ev = evaluateAlert(alert.condition, alert.threshold, { price: q.price, changePercent: q.changePercent ?? null });
      if (!ev.triggered) continue;
      const key = alert.id;
      if (firedLocal.has(key)) continue;
      firedLocal.add(key);
      const result: EvaluationResult = { alert, ...ev };
      send("alert", result);
      void persistTriggers(userId, [result]).catch(() => {});
    }
  });
  wire.offs.push(sub);
  send("snapshot", { topic: "alerts", alerts, note: "Điều kiện RSI / volume_spike được đánh giá qua scheduler 5 phút", ts: Date.now() });
}

/* -------------------------------- candle ---------------------------------- */

async function startCandle(send: (e: string, d: unknown) => void, wire: Wire, symbol: string, assetType: string, timeframes: string[]): Promise<void> {
  if (!symbol) {
    send("snapshot", { topic: "candle", error: "symbol bắt buộc", ts: Date.now() });
    return;
  }
  const tfs = timeframes.length ? timeframes : ["5m", "15m", "1h", "1d"];
  const off = multiTfCandles.subscribe(symbol, assetType === "all" ? "crypto" : assetType, tfs, {
    klineBase: assetType === "crypto" || assetType === "all",
    seed: undefined,
  });
  wire.offs.push(off);

  // REST seed per requested tf (crypto: Binance klines; VN: daily OHLCV)
  const seedPromises: Promise<void>[] = [];
  if (assetType === "crypto") {
    for (const tf of tfs) {
      seedPromises.push(
        getChartHistory({ symbol, assetType: "crypto", timeframe: tf, limit: 300 }).then(async (r) => {
          if (r?.data?.candles?.length) multiTfCandles.seedTf(symbol, tf, r.data.candles as OhlcvBar[], "crypto");
        }),
      );
    }
  } else if (assetType === "stock") {
    vnMarketEngine.start([symbol]);
    seedPromises.push(
      getVnOhlcv(symbol, 250).then((r) => {
        if (r?.bars?.length) multiTfCandles.seedTf(symbol, "1d", r.bars, "stock");
      }),
    );
  }
  await Promise.allSettled(seedPromises);

  for (const tf of tfs) {
    wire.offs.push(
      onAnyRawCandle(send, symbol, tf),
    );
  }
  const candles: Record<string, unknown[]> = {};
  for (const tf of tfs) candles[tf] = multiTfCandles.history(symbol, tf);
  send("snapshot", {
    topic: "candle",
    symbol,
    assetType,
    timeframes: tfs,
    candles,
    current: Object.fromEntries(tfs.map((tf) => [tf, multiTfCandles.current(symbol, tf)])),
    note: assetType === "stock" ? "Nến 1d được seed từ lịch sử REST; TF nội ngày chỉ từ ticks live" : undefined,
    ts: Date.now(),
  });
}

function onAnyRawCandle(send: (e: string, d: unknown) => void, symbol: string, tf: string): () => void {
  return onAnyEvent((e: RealtimeEvent) => {
    if (!["candle.updated", "candle.closed"].includes(e.type)) return;
    if (e.symbol !== symbol.toUpperCase()) return;
    const payload = payloadOf<{ timeframe: string }>(e);
    if (payload?.timeframe !== tf) return;
    send(e.type === "candle.closed" ? "candle.closed" : "candle", { ...payload, closed: e.type === "candle.closed", ts: e.ts });
  });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnOrderBook, VnTrade } from "@/lib/services/stock-orderbook";
import type { FreshnessStatus } from "@/lib/types";
import { FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
  if (p >= 10) return p.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  return p.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 1 : 2)}K`;
  return v.toLocaleString("vi-VN");
}

function fmtTime(t: string | null, eventTime: number): string {
  if (t && /^\d{1,2}:\d{2}/.test(t)) return t.length >= 8 ? t.slice(0, 8) : t;
  try {
    return new Date(eventTime).toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

/** Terminal-style market depth + match tape — SSE primary, REST 1s fallback. */
export function OrderBookPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const { res, data: restData, meta: restMeta, isLoading } = useApi<VnOrderBook>(
    symbol ? `/api/v1/stocks/${symbol}/orderbook` : null,
    // SSE is primary. REST is only a resilient snapshot fallback; avoid
    // invoking a serverless function once per second while SSI is connecting.
    { refreshInterval: 10_000, timeoutMs: 7_000 },
  );

  const [live, setLive] = useState<VnOrderBook | null>(null);
  const [sseState, setSseState] = useState<"connecting" | "open" | "error" | "off">("off");

  const mergeBook = useCallback(
    (partial: Partial<VnOrderBook> & { symbol?: string }) => {
      setLive((prev) => {
        const base = prev ?? restData ?? null;
        if (!base && !partial.bids && !partial.asks) return prev;
        const next: VnOrderBook = {
          symbol: partial.symbol ?? base?.symbol ?? symbol,
          bids: partial.bids ?? base?.bids ?? [],
          asks: partial.asks ?? base?.asks ?? [],
          bidTotal: partial.bidTotal ?? base?.bidTotal ?? 0,
          askTotal: partial.askTotal ?? base?.askTotal ?? 0,
          imbalance: partial.imbalance ?? base?.imbalance ?? null,
          lastPrice: partial.lastPrice ?? base?.lastPrice ?? null,
          ceiling: partial.ceiling ?? base?.ceiling ?? null,
          floor: partial.floor ?? base?.floor ?? null,
          ref: partial.ref ?? base?.ref ?? null,
          session: partial.session ?? base?.session ?? null,
          eventTime: partial.eventTime ?? Date.now(),
          levels: partial.levels ?? base?.levels ?? 0,
          trades: partial.trades ?? base?.trades ?? [],
          tradeBuyVol: partial.tradeBuyVol ?? base?.tradeBuyVol ?? 0,
          tradeSellVol: partial.tradeSellVol ?? base?.tradeSellVol ?? 0,
          tradeTotalVol: partial.tradeTotalVol ?? base?.tradeTotalVol ?? 0,
          fromLastSession: partial.fromLastSession ?? base?.fromLastSession ?? false,
        };
        if (next.bids.length || next.asks.length) {
          next.levels = Math.max(next.bids.length, next.asks.length);
          const tot = next.bidTotal + next.askTotal;
          next.imbalance = tot > 0 ? (next.bidTotal - next.askTotal) / tot : null;
        }
        return next;
      });
    },
    [restData, symbol],
  );

  // Sync REST payload into live state
  useEffect(() => {
    if (restData) {
      setLive((prev) => {
        if (!prev) return restData;
        // Prefer fresher eventTime
        if ((restData.eventTime ?? 0) >= (prev.eventTime ?? 0)) return restData;
        return prev;
      });
    }
  }, [restData]);

  // Optional SSE stream for lower latency when available
  useEffect(() => {
    if (!symbol) return;
    let es: EventSource | null = null;
    let closed = false;
    const url = `/api/v1/stocks/${symbol}/orderbook/stream`;
    try {
      setSseState("connecting");
      es = new EventSource(url);
      es.onopen = () => {
        if (!closed) setSseState("open");
      };
      es.onerror = () => {
        if (!closed) setSseState("error");
      };
      const applyBookEvent = (ev: Event) => {
        try {
          const raw = JSON.parse((ev as MessageEvent).data) as
            | Partial<VnOrderBook>
            | { book?: Partial<VnOrderBook> | null; orderBook?: Partial<VnOrderBook> | null };
          const payload = ("orderBook" in raw ? raw.orderBook : "book" in raw ? raw.book : raw) as
            | Partial<VnOrderBook>
            | null
            | undefined;
          if (payload) mergeBook(payload);
        } catch {
          /* ignore */
        }
      };
      es.addEventListener("snapshot", applyBookEvent);
      es.addEventListener("orderbook", applyBookEvent);
      es.onmessage = applyBookEvent;
      es.addEventListener("book", (ev) => {
        applyBookEvent(ev);
      });
      es.addEventListener("trade", (ev) => {
        try {
          const tr = JSON.parse((ev as MessageEvent).data) as VnTrade;
          setLive((prev) => {
            if (!prev) return prev;
            const trades = [tr, ...(prev.trades ?? [])].slice(0, 50);
            const tradeBuyVol = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.volume, 0);
            const tradeSellVol = trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.volume, 0);
            return {
              ...prev,
              trades,
              tradeBuyVol,
              tradeSellVol,
              tradeTotalVol: trades.reduce((s, t) => s + t.volume, 0),
              lastPrice: tr.price,
              eventTime: tr.eventTime,
              fromLastSession: false,
            };
          });
        } catch {
          /* ignore */
        }
      });
    } catch {
      setSseState("off");
    }
    return () => {
      closed = true;
      es?.close();
      setSseState("off");
    };
  }, [symbol, mergeBook]);

  const data = live ?? restData;
  const ageMs = data?.eventTime != null ? Date.now() - data.eventTime : restMeta?.ageMs;
  const freshness: FreshnessStatus =
    sseState === "open" && data && !data.fromLastSession
      ? "LIVE"
      : (restMeta?.freshness ?? (data ? "FRESH" : "UNAVAILABLE"));

  if (!symbol || (isLoading && !res && !live)) {
    return (
      <Panel title="Độ sâu thị trường">
        <Loading rows={8} />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Độ sâu thị trường" right={<FreshnessDot status="UNAVAILABLE" ageMs={ageMs} />}>
        <Unavailable
          title={`Chưa có sổ lệnh ${symbol}`}
          note={
            res && !res.success
              ? res.error.message
              : "Cần SSI WebSocket (SSI_WS_DISABLED=false). Ngoài phiên sẽ hiện snapshot phiên gần nhất nếu đã có."
          }
        />
      </Panel>
    );
  }

  const levels = Math.max(data.bids.length, data.asks.length, 1);
  const maxLevelVol = Math.max(
    ...data.bids.map((l) => l.volume),
    ...data.asks.map((l) => l.volume),
    1,
  );
  const depthMax = Math.max(data.bidTotal, data.askTotal, 1);
  const buyShare =
    data.bidTotal + data.askTotal > 0 ? (data.bidTotal / (data.bidTotal + data.askTotal)) * 100 : 50;

  const histPrices = [
    ...data.bids.map((b) => ({ price: b.price, vol: b.volume, side: "bid" as const })),
    ...data.asks.map((a) => ({ price: a.price, vol: a.volume, side: "ask" as const })),
  ].sort((a, b) => a.price - b.price);
  const histMax = Math.max(...histPrices.map((h) => h.vol), 1);

  const trades = data.trades ?? [];
  const showLevels = compact ? Math.min(levels, 5) : Math.min(levels, 10);

  return (
    <div className={`grid gap-3 ${compact ? "" : "xl:grid-cols-2"}`}>
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            Độ sâu thị trường
            <span className="text-[10px] font-normal text-ink-3">
              {data.levels || showLevels} mức
              {sseState === "open" ? " · SSE" : ""}
            </span>
            {data.fromLastSession ? (
              <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                Phiên gần nhất
              </span>
            ) : null}
          </span>
        }
        right={<FreshnessDot status={freshness} ageMs={ageMs} />}
        pad={false}
      >
        <div className="grid grid-cols-4 gap-1 border-b border-line bg-panel-2 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3 sm:px-3">
          <span className="text-right">KL</span>
          <span className="text-right text-up">Giá mua</span>
          <span className="text-left text-down">Giá bán</span>
          <span className="text-left">KL</span>
        </div>

        <div className="divide-y divide-line/40">
          {Array.from({ length: showLevels }).map((_, i) => {
            const bid = data.bids[i];
            const ask = data.asks[i];
            const bidW = bid ? Math.min(100, (bid.volume / maxLevelVol) * 100) : 0;
            const askW = ask ? Math.min(100, (ask.volume / maxLevelVol) * 100) : 0;
            return (
              <div key={i} className="relative grid grid-cols-4 gap-1 px-2 py-1 text-[11px] sm:px-3">
                {bid && (
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 bg-up/10"
                    style={{ width: `${bidW / 2}%` }}
                  />
                )}
                {ask && (
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 bg-down/10"
                    style={{ width: `${askW / 2}%` }}
                  />
                )}
                <span className="num relative z-10 text-right text-ink-2">
                  {bid ? fmtVol(bid.volume) : "—"}
                </span>
                <span className="num relative z-10 text-right font-semibold text-up">
                  {bid ? fmtPrice(bid.price) : "—"}
                </span>
                <span className="num relative z-10 text-left font-semibold text-down">
                  {ask ? fmtPrice(ask.price) : "—"}
                </span>
                <span className="num relative z-10 text-left text-ink-2">
                  {ask ? fmtVol(ask.volume) : "—"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="border-t border-line px-2 py-2 sm:px-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="text-up">
              Dư mua: <span className="num font-medium">{fmtVol(data.bidTotal)}</span>
            </span>
            <span className="text-down">
              Dư bán: <span className="num font-medium">{fmtVol(data.askTotal)}</span>
            </span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-3">
            <div className="bg-up transition-all" style={{ width: `${buyShare}%` }} />
            <div className="bg-down transition-all" style={{ width: `${100 - buyShare}%` }} />
          </div>
        </div>

        {histPrices.length > 0 && (
          <div className="border-t border-line px-2 py-2 sm:px-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">
              Biểu đồ độ sâu thị trường
            </div>
            <div className="flex h-24 items-end gap-0.5">
              {histPrices.map((h, i) => {
                const hPct = Math.max(8, (h.vol / histMax) * 100);
                return (
                  <div
                    key={`${h.side}-${h.price}-${i}`}
                    className="group relative flex min-w-0 flex-1 flex-col items-center justify-end"
                    title={`${fmtPrice(h.price)} · ${fmtVol(h.vol)}`}
                  >
                    <div
                      className={`w-full rounded-t-sm ${h.side === "bid" ? "bg-up/80" : "bg-down/80"}`}
                      style={{ height: `${hPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-ink-3">
              {histPrices[0] && <span className="num">{fmtPrice(histPrices[0].price)}</span>}
              {data.lastPrice != null && (
                <span className="num text-ink-2">Khớp {fmtPrice(data.lastPrice)}</span>
              )}
              {histPrices[histPrices.length - 1] && (
                <span className="num">{fmtPrice(histPrices[histPrices.length - 1].price)}</span>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            Khớp lệnh
            <span className="text-[10px] font-normal text-ink-3">
              {data.fromLastSession
                ? "Ngoài phiên — không có tick khớp mới"
                : `KL: ${fmtVol(data.tradeTotalVol || depthMax)}${
                    data.tradeBuyVol > 0 ? ` · M: ${fmtVol(data.tradeBuyVol)}` : ""
                  }${data.tradeSellVol > 0 ? ` · B: ${fmtVol(data.tradeSellVol)}` : ""}`}
            </span>
          </span>
        }
        pad={false}
      >
        <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-x-2 border-b border-line bg-panel-2 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3 sm:px-3">
          <span>Thời gian</span>
          <span className="text-right">KL</span>
          <span className="text-right">Giá</span>
          <span className="text-right">+/−</span>
          <span className="text-center">M/B</span>
        </div>

        <div className={`overflow-y-auto ${compact ? "max-h-48" : "max-h-80"}`}>
          {trades.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-ink-3">
              {data.fromLastSession
                ? "Đang hiển thị độ sâu phiên gần nhất — khớp lệnh chỉ cập nhật trong phiên."
                : "Chưa có tick khớp lệnh — giữ trang mở trong phiên để nhận X-TRADE."}
            </p>
          ) : (
            trades.slice(0, compact ? 15 : 40).map((tr, i) => {
              const up = (tr.change ?? 0) > 0;
              const down = (tr.change ?? 0) < 0;
              const sideLabel = tr.side === "buy" ? "M" : tr.side === "sell" ? "B" : "—";
              const sideCls =
                tr.side === "buy" ? "text-up" : tr.side === "sell" ? "text-down" : "text-ink-3";
              const priceCls = up ? "text-up" : down ? "text-down" : "text-ink";
              return (
                <div
                  key={`${tr.eventTime}-${i}`}
                  className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-x-2 border-b border-line/30 px-2 py-1 text-[11px] sm:px-3"
                >
                  <span className="num text-ink-3">{fmtTime(tr.time, tr.eventTime)}</span>
                  <span className="num text-right text-ink-2">{fmtVol(tr.volume)}</span>
                  <span className={`num text-right font-medium ${priceCls}`}>{fmtPrice(tr.price)}</span>
                  <span className={`num text-right ${priceCls}`}>
                    {tr.change != null
                      ? `${tr.change > 0 ? "+" : ""}${tr.change.toFixed(2)}`
                      : "—"}
                    {tr.changePercent != null && (
                      <span className="ml-1 text-[10px] opacity-80">
                        {tr.changePercent > 0 ? "+" : ""}
                        {tr.changePercent.toFixed(1)}
                      </span>
                    )}
                  </span>
                  <span className={`text-center font-semibold ${sideCls}`}>{sideLabel}</span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

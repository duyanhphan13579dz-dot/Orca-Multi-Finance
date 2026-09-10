"use client";

import { useApi } from "@/lib/hooks";
import type { VnOrderBook } from "@/lib/services/stocks";
import { FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
  if (p >= 10) return p.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  return p.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("vi-VN");
}

export function OrderBookPanel({ symbol }: { symbol: string }) {
  const { res, data, meta, isLoading } = useApi<VnOrderBook>(
    symbol ? `/api/v1/stocks/${symbol}/orderbook` : null,
    { refreshInterval: 5_000 },
  );

  if (!symbol || (isLoading && !res)) {
    return (
      <Panel title="Sổ lệnh">
        <Loading rows={6} />
      </Panel>
    );
  }

  if (!res?.success || !data) {
    return (
      <Panel
        title="Sổ lệnh"
        right={<FreshnessDot status={meta?.freshness ?? "UNAVAILABLE"} ageMs={meta?.ageMs} />}
      >
        <Unavailable
          title={`Chưa có sổ lệnh ${symbol}`}
          note={
            res && !res.success
              ? res.error.message
              : "Cần SSI WebSocket (SSI_WS_DISABLED=false) và đang trong phiên giao dịch."
          }
        />
      </Panel>
    );
  }

  const maxVol = Math.max(
    ...data.bids.map((l) => l.volume),
    ...data.asks.map((l) => l.volume),
    1,
  );
  const levels = Math.max(data.bids.length, data.asks.length, 1);
  const imb = data.imbalance;

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          Sổ lệnh
          <span className="text-[10px] font-normal text-ink-3">{data.levels} mức · SSI</span>
        </span>
      }
      right={<FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />}
      pad={false}
    >
      <div className="border-b border-line px-3 py-2 text-[11px] text-ink-2 sm:px-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {data.lastPrice != null && (
            <span>
              Khớp: <strong className="num text-ink">{fmtPrice(data.lastPrice)}</strong>
            </span>
          )}
          {data.ref != null && (
            <span>
              TC: <span className="num">{fmtPrice(data.ref)}</span>
            </span>
          )}
          {data.ceiling != null && (
            <span className="text-accent">
              Trần: <span className="num">{fmtPrice(data.ceiling)}</span>
            </span>
          )}
          {data.floor != null && (
            <span className="text-[rgb(56,189,248)]">
              Sàn: <span className="num">{fmtPrice(data.floor)}</span>
            </span>
          )}
          {imb != null && (
            <span>
              Cân bằng:{" "}
              <strong className={imb > 0.05 ? "text-up" : imb < -0.05 ? "text-down" : "text-ink-2"}>
                {imb > 0 ? "+" : ""}
                {(imb * 100).toFixed(1)}%
              </strong>
              <span className="text-ink-3"> (mua − bán)</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-0 text-[11px]">
        <div className="border-r border-line">
          <div className="grid grid-cols-3 gap-1 border-b border-line bg-panel-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-3">
            <span className="text-right">KL mua</span>
            <span className="text-right">Giá mua</span>
            <span className="text-right text-ink-3/70">#</span>
          </div>
          {Array.from({ length: levels }).map((_, i) => {
            const lvl = data.bids[i];
            if (!lvl) {
              return (
                <div key={`b-empty-${i}`} className="grid grid-cols-3 gap-1 px-2 py-1 text-ink-3/40">
                  <span className="num text-right">—</span>
                  <span className="num text-right">—</span>
                  <span className="text-right">{i + 1}</span>
                </div>
              );
            }
            const w = Math.min(100, (lvl.volume / maxVol) * 100);
            return (
              <div key={`b-${i}`} className="relative grid grid-cols-3 gap-1 px-2 py-1">
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 bg-up/10"
                  style={{ width: `${w}%` }}
                />
                <span className="num relative z-10 text-right text-ink-2">{fmtVol(lvl.volume)}</span>
                <span className="num relative z-10 text-right font-medium text-up">{fmtPrice(lvl.price)}</span>
                <span className="relative z-10 text-right text-ink-3">{i + 1}</span>
              </div>
            );
          })}
          <div className="border-t border-line px-2 py-1.5 text-right text-[10px] text-ink-3">
            Tổng mua: <span className="num text-up">{fmtVol(data.bidTotal)}</span>
          </div>
        </div>

        <div>
          <div className="grid grid-cols-3 gap-1 border-b border-line bg-panel-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-3">
            <span className="text-left text-ink-3/70">#</span>
            <span className="text-left">Giá bán</span>
            <span className="text-left">KL bán</span>
          </div>
          {Array.from({ length: levels }).map((_, i) => {
            const lvl = data.asks[i];
            if (!lvl) {
              return (
                <div key={`a-empty-${i}`} className="grid grid-cols-3 gap-1 px-2 py-1 text-ink-3/40">
                  <span className="text-left">{i + 1}</span>
                  <span className="num text-left">—</span>
                  <span className="num text-left">—</span>
                </div>
              );
            }
            const w = Math.min(100, (lvl.volume / maxVol) * 100);
            return (
              <div key={`a-${i}`} className="relative grid grid-cols-3 gap-1 px-2 py-1">
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 bg-down/10"
                  style={{ width: `${w}%` }}
                />
                <span className="relative z-10 text-left text-ink-3">{i + 1}</span>
                <span className="num relative z-10 text-left font-medium text-down">{fmtPrice(lvl.price)}</span>
                <span className="num relative z-10 text-left text-ink-2">{fmtVol(lvl.volume)}</span>
              </div>
            );
          })}
          <div className="border-t border-line px-2 py-1.5 text-left text-[10px] text-ink-3">
            Tổng bán: <span className="num text-down">{fmtVol(data.askTotal)}</span>
          </div>
        </div>
      </div>

      {meta?.note && (
        <div className="border-t border-line px-3 py-1.5 text-[10px] text-ink-3 sm:px-3.5">{meta.note}</div>
      )}
    </Panel>
  );
}

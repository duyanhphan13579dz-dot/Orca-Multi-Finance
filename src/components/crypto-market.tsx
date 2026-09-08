"use client";

import Link from "next/link";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow, Meta } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { usePrefCurrency } from "@/lib/fx-pref";
import { Search, TrendingDown, TrendingUp, Waves } from "lucide-react";

type MarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

const CryptoRow = memo(function CryptoRow({ r, i, fmtUsd }: { r: CryptoMarketRow; i: number; fmtUsd: (v:number|null|undefined)=>string }) {
  return (
    <tr className="row-hover border-b border-line/40">
      <td className="num px-3.5 py-2 text-ink-3">{i + 1}</td>
      <td className="py-2">
        <Link href={`/crypto/${r.symbol}`} className="font-semibold text-ink hover:text-accent">
          {r.baseAsset}
          <span className="ml-1 text-[10px] font-normal text-ink-3">USDT</span>
        </Link>
      </td>
      <td className="num py-2 text-right">{fmtNum(r.price, priceDigits(r.price))}</td>
      <td className="py-2 text-right"><Chg value={r.changePercent} arrow={false} /></td>
      <td className="num py-2 text-right text-ink-3">
        {fmtNum(r.low, priceDigits(r.price))}–{fmtNum(r.high, priceDigits(r.price))}
      </td>
      <td className="num py-2 text-right text-ink-2">{fmtUsd(r.quoteVolume)}</td>
      <td className="py-2 pr-3.5 text-right">
        {(r.changePercent ?? 0) >= 5 ? (
          <Badge tone="up"><TrendingUp className="size-3" /> mạnh</Badge>
        ) : (r.changePercent ?? 0) <= -5 ? (
          <Badge tone="down"><TrendingDown className="size-3" /> yếu</Badge>
        ) : (
          <Badge>—</Badge>
        )}
      </td>
    </tr>
  );
});
export function CryptoMarketPage() {
  const { data, meta, isLoading } = useApi<MarketsData>("/api/v1/crypto/markets?limit=120", { refreshInterval: 20_000 });
  const { fmtUsd } = usePrefCurrency();
  const [tab, setTab] = useState<"volume" | "gainers" | "losers">("volume");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
    if (tab === "gainers") r = [...r].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    if (tab === "losers") r = [...r].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
    if (deferredQ) r = r.filter((x) => x.symbol.includes(deferredQ.toUpperCase()) || x.baseAsset.includes(deferredQ.toUpperCase()));
    return r.slice(0, 60);
  }, [data, tab, deferredQ]);

  if (isLoading && !data) return <Loading rows={12} />;
  if (!data) return <Unavailable title="Binance spot không khả dụng" note="Kết nối Binance đang bị gián đoạn hoặc circuit breaker đang mở. Xem chi tiết tại /system — hệ thống sẽ tự phục hồi." meta={meta} />;

  const s = data.summary;
  return (
    <div className="space-y-3">
      {/* summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="BTC 24h" value={<Chg value={s.btcChangePercent} arrow={false} />} sub="Binance spot" />
        <StatCard label="ETH 24h" value={<Chg value={s.ethChangePercent} arrow={false} />} sub="Binance spot" />
        <StatCard
          label="Độ rộng"
          value={
            <span className="num text-[15px]">
              <span className="text-up">{s.advancers}</span>
              <span className="text-ink-3"> / </span>
              <span className="text-down">{s.decliners}</span>
            </span>
          }
          sub={`${s.marketCount} mã USDT`}
        />
        <StatCard label="Biến động TB" value={<Chg value={s.avgChangePercent} arrow={false} />} sub="toàn thị trường" />
        <StatCard label="Tổng KL 24h" value={<span className="num text-[15px]">{fmtUsd(s.totalQuoteVolume)}</span>} sub="quy đổi USDT" />
      </div>

      <Panel
        pad={false}
        title={
          <span className="flex items-center gap-2">
            <Waves className="size-4 text-accent" /> Thị trường Binance Spot <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
          </span>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm mã…"
                className="w-28 rounded-xl border border-line bg-panel-2 py-2 pl-7 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent/40 sm:w-32 sm:rounded-md sm:py-1 sm:text-[12px]"
              />
            </div>
            <div className="flex rounded-full border border-line bg-panel-2 p-0.5 sm:rounded-md">
              {(
                [
                  ["volume", "Vol lớn"],
                  ["gainers", "Tăng"],
                  ["losers", "Giảm"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium sm:rounded sm:px-2 sm:py-0.5 ${tab === t ? "bg-accent text-white sm:bg-accent/15 sm:text-accent" : "text-ink-3 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                <th className="px-3.5 py-2 font-medium">#</th>
                <th className="py-2 font-medium">Mã</th>
                <th className="py-2 text-right font-medium">Giá</th>
                <th className="py-2 text-right font-medium">24h %</th>
                <th className="py-2 text-right font-medium">Biên 24h</th>
                <th className="py-2 text-right font-medium">Vol (quote)</th>
                <th className="py-2 pr-3.5 text-right font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <CryptoRow key={r.symbol} r={r} i={i} fmtUsd={fmtUsd} />
              ))}
            </tbody>
          </table>
        </div>
        {/* mobile cards */}
        <div className="grid gap-2 p-2 md:hidden">
          {rows.slice(0, 20).map((r, i) => (
            <Link key={r.symbol} href={`/crypto/${r.symbol}`} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2 p-3 active:scale-[0.99]">
              <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-panel text-[11px] font-semibold text-ink-3">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-[14px] font-semibold">{r.baseAsset}</span>
                  <span className="text-[10px] text-ink-3">USDT</span>
                  {(r.changePercent ?? 0) >= 5 ? <Badge tone="up">mạnh</Badge> : (r.changePercent ?? 0) <= -5 ? <Badge tone="down">yếu</Badge> : null}
                </div>
                <div className="num mt-0.5 text-[11px] text-ink-3">Vol {fmtUsd(r.quoteVolume)}</div>
              </div>
              <div className="text-right">
                <div className="num text-[14px] font-semibold">{fmtNum(r.price, priceDigits(r.price))}</div>
                <Chg value={r.changePercent} className="justify-end text-[12px]" arrow={false} />
              </div>
            </Link>
          ))}
        </div>
        <div className="border-t border-line px-3.5 py-2">
          <MetaLine meta={meta} />
        </div>
      </Panel>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="panel hover-lift p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1">{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-3">{sub}</div>
    </div>
  );
}

export type { Meta };

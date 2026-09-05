"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow, Meta } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { usePrefCurrency } from "@/lib/fx-pref";
import { Search, TrendingDown, TrendingUp, Waves } from "lucide-react";

type MarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

export function CryptoMarketPage() {
  const { data, meta, isLoading } = useApi<MarketsData>("/api/v1/crypto/markets?limit=120", { refreshInterval: 15_000 });
  const { fmtUsd } = usePrefCurrency();
  const [tab, setTab] = useState<"volume" | "gainers" | "losers">("volume");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
    if (tab === "gainers") r = [...r].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    if (tab === "losers") r = [...r].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
    if (q) r = r.filter((x) => x.symbol.includes(q.toUpperCase()) || x.baseAsset.includes(q.toUpperCase()));
    return r.slice(0, 60);
  }, [data, tab, q]);

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
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm mã…"
                className="w-32 rounded-md border border-line bg-panel-2 py-1 pl-7 pr-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent/40"
              />
            </div>
            <div className="flex rounded-md border border-line bg-panel-2 p-0.5">
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
                  className={`rounded px-2 py-0.5 text-[11px] ${tab === t ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
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
                <tr key={r.symbol} className="row-hover border-b border-line/40">
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
              ))}
            </tbody>
          </table>
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

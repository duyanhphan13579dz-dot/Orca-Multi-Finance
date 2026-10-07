"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow, Meta } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { usePrefCurrency } from "@/lib/fx-pref";
import { ArrowUpRight, Coins, Search, TrendingDown, TrendingUp, Waves, X } from "lucide-react";

type MarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

type FilterTab = "all" | "volume" | "gainers" | "losers";

export function CryptoMarketPage() {
  const { data, meta, isLoading } = useApi<MarketsData>("/api/v1/crypto/markets?limit=120", {
    refreshInterval: 15_000,
  });
  const { fmtUsd } = usePrefCurrency();
  const [tab, setTab] = useState<FilterTab>("volume");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
    if (tab === "gainers") r = [...r].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    else if (tab === "losers") r = [...r].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
    else if (tab === "volume") r = [...r].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));

    if (q.trim()) {
      const needle = q.trim().toUpperCase();
      r = r.filter((x) => x.symbol.includes(needle) || x.baseAsset.includes(needle));
    }
    return r.slice(0, 80);
  }, [data, tab, q]);

  if (isLoading && !data) return <Loading rows={12} />;
  if (!data)
    return (
      <Unavailable
        title="Binance spot không khả dụng"
        note="Kết nối Binance đang bị gián đoạn hoặc circuit breaker đang mở. Xem chi tiết tại /system — hệ thống sẽ tự phục hồi."
        meta={meta}
      />
    );

  const s = data.summary;
  const btcRow = data.rows.find((r) => r.symbol === "BTCUSDT");
  const ethRow = data.rows.find((r) => r.symbol === "ETHUSDT");

  const totalBreadth = Math.max(1, s.advancers + s.decliners);
  const advancerPct = Math.round((s.advancers / totalBreadth) * 100);

  return (
    <div className="space-y-3">
      {/* Market Breadth & Benchmark Stats Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 md:grid-cols-5">
        <BenchmarkCard
          label="Bitcoin · BTC"
          price={btcRow ? fmtNum(btcRow.price, 2) : "—"}
          change={s.btcChangePercent}
          sub="Binance Spot 24h"
          href="/crypto/BTCUSDT"
        />
        <BenchmarkCard
          label="Ethereum · ETH"
          price={ethRow ? fmtNum(ethRow.price, 2) : "—"}
          change={s.ethChangePercent}
          sub="Binance Spot 24h"
          href="/crypto/ETHUSDT"
        />

        {/* Market Breadth Visualizer */}
        <div className="panel p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-text-muted">
            <span>Độ rộng sàn</span>
            <span className="num font-semibold text-text-primary">{s.marketCount} mã</span>
          </div>
          <div className="num mt-1 flex items-baseline justify-between text-[14px] font-semibold">
            <span className="text-positive">{s.advancers} tăng</span>
            <span className="text-text-muted">/</span>
            <span className="text-negative">{s.decliners} giảm</span>
          </div>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-elevated">
            <div className="bg-positive transition-all duration-300" style={{ width: `${advancerPct}%` }} />
            <div className="bg-negative transition-all duration-300" style={{ width: `${100 - advancerPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[9.5px] text-text-muted">
            <span>{advancerPct}% Tăng</span>
            <span>{100 - advancerPct}% Giảm</span>
          </div>
        </div>

        <StatCard
          label="Biến động trung bình"
          value={<Chg value={s.avgChangePercent} arrow={false} className="text-[15px] font-semibold" />}
          sub="Toàn bộ USDT pairs"
        />

        <StatCard
          label="Tổng KL giao dịch 24h"
          value={<span className="num text-[15px] font-bold text-text-primary">{fmtUsd(s.totalQuoteVolume)}</span>}
          sub="Quy đổi Binance Spot"
        />
      </div>

      {/* Main Market Board */}
      <Panel
        pad={false}
        title={
          <span className="flex items-center gap-2">
            <Coins className="size-4 text-accent-primary" /> Bảng giá Binance Spot trực tiếp
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
          </span>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            {/* Search input */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm mã / token…"
                className="w-32 rounded-lg border border-border-subtle bg-surface-elevated py-1.5 pl-8 pr-6 text-[12px] text-text-primary outline-none transition-all placeholder:text-text-muted focus:w-44 focus:border-accent-primary/60 sm:w-40 sm:focus:w-56"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  aria-label="Xóa tìm kiếm"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="seg">
              {(
                [
                  ["volume", "Vol lớn"],
                  ["gainers", "Top Tăng"],
                  ["losers", "Top Giảm"],
                  ["all", "Tất cả"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  data-active={tab === t}
                  onClick={() => setTab(t)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {/* Mobile List View */}
        <div className="divide-y divide-border-subtle md:hidden">
          {rows.map((r, i) => {
            const digits = priceDigits(r.price);
            const rangeMin = r.low ?? r.price;
            const rangeMax = r.high ?? r.price;
            const span = Math.max(1e-8, rangeMax - rangeMin);
            const pos = Math.max(0, Math.min(100, ((r.price - rangeMin) / span) * 100));

            return (
              <Link
                key={r.symbol}
                href={`/crypto/${r.symbol}`}
                className="row-hover flex items-center justify-between px-3.5 py-3 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="num w-5 shrink-0 text-center text-[10px] text-text-muted">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-semibold text-text-primary">{r.baseAsset}</span>
                      <span className="text-[10px] text-text-muted">USDT</span>
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-text-muted">Vol ${fmtCompact(r.quoteVolume ?? 0)}</div>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="num text-[13.5px] font-semibold text-text-primary">{fmtNum(r.price, digits)}</div>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                    <Chg value={r.changePercent} arrow={false} className="text-[11px]" />
                  </div>
                  <div className="mt-1 w-20">
                    <div className="h-1 overflow-hidden rounded-full bg-surface-elevated">
                      <div
                        className="h-full bg-accent-primary"
                        style={{ width: `${pos}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Desktop Pro Table View */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="py-2.5 font-medium">Cặp giao dịch</th>
                <th className="py-2.5 text-right font-medium">Giá trực tiếp</th>
                <th className="py-2.5 text-right font-medium">Biến động 24h</th>
                <th className="py-2.5 text-center font-medium">Biên dao động 24h (Low — High)</th>
                <th className="py-2.5 text-right font-medium">Khối lượng 24h</th>
                <th className="py-2.5 text-center font-medium">Đánh giá</th>
                <th className="py-2.5 pr-4 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const digits = priceDigits(r.price);
                const rangeMin = r.low ?? r.price;
                const rangeMax = r.high ?? r.price;
                const span = Math.max(1e-8, rangeMax - rangeMin);
                const pos = Math.max(0, Math.min(100, ((r.price - rangeMin) / span) * 100));

                return (
                  <tr key={r.symbol} className="row-hover border-b border-border-subtle/40">
                    <td className="num px-4 py-2.5 text-text-muted">{i + 1}</td>
                    <td className="py-2.5">
                      <Link
                        href={`/crypto/${r.symbol}`}
                        className="group flex items-center gap-2 font-semibold text-text-primary hover:text-accent-primary"
                      >
                        <span className="flex size-6 items-center justify-center rounded-md border border-border-subtle bg-surface-elevated text-[10.5px] font-bold text-accent-primary">
                          {r.baseAsset.slice(0, 1)}
                        </span>
                        <span>
                          {r.baseAsset}
                          <span className="ml-1 text-[10px] font-normal text-text-muted">/USDT</span>
                        </span>
                      </Link>
                    </td>
                    <td className="num py-2.5 text-right font-medium text-text-primary">
                      {fmtNum(r.price, digits)}
                    </td>
                    <td className="py-2.5 text-right font-medium">
                      <Chg value={r.changePercent} arrow={false} />
                    </td>
                    <td className="py-2.5 text-center">
                      <div className="mx-auto flex max-w-[180px] items-center gap-2 text-[10.5px] text-text-muted">
                        <span className="num">{fmtNum(rangeMin, digits)}</span>
                        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-accent-primary"
                            style={{ width: `${pos}%` }}
                          />
                        </div>
                        <span className="num">{fmtNum(rangeMax, digits)}</span>
                      </div>
                    </td>
                    <td className="num py-2.5 text-right text-text-secondary">
                      ${fmtCompact(r.quoteVolume ?? 0)}
                    </td>
                    <td className="py-2.5 text-center">
                      {(r.changePercent ?? 0) >= 5 ? (
                        <Badge tone="up">
                          <TrendingUp className="mr-0.5 size-3" /> Tăng mạnh
                        </Badge>
                      ) : (r.changePercent ?? 0) <= -5 ? (
                        <Badge tone="down">
                          <TrendingDown className="mr-0.5 size-3" /> Giảm sâu
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Dao động hẹp</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <Link
                        href={`/crypto/${r.symbol}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/70 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent-primary/50 hover:bg-accent-primary/10 hover:text-accent-primary"
                      >
                        Terminal <ArrowUpRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border-subtle px-4 py-2.5">
          <MetaLine meta={meta} />
        </div>
      </Panel>
    </div>
  );
}

function BenchmarkCard({
  label,
  price,
  change,
  sub,
  href,
}: {
  label: string;
  price: string;
  change: number | null;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href} className="panel hover-lift block p-3 transition-colors hover:border-border-default">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-text-muted">
        <span>{label}</span>
        <ArrowUpRight className="size-3 opacity-60" />
      </div>
      <div className="num mt-1 flex items-baseline justify-between gap-1">
        <span className="text-[17px] font-bold text-text-primary">{price}</span>
        <Chg value={change} arrow={false} className="text-[12px] font-semibold" />
      </div>
      <div className="mt-1 text-[9.5px] text-text-muted">{sub}</div>
    </Link>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1">{value}</div>
      <div className="mt-1 text-[9.5px] text-text-muted">{sub}</div>
    </div>
  );
}

export type { Meta };

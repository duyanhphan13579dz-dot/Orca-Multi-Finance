"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, DEFAULT_VN_WATCHLIST, sectorOf } from "@/lib/vn/master";
import type { MarketSnapshot } from "@/lib/services/market";
import type { IndexQuote, Quote } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { CandlestickChart, KeyRound, Search } from "lucide-react";

type StocksData = {
  indices: IndexQuote[] | null;
  quotes: Quote[] | null;
  universe?: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  sessionDate?: string;
  count?: number;
};

export default function VnMarketCenterPage() {
  const { res, data, meta, isLoading } = useApi<StocksData>(`/api/v1/stocks?board=full`, { refreshInterval: 45_000 });
  const { data: snap } = useApi<MarketSnapshot>("/api/v1/market/snapshot", { refreshInterval: 30_000 });
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("");

  const session = snap?.vnSession;
  const quotes = useMemo(() => {
    let list = data?.quotes ?? [];
    if (q)
      list = list.filter(
        (x) =>
          x.symbol.includes(q.toUpperCase()) ||
          (x.name ?? "").toUpperCase().includes(q.toUpperCase()),
      );
    if (sector) list = list.filter((x) => sectorOf(x.symbol) === sector);
    return list;
  }, [data, q, sector]);

  if (isLoading && !res) return <Loading rows={12} />;

  return (
    <div className="stock-workspace">
      <Panel pad={false}>
        <div className="stock-hero flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
            <CandlestickChart className="size-5 shrink-0 text-accent-primary" />
            Trung tâm thị trường VN
          </h1>
          <Badge tone="accent">HOSE · HNX · UPCoM</Badge>
          <Link
            href="/stocks/sectors"
            className="rounded-md border border-accent-primary/30 bg-accent-primary/10 px-2 py-1 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/20"
          >
            Xu hướng ngành
          </Link>
          {data?.sessionDate && <Badge tone="neutral">Phiên {data.sessionDate}</Badge>}
          {data?.count != null && <Badge tone="neutral">{data.count} mã</Badge>}
          {session && <Badge tone={session.trading ? "up" : "warn">{session.labelVi}</Badge>}
          <span className="ml-auto flex items-center gap-2">
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            <span className="hidden sm:inline">
              <MetaLine meta={meta} />
            </span>
          </span>
        </div>
        {data?.indices?.length ? (
          <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:px-4 sm:pb-4 md:grid-cols-4 xl:gap-3">
            {data.indices.slice(0, 4).map((i, big) => (
              <div
                key={i.code}
                className={`rounded-lg border p-2.5 sm:p-3 ${
                  big === 0
                    ? "border-accent-primary/40 bg-accent-primary/5"
                    : "border-border-subtle bg-surface-elevated"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                  <span className={big === 0 ? "font-semibold text-accent-primary" : ""}>{i.code}</span>
                  <Chg value={i.changePercent} arrow={false} />
                </div>
                <div className="num mt-1 text-[17px] font-semibold sm:text-[19px]">{fmtNum(i.value, 2)}</div>
                {i.volume != null && (
                  <div className="num text-[10px] text-text-muted">KL {fmtCompact(i.volume)}</div>
                )}
              </div>
            ))}
          </div>
        ) : session ? (
          <p className="px-3 pb-3 text-[11px] text-text-muted sm:px-4">{snap?.vnSessionHint}</p>
        ) : null}
      </Panel>

      {!res?.success ? (
        <Unavailable
          title="Chưa kéo được dữ liệu thị trường VN"
          note={
            res && !res.success
              ? res.error.message
              : "Nguồn VNDirect/VNStock tạm không phản hồi — thử lại sau hoặc kiểm tra /system."
          }
        />
      ) : (
        <>
          <Panel
            title={
              <span className="flex items-center gap-2">
                Bảng giá toàn thị trường
                <span className="text-[10px] font-normal text-text-muted">{quotes.length} mã</span>
              </span>
            }
          >
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm mã / tên…"
                  inputMode="search"
                  autoComplete="off"
                  className="w-full rounded-lg border border-border-subtle bg-surface-elevated py-2.5 pl-8 pr-3 text-[13px] outline-none focus:border-accent-primary/50 sm:py-1.5 sm:text-[12px]"
                />
              </div>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="min-h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-2 py-2 text-[13px] sm:min-h-0 sm:w-auto sm:py-1.5 sm:text-[12px]"
              >
                <option value="">Tất cả ngành</option>
                {VN_SECTOR_MAP.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 md:hidden">
              {quotes.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-text-muted">Không có mã khớp bộ lọc.</p>
              ) : (
                quotes.map((qu) => (
                  <Link
                    key={qu.symbol}
                    href={`/stocks/${qu.symbol}`}
                    className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated/60 px-3 py-2.5 active:bg-surface-elevated"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-accent-primary">{qu.symbol}</span>
                        <AddToWatchlist assetType="stock" symbol={qu.symbol} />
                      </div>
                      {qu.name && <div className="truncate text-[11px] text-text-muted">{qu.name}</div>}
                      <div className="mt-0.5 flex gap-3 text-[10px] text-text-muted">
                        <span className="num">KL {fmtCompact(qu.volume)}</span>
                        <span className="num">GT {fmtCompact(qu.quoteVolume)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-[15px] font-semibold">{fmtNum(qu.price, 2)}</div>
                      <Chg value={qu.changePercent} arrow={false} className="text-[12px]" />
                    </div>
                  </Link>
                ))
              )}
            </div>

            <div className="table-scroll hidden max-h-[min(70vh,720px)] w-full md:block">
              <table className="stock-table w-full table-fixed text-left">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-background-secondary text-[10px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="pl-2 text-left sm:pl-3">Mã</th>
                    <th className="text-right">Giá</th>
                    <th className="text-right">%</th>
                    <th className="text-right">TC</th>
                    <th className="text-right">KL</th>
                    <th className="text-right">GT</th>
                    <th className="pr-2 text-right sm:pr-3">Theo dõi</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((qu) => (
                    <tr key={qu.symbol} className="border-t border-border-subtle/70 hover:bg-surface-elevated/50">
                      <td className="py-2 pl-2 sm:pl-3">
                        <Link href={`/stocks/${qu.symbol}`} className="font-semibold text-accent-primary hover:underline">
                          {qu.symbol}
                        </Link>
                        {qu.name && (
                          <div className="truncate text-[10px] text-text-muted" title={qu.name}>
                            {qu.name}
                          </div>
                        )}
                      </td>
                      <td className="num py-2 text-right font-medium">{fmtNum(qu.price, 2)}</td>
                      <td className="py-2 text-right">
                        <Chg value={qu.changePercent} arrow={false} />
                      </td>
                      <td className="num py-2 text-right text-text-muted">
                        {qu.referencePrice != null ? fmtNum(qu.referencePrice, 2) : "—"}
                      </td>
                      <td className="num py-2 text-right text-text-secondary">{fmtCompact(qu.volume)}</td>
                      <td className="num py-2 text-right text-text-secondary">
                        {fmtCompact(qu.quoteVolume)}
                      </td>
                      <td className="py-2 pr-2 text-right sm:pr-3">
                        <AddToWatchlist assetType="stock" symbol={qu.symbol} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Ngành chứng khoán Việt Nam" pad={false}>
            <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 md:grid-cols-4">
              {VN_SECTOR_MAP.slice(0, 16).map((s) => (
                <Link
                  key={s.name}
                  href="/stocks/sectors"
                  className="flex min-h-11 items-center justify-between rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2 active:bg-surface-elevated/80"
                >
                  <span className="truncate text-[12px] text-text-secondary">{s.name}</span>
                  <span className="num shrink-0 text-[10px] text-text-muted">{s.symbols.length} mã</span>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      )}

      <p className="flex items-start gap-2 text-[11px] text-text-muted sm:items-center">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning sm:mt-0" />
        <span>
          Danh mục theo dõi mặc định (ưu tiên VN): {DEFAULT_VN_WATCHLIST.slice(2, 8).join(", ")}… (tùy biến tại mục
          Danh mục theo dõi)
        </span>
      </p>
    </div>
  );
}

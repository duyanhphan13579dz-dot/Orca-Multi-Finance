"use client";

import Link from "next/link";
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, DEFAULT_VN_WATCHLIST, sectorOf } from "@/lib/vn/master";
import type { MarketSnapshot } from "@/lib/services/market";
import type { IndexQuote, Quote } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { CandlestickChart, KeyRound, Search } from "lucide-react";

const PAGE_SIZE = 80;

const Row = memo(function Row({ qu }: { qu: Quote }) {
  return (
    <tr className="border-t border-border-subtle/70 hover:bg-surface-elevated/50">
      <td className="py-2 pl-1">
        <Link href={`/stocks/${qu.symbol}`} className="font-semibold text-accent-primary hover:underline">
          {qu.symbol}
        </Link>
        {qu.name && <div className="max-w-[140px] truncate text-[10px] text-text-muted">{qu.name}</div>}
      </td>
      <td className="num py-2 text-right font-medium">{fmtNum(qu.price, 2)}</td>
      <td className="py-2 text-right">
        <Chg value={qu.changePercent} arrow={false} />
      </td>
      <td className="num py-2 text-right text-text-muted">
        {qu.referencePrice != null ? fmtNum(qu.referencePrice, 2) : "—"}
      </td>
      <td className="num py-2 text-right text-ink-2">{fmtCompact(qu.volume)}</td>
      <td className="num py-2 text-right text-ink-2">{fmtCompact(qu.quoteVolume)}</td>
      <td className="py-2 pr-3.5 text-right">
        <AddToWatchlist assetType="stock" symbol={qu.symbol} />
      </td>
    </tr>
  );
});

type StocksData = {
  indices: IndexQuote[] | null;
  quotes: Quote[] | null;
  universe?: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  sessionDate?: string;
  count?: number;
};

export default function VnMarketCenterPage() {
  const { res, data, meta, isLoading } = useApi<StocksData>(`/api/v1/stocks?board=full`, { refreshInterval: 45_000 });
  const { data: snap } = useApi<MarketSnapshot>("/api/v1/market/snapshot", { refreshInterval: 60_000 });
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("");
  const [page, setPage] = useState(1);
  const deferredQ = useDeferredValue(q);
  const deferredSector = useDeferredValue(sector);

  const session = snap?.vnSession;
  const quotes = useMemo(() => {
    let list = data?.quotes ?? [];
    if (deferredQ) list = list.filter((x) => x.symbol.includes(deferredQ.toUpperCase()) || (x.name ?? "").toUpperCase().includes(deferredQ.toUpperCase()));
    if (deferredSector) list = list.filter((x) => sectorOf(x.symbol) === deferredSector);
    return list;
  }, [data, deferredQ, deferredSector]);
  const totalPages = Math.max(1, Math.ceil(quotes.length / PAGE_SIZE));
  const visible = useMemo(() => quotes.slice(0, page * PAGE_SIZE), [quotes, page]);
  // Reset paging when filter changes - useEffect avoids setState during render
  useEffect(() => {
    setPage(1);
  }, [deferredQ, deferredSector]);

  if (isLoading && !res) return <Loading rows={12} />;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 pb-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <CandlestickChart className="size-5 text-accent-primary" /> VN Market Center
          </h1>
          <Badge tone="accent">HOSE · HNX · UPCoM</Badge>
          {data?.sessionDate && <Badge tone="neutral">Phiên {data.sessionDate}</Badge>}
          {data?.count != null && <Badge tone="neutral">{data.count} mã</Badge>}
          {session && <Badge tone={session.trading ? "up" : "warn"}>{session.labelVi}</Badge>}
          <span className="ml-auto flex items-center gap-2">
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            <MetaLine meta={meta} />
          </span>
        </div>
        {data?.indices?.length ? (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-4">
            {data.indices.slice(0, 4).map((i, big) => (
              <div
                key={i.code}
                className={`rounded-lg border p-3 ${
                  big === 0 ? "border-accent-primary/40 bg-accent-primary/5" : "border-border-subtle bg-surface-elevated"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                  <span className={big === 0 ? "font-semibold text-accent-primary" : ""}>{i.code}</span>
                  <Chg value={i.changePercent} arrow={false} />
                </div>
                <div className="num mt-1 text-[19px] font-semibold">{fmtNum(i.value, 2)}</div>
                {i.volume != null && <div className="num text-[10px] text-text-muted">KL {fmtCompact(i.volume)}</div>}
              </div>
            ))}
          </div>
        ) : session ? (
          <p className="px-4 pb-3 text-[11px] text-text-muted">{snap?.vnSessionHint}</p>
        ) : null}
      </Panel>

      {!res?.success ? (
        <Unavailable
          title="Chưa kéo được dữ liệu thị trường VN"
          note={res && !res.success ? res.error.message : "Nguồn VNDirect/VNStock tạm không phản hồi — thử lại sau hoặc kiểm tra /system."}
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
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm mã / tên…"
                  className="w-full rounded-xl border border-border-subtle bg-surface-elevated py-2.5 pl-8 pr-3 text-[14px] outline-none focus:border-accent-primary/50 sm:rounded-lg sm:py-1.5 sm:text-[12px]"
                />
              </div>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-surface-elevated px-3 py-2.5 text-[13px] sm:w-auto sm:rounded-lg sm:px-2 sm:py-1.5 sm:text-[12px]"
              >
                <option value="">Tất cả ngành</option>
                {VN_SECTOR_MAP.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {/* desktop table */}
            <div className="hidden max-h-[520px] overflow-auto md:block" style={{ contentVisibility: "auto", containIntrinsicSize: "520px" }}>
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 z-[1] bg-background-secondary text-[10px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="py-2 pl-1">Mã</th>
                    <th className="py-2 text-right">Giá</th>
                    <th className="py-2 text-right">%</th>
                    <th className="py-2 text-right">TC</th>
                    <th className="py-2 text-right">KL</th>
                    <th className="py-2 text-right">GT</th>
                    <th className="py-2 pr-3.5 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((qu) => (
                    <Row key={qu.symbol} qu={qu} />
                  ))}
                </tbody>
              </table>
            </div>
            {/* mobile cards */}
            <div className="grid gap-2 md:hidden">
              {visible.map((qu) => (
                <Link key={qu.symbol} href={`/stocks/${qu.symbol}`} className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-elevated p-3 active:scale-[0.99]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px] font-semibold text-accent-primary">{qu.symbol}</span>
                      {qu.name && <span className="truncate text-[11px] text-text-muted">{qu.name}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
                      <span>KL {fmtCompact(qu.volume)}</span>
                      <span>·</span>
                      <span>TC {qu.referencePrice != null ? fmtNum(qu.referencePrice, 2) : "—"}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[15px] font-semibold">{fmtNum(qu.price, 2)}</div>
                    <Chg value={qu.changePercent} className="justify-end text-[12px]" arrow={false} />
                  </div>
                </Link>
              ))}
              {visible.length === 0 && <div className="py-6 text-center text-[13px] text-text-muted">Không tìm thấy mã phù hợp</div>}
            </div>
            {visible.length < quotes.length && (
              <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
                <span className="text-[11px] text-text-muted">
                  Hiển thị {visible.length} / {quotes.length} mã
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  className="rounded-md border border-accent-primary/30 bg-accent-primary/10 px-3 py-1 text-[12px] font-medium text-accent-primary hover:bg-accent-primary/15"
                >
                  Tải thêm {Math.min(PAGE_SIZE, quotes.length - visible.length)} mã →
                </button>
              </div>
            )}
          </Panel>

          <Panel title="Ngành chứng khoán Việt Nam (Security Master)" pad={false}>
            <div className="grid grid-cols-2 gap-1.5 p-3 md:grid-cols-4">
              {VN_SECTOR_MAP.slice(0, 16).map((s) => (
                <Link
                  key={s.name}
                  href={`/screener?universe=stocks&sector=${encodeURIComponent(s.name)}`}
                  className="hover-lift flex items-center justify-between rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2"
                >
                  <span className="truncate text-[12px] text-text-secondary">{s.name}</span>
                  <span className="num text-[10px] text-text-muted">{s.symbols.length} mã</span>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      )}

      <p className="flex items-center gap-2 text-[11px] text-text-muted">
        <KeyRound className="size-3.5 text-warning" />
        Watchlist mặc định VN-first: {DEFAULT_VN_WATCHLIST.slice(2, 8).join(", ")}… (tùy biến tại mục Watchlist)
      </p>
    </div>
  );
}

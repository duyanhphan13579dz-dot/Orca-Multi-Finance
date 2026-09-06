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

type StocksData = { indices: IndexQuote[] | null; quotes: Quote[] | null };
const BOARD = "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,FPT,HPG,VNM,VIC,VHM,VRE,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,PVP,DCM,DPN".slice(0, 200);

export default function VnMarketCenterPage() {
  const { res, data, meta, isLoading } = useApi<StocksData>(`/api/v1/stocks?symbols=${BOARD}`, { refreshInterval: 20_000 });
  const { data: snap } = useApi<MarketSnapshot>("/api/v1/market/snapshot", { refreshInterval: 30_000 });
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("");

  const session = snap?.vnSession;
  const quotes = useMemo(() => {
    let list = data?.quotes ?? [];
    if (q) list = list.filter((x) => x.symbol.includes(q.toUpperCase()));
    if (sector) list = list.filter((x) => sectorOf(x.symbol) === sector);
    return list;
  }, [data, q, sector]);

  if (isLoading && !res) return <Loading rows={12} />;

  return (
    <div className="space-y-3">
      {/* session + indices hero */}
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 pb-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <CandlestickChart className="size-5 text-accent-primary" /> VN Market Center
          </h1>
          <Badge tone="accent">HOSE · HNX · UPCoM</Badge>
          {session && (
            <Badge tone={session.trading ? "up" : "warn"}>{session.labelVi}</Badge>
          )}
          <span className="ml-auto flex items-center gap-2">
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            <MetaLine meta={meta} />
          </span>
        </div>
        {data?.indices?.length ? (
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-4">
            {data.indices.slice(0, 4).map((i, big) => (
              <div key={i.code} className={`rounded-lg border p-3 ${big === 0 ? "border-accent-primary/40 bg-accent-primary/5" : "border-border-subtle bg-surface-elevated"}`}>
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
          title="Cần kết nối VNDirect"
          note={res && !res.success ? res.error.message : "Khi VNDirect kết nối, bảng cổ phiếu Vietnam sẽ hiển thị dữ liệu thật (không mock)."}
        />
      ) : (
        <>
          {/* board */}
          <Panel
            title={
              <span className="flex items-center gap-2">
                Bảng giá blue chips
                <span className="text-[10px] font-normal text-text-muted">{quotes.length} mã</span>
              </span>
            }
            right={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc mã…" className="w-24 rounded-md border border-border-subtle bg-surface-elevated py-1 pl-7 pr-2 text-[12px] text-text-primary" />
                </div>
                <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-36 !py-1 text-[12px]">
                  <option value="">Tất cả ngành</option>
                  {VN_SECTOR_MAP.slice(0, 18).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            }
            pad={false}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                    <th className="px-3.5 py-2 font-medium">Mã</th>
                    <th className="py-2 font-medium">Ngành</th>
                    <th className="py-2 text-right font-medium">Giá</th>
                    <th className="py-2 text-right font-medium">± %</th>
                    <th className="py-2 text-right font-medium">Tham chiếu</th>
                    <th className="py-2 text-right font-medium">Khối lượng</th>
                    <th className="py-2 text-right font-medium">Giá trị</th>
                    <th className="py-2 pr-3.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((qu) => (
                    <tr key={qu.symbol} className="row-hover border-b border-line/40">
                      <td className="px-3.5 py-2">
                        <Link href={`/stocks/${qu.symbol}`} className="font-semibold text-ink hover:text-accent">{qu.symbol}</Link>
                      </td>
                      <td className="py-2 text-[11px] text-text-muted">{sectorOf(qu.symbol)}</td>
                      <td className="num py-2 text-right">{fmtNum(qu.price, 2)}</td>
                      <td className="py-2 text-right"><Chg value={qu.changePercent} arrow={false} /></td>
                      <td className="num py-2 text-right text-text-muted">{qu.referencePrice != null ? fmtNum(qu.referencePrice, 2) : "—"}</td>
                      <td className="num py-2 text-right text-ink-2">{fmtCompact(qu.volume)}</td>
                      <td className="num py-2 text-right text-ink-2">{fmtCompact(qu.quoteVolume)}</td>
                      <td className="py-2 pr-3.5 text-right"><AddToWatchlist assetType="stock" symbol={qu.symbol} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* sectors */}
          <Panel title="Ngành chứng khoán Việt Nam (Security Master)" pad={false}>
            <div className="grid grid-cols-2 gap-1.5 p-3 md:grid-cols-4">
              {VN_SECTOR_MAP.slice(0, 16).map((s) => (
                <Link key={s.name} href={`/screener?universe=stocks&sector=${encodeURIComponent(s.name)}`} className="hover-lift flex items-center justify-between rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
                  <span className="truncate text-[12px] text-text-secondary">{s.name}</span>
                  <span className="num text-[10px] text-text-muted">{s.symbols.length} mã</span>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* default watchlist hint */}
      <p className="flex items-center gap-2 text-[11px] text-text-muted">
        <KeyRound className="size-3.5 text-warning" />
        Watchlist mặc định VN-first: {DEFAULT_VN_WATCHLIST.slice(2, 8).join(", ")}… (tùy biến tại mục Watchlist)
      </p>
    </div>
  );
}

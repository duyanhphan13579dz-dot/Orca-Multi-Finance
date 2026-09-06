"use client";

import { useApi } from "@/lib/hooks";
import type { VnEquityDetail } from "@/lib/services/stocks";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { AddToWatchlist } from "@/components/watchlist-button";

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState<string>("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);
  const { res, data, meta, isLoading } = useApi<VnEquityDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, { refreshInterval: 30_000 });

  if (!symbol || (isLoading && !res)) return <Loading rows={10} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được dữ liệu ${symbol}`}
        note={res && !res.success ? res.error.message : "VNDirect chưa khả dụng hoặc đang gián đoạn."}
      />
    );
  }

  const q = data.quote;
  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.symbol}</h1>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="stock" symbol={data.symbol} />
            </div>
            {q && (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[28px] font-semibold">{fmtNum(q.price, 2)}</span>
                <Chg value={q.changePercent} className="text-[14px]" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-right">
            <div><div className="text-[10px] uppercase text-ink-3">Khối lượng</div><div className="num text-[13px]">{fmtCompact(q?.volume)}</div></div>
            <div><div className="text-[10px] uppercase text-ink-3">Giá trị</div><div className="num text-[13px]">{fmtCompact(q?.quoteVolume)}</div></div>
            <div><div className="text-[10px] uppercase text-ink-3">Cập nhật</div><div className="num text-[13px]">{q?.updatedAt ? new Date(q.updatedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }) : "—"}</div></div>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2"><MetaLine meta={meta} /></div>
      </Panel>

      <OrcaChart
        symbol={data.symbol}
        assetType="stock"
        defaultTimeframe="1d"
        height={400}
        title={data.symbol}
        extraLevels={[
          ...(q?.ceilingPrice != null ? [{ label: "Trần", price: q.ceilingPrice, color: "rgba(181,140,255,0.7)" }] : []),
          ...(q?.referencePrice != null ? [{ label: "Tham chiếu", price: q.referencePrice, color: "rgba(245,165,36,0.7)" }] : []),
          ...(q?.floorPrice != null ? [{ label: "Sàn", price: q.floorPrice, color: "rgba(56,189,248,0.7)" }] : []),
        ]}
      />

      <TechnicalPanel tech={data.technical} patterns={data.patterns} />

      <FinancialsPanel detail={data} />
    </div>
  );
}

import { useEffect, useState } from "react";

function FinancialsPanel({ detail }: { detail: VnEquityDetail }) {
  const { financials } = detail;
  const tabs = [
    ["income", "Kết quả kinh doanh"],
    ["balance", "Cân đối kế toán"],
    ["ratios", "Chỉ số tài chính"],
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("income");
  const rows = financials[tab];
  return (
    <Panel
      title="Báo cáo tài chính (quý gần nhất — VNDirect)"
      right={
        <div className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-2 py-0.5 text-[11px] ${tab === k ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {!rows?.length ? (
        <p className="text-[12px] text-ink-3">Bộ dữ liệu này chưa khả dụng từ provider cho mã {detail.symbol}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-3 font-medium">Chỉ tiêu</th>
                {rows.slice(0, 6).map((r, i) => (
                  <th key={i} className="num py-1.5 text-right font-medium">
                    {String(r.period ?? r.yearPeriod ?? r.year ?? "")}{String(r.quarter ?? r.lengthYear ?? "") ? `Q${String(r.quarter ?? r.lengthYear ?? "")}` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(rows[0] ?? {})
                .filter((k) => typeof rows[0]?.[k] === "number")
                .slice(0, 14)
                .map((k) => (
                  <tr key={k} className="border-b border-line/40">
                    <td className="max-w-52 truncate py-1.5 pr-3 text-ink-2">{k}</td>
                    {rows.slice(0, 6).map((r, i) => (
                      <td key={i} className="num py-1.5 text-right">{typeof r[k] === "number" ? fmtCompact(r[k] as number) : "—"}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {detail.notes.length > 0 && <p className="mt-2 text-[11px] text-warn/90">{detail.notes.join(" • ")}</p>}
    </Panel>
  );
}

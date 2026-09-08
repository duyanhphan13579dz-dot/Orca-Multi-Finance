"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { AddToWatchlist } from "@/components/watchlist-button";

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState<string>("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);
  const { res, data, meta, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 30_000,
  });

  if (!symbol || (isLoading && !res)) return <Loading rows={10} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được dữ liệu ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn thị trường / báo cáo đang gián đoạn."}
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
            <div>
              <div className="text-[10px] uppercase text-ink-3">Khối lượng</div>
              <div className="num text-[13px]">{fmtCompact(q?.volume)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Giá trị</div>
              <div className="num text-[13px]">{fmtCompact(q?.quoteVolume)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Cập nhật</div>
              <div className="num text-[13px]">
                {q?.updatedAt
                  ? new Date(q.updatedAt).toLocaleTimeString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2">
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {q || data.bars.length > 0 ? (
        <OrcaChart
          symbol={data.symbol}
          assetType="stock"
          defaultTimeframe="1d"
          height={400}
          title={data.symbol}
          extraLevels={[
            ...(q?.ceilingPrice != null
              ? [{ label: "Trần", price: q.ceilingPrice, color: "rgba(181,140,255,0.7)" }]
              : []),
            ...(q?.referencePrice != null
              ? [{ label: "Tham chiếu", price: q.referencePrice, color: "rgba(245,165,36,0.7)" }]
              : []),
            ...(q?.floorPrice != null
              ? [{ label: "Sàn", price: q.floorPrice, color: "rgba(56,189,248,0.7)" }]
              : []),
          ]}
        />
      ) : null}

      {data.technical ? <TechnicalPanel tech={data.technical} patterns={data.patterns} /> : null}

      <FinancialHealthPanel detail={data} />
      <FinancialsPanel detail={data} />
    </div>
  );
}

function healthLabel(score: number | null | undefined): string {
  if (score == null) return "Chưa đủ dữ liệu";
  if (score >= 80) return "Xuất sắc";
  if (score >= 65) return "Mạnh";
  if (score >= 50) return "Ổn định";
  if (score >= 35) return "Yếu";
  return "Rủi ro cao";
}

function FinancialHealthPanel({ detail }: { detail: VnStockDetail }) {
  const h = detail.financialHealth;
  const fm = detail.financialMeta;
  if (!h && !fm) return null;
  const overall = h?.scores?.overall ?? null;
  return (
    <Panel title="Sức khỏe tài chính">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-line bg-bg-2/40 p-3">
          <div className="text-[10px] uppercase text-ink-3">Điểm tổng</div>
          <div className="num mt-1 text-[22px] font-semibold">{overall ?? "—"}<span className="text-[12px] text-ink-3">/100</span></div>
          <div className="mt-0.5 text-[12px] text-ink-2">{healthLabel(overall)}</div>
        </div>
        {([
          ["Sinh lời", h?.scores?.profitability],
          ["Thanh khoản", h?.scores?.liquidity],
          ["Đòn bẩy", h?.scores?.leverage],
          ["Dòng tiền", h?.scores?.cashflow],
          ["Hiệu quả", h?.scores?.efficiency],
        ] as const).map(([label, v]) => (
          <div key={label} className="rounded-lg border border-line/60 p-3">
            <div className="text-[10px] uppercase text-ink-3">{label}</div>
            <div className="num mt-1 text-[16px]">{v ?? "—"}</div>
          </div>
        ))}
      </div>
      {fm && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span>Kỳ gần nhất: <strong className="text-ink-2">{fm.latestPeriod ?? "—"}</strong></span>
          <span>Nguồn: <strong className="text-ink-2">{fm.primarySource}</strong></span>
          <span>Trạng thái: <strong className="text-ink-2">{fm.freshnessStatus}</strong></span>
          {fm.statementScope !== "unknown" && <span>Phạm vi: {fm.statementScope}</span>}
        </div>
      )}
      {h?.warnings?.length ? (
        <p className="mt-2 text-[11px] text-warn/90">{h.warnings.join(" • ")}</p>
      ) : null}
    </Panel>
  );
}

function FinancialsPanel({ detail }: { detail: VnStockDetail }) {
  const { financials } = detail;
  const fm = detail.financialMeta;
  const tabs = [
    ["income", "Kết quả kinh doanh"],
    ["balance", "Cân đối kế toán"],
    ["cashflow", "Lưu chuyển tiền"],
    ["ratios", "Chỉ số"],
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("income");
  const rows = financials[tab];
  const title =
    fm?.latestPeriod != null
      ? `Báo cáo tài chính — ${fm.latestPeriod}`
      : "Báo cáo tài chính";
  return (
    <Panel
      title={title}
      right={
        <div className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${tab === k ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {fm && (
        <p className="mb-2 text-[11px] text-ink-3">
          Nguồn {fm.primarySource}
          {fm.freshnessStatus === "LATEST_AVAILABLE" ? " · Dữ liệu gần nhất hiện có" : ""}
          {fm.freshnessStatus === "VERIFIED" ? " · Đã xác thực" : ""}
          {fm.freshnessStatus === "STALE" ? " · Bản lưu gần nhất" : ""}
        </p>
      )}
      {!rows?.length ? (
        <p className="text-[12px] text-ink-3">Bộ dữ liệu này chưa khả dụng cho mã {detail.symbol}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-3 font-medium">Chỉ tiêu</th>
                {rows.slice(0, 6).map((r, i) => (
                  <th key={i} className="num py-1.5 text-right font-medium">
                    {String(r.period ?? "") ||
                      `${String(r.year ?? "")}${r.quarter != null ? `Q${r.quarter}` : ""}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(rows[0] ?? {})
                .filter((k) => typeof rows[0]?.[k] === "number")
                .slice(0, 16)
                .map((k) => (
                  <tr key={k} className="border-b border-line/40">
                    <td className="max-w-52 truncate py-1.5 pr-3 text-ink-2">{k}</td>
                    {rows.slice(0, 6).map((r, i) => (
                      <td key={i} className="num py-1.5 text-right">
                        {typeof r[k] === "number" ? fmtCompact(r[k] as number) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {detail.notes.length > 0 && (
        <p className="mt-2 text-[11px] text-warn/90">{detail.notes.join(" • ")}</p>
      )}
    </Panel>
  );
}

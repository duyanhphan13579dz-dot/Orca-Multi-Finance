"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { fmtCompact, Loading, Panel, Unavailable } from "@/components/ui";

type TabKey = "income" | "balance" | "cashflow" | "ratios";

const TABS: { key: TabKey; label: string }[] = [
  { key: "income", label: "Kết quả kinh doanh" },
  { key: "balance", label: "Cân đối kế toán" },
  { key: "cashflow", label: "Lưu chuyển tiền tệ" },
  { key: "ratios", label: "Chỉ số" },
];

export default function StockFinancialsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [tab, setTab] = useState<TabKey>("income");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 300_000,
  });

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được BCTC ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn báo cáo đang gián đoạn."}
      />
    );
  }

  const fm = data.financialMeta;
  const sourceLabel = fm?.primarySource ?? "vndirect-fs";
  const rows = data.financials[tab];

  return (
    <div className="space-y-3">
      <Panel
        title={fm?.latestPeriod ? `Báo cáo tài chính — ${fm.latestPeriod}` : "Báo cáo tài chính"}
        right={
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md px-2 py-0.5 text-[11px] ${
                  tab === t.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span>
            Nguồn bảng: <strong className="text-ink-2">{sourceLabel}</strong>
          </span>
          {fm?.freshnessStatus && (
            <span>
              Trạng thái: <strong className="text-ink-2">{fm.freshnessStatus}</strong>
            </span>
          )}
          {fm?.statementScope && fm.statementScope !== "unknown" && (
            <span>Phạm vi: {fm.statementScope}</span>
          )}
        </div>

        {!rows?.length ? (
          <p className="text-[12px] text-ink-3">Bảng này chưa có dữ liệu từ {sourceLabel}.</p>
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
                  .slice(0, 18)
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

        <p className="mt-2 text-[10px] text-ink-3">
          Mỗi bảng (KQKD / CĐKT / LCTT) đang lấy từ cùng nguồn cấu trúc {sourceLabel}. Khi có SSI, có thể gắn nguồn riêng
          từng bảng và đối chiếu chéo.
        </p>
      </Panel>

      {data.notes.length > 0 && (
        <p className="text-[11px] text-warn/90">{data.notes.join(" • ")}</p>
      )}
    </div>
  );
}

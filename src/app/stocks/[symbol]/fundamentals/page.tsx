"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { fmtCompact, Loading, Panel, Unavailable } from "@/components/ui";

function healthLabel(score: number | null | undefined): string {
  if (score == null) return "Chưa đủ dữ liệu";
  if (score >= 80) return "Xuất sắc";
  if (score >= 65) return "Mạnh";
  if (score >= 50) return "Ổn định";
  if (score >= 35) return "Yếu";
  return "Rủi ro cao";
}

export default function StockFundamentalsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 120_000,
  });

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được chỉ số cơ bản ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn đang gián đoạn."}
      />
    );
  }

  const h = data.financialHealth;
  const fm = data.financialMeta;
  const overall = h?.scores?.overall ?? null;
  const anchors = h?.anchors;

  return (
    <div className="space-y-3">
      <Panel title="Sức khỏe tài chính doanh nghiệp">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-line bg-bg-2/40 p-3">
            <div className="text-[10px] uppercase text-ink-3">Điểm tổng</div>
            <div className="num mt-1 text-[22px] font-semibold">
              {overall ?? "—"}
              <span className="text-[12px] text-ink-3">/100</span>
            </div>
            <div className="mt-0.5 text-[12px] text-ink-2">{healthLabel(overall)}</div>
          </div>
          {(
            [
              ["Sinh lời", h?.scores?.profitability],
              ["Thanh khoản", h?.scores?.liquidity],
              ["Đòn bẩy", h?.scores?.leverage],
              ["Dòng tiền", h?.scores?.cashflow],
              ["Hiệu quả", h?.scores?.efficiency],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-line/60 p-3">
              <div className="text-[10px] uppercase text-ink-3">{label}</div>
              <div className="num mt-1 text-[16px]">{v ?? "—"}</div>
            </div>
          ))}
        </div>
        {fm && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span>
              Kỳ: <strong className="text-ink-2">{fm.latestPeriod ?? "—"}</strong>
            </span>
            <span>
              Nguồn: <strong className="text-ink-2">{fm.primarySource}</strong>
            </span>
            <span>
              Trạng thái: <strong className="text-ink-2">{fm.freshnessStatus}</strong>
            </span>
          </div>
        )}
        {h?.warnings?.length ? (
          <p className="mt-2 text-[11px] text-warn/90">{h.warnings.join(" • ")}</p>
        ) : null}
      </Panel>

      <Panel title="Hiệu suất kinh doanh & đầu tư (neo số liệu)">
        {!anchors ? (
          <p className="text-[12px] text-ink-3">Chưa có neo số liệu từ báo cáo.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            {(
              [
                ["Doanh thu (TTM)", anchors.revenue],
                ["Lợi nhuận ròng", anchors.netProfit],
                ["Vốn CSH", anchors.equity],
                ["Tổng nợ", anchors.totalDebt],
                ["OCF (TTM)", anchors.ocfTtm],
                ["FCF (TTM)", anchors.fcfTtm],
                ["EPS (TTM)", anchors.epsTtm],
                ["EBITDA (TTM)", anchors.ebitdaTtm],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded border border-line/50 p-2">
                <div className="text-[10px] text-ink-3">{label}</div>
                <div className="num mt-0.5">{v != null ? fmtCompact(v) : "—"}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Định giá doanh nghiệp">
        <p className="text-[12px] text-ink-3">
          Module định giá (P/E, P/B, EV/EBITDA, DCF) chạy qua engine phân tích khi đủ dữ liệu báo cáo và giá.
          Xem thêm trong báo cáo phân tích AI nếu đã bật.
        </p>
      </Panel>
    </div>
  );
}

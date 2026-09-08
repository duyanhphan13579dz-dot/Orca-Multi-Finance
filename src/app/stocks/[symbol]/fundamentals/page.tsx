"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { fmtCompact, Loading, Panel, Unavailable } from "@/components/ui";

function healthLabel(score: number | null | undefined): string {
  if (score == null) return "Chưa đủ dữ liệu";
  if (score >= 80) return "Xuất sắc (80–100)";
  if (score >= 65) return "Mạnh (65–79)";
  if (score >= 50) return "Ổn định (50–64)";
  if (score >= 35) return "Yếu (35–49)";
  return "Rủi ro cao (0–34)";
}

function statusVi(s: string | undefined): string {
  switch (s) {
    case "VERIFIED":
      return "Đã xác thực";
    case "LATEST_AVAILABLE":
      return "Dữ liệu gần nhất hiện có";
    case "STALE":
      return "Bản lưu gần nhất (stale)";
    case "UNVERIFIED":
      return "Chưa xác thực";
    case "DISCREPANCY_DETECTED":
      return "Phát hiện lệch nguồn";
    case "SOURCE_UNAVAILABLE":
      return "Nguồn không khả dụng";
    default:
      return s ?? "—";
  }
}

const RATIO_LABEL: Record<string, string> = {
  grossMargin: "Biên gộp",
  operatingMargin: "Biên HĐ",
  netMargin: "Biên ròng",
  roa: "ROA",
  roe: "ROE",
  currentRatio: "Current ratio",
  quickRatio: "Quick ratio",
  cashRatio: "Cash ratio",
  debtEquity: "Nợ / VCSH",
  debtEbitda: "Nợ / EBITDA",
  interestCoverage: "Interest coverage",
  ocfToNi: "OCF / LN ròng",
  fcfMargin: "Biên FCF",
  assetTurnover: "Vòng quay TS",
  inventoryTurnover: "Vòng quay tồn kho",
  receivableTurnover: "Vòng quay phải thu",
};

function RatioGrid({ title, ratios }: { title: string; ratios: Record<string, number | null> | undefined }) {
  const entries = Object.entries(ratios ?? {}).filter(([, v]) => v != null);
  return (
    <div className="rounded-lg border border-line/60 p-3">
      <div className="mb-2 text-[11px] font-medium text-ink-2">{title}</div>
      {!entries.length ? (
        <p className="text-[11px] text-ink-3">Chưa đủ số liệu để tính.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-ink-3">{RATIO_LABEL[k] ?? k}</span>
              <span className="num text-ink-2">
                {v == null
                  ? "—"
                  : Math.abs(v) < 2 && !k.toLowerCase().includes("turnover")
                    ? `${(v * 100).toFixed(1)}%`
                    : v.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
      <Panel title="Trạng thái dữ liệu cơ bản">
        <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-ink-3">Kỳ gần nhất</div>
            <div className="font-medium text-ink-2">{fm?.latestPeriod ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Loại / phạm vi</div>
            <div className="font-medium text-ink-2">
              {fm?.reportTypeLabel ?? "—"}
              {fm?.statementScope && fm.statementScope !== "unknown" ? ` · ${fm.statementScope}` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Nguồn</div>
            <div className="font-medium text-ink-2">{fm?.primarySource ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Xác thực</div>
            <div className="font-medium text-ink-2">{statusVi(fm?.freshnessStatus)}</div>
          </div>
        </div>
        {fm?.note && <p className="mt-2 text-[11px] text-ink-3">{fm.note}</p>}
      </Panel>

      <Panel title="Sức khỏe tài chính doanh nghiệp">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-line bg-bg-2/40 p-3">
            <div className="text-[10px] uppercase text-ink-3">Điểm tổng</div>
            <div className="num mt-1 text-[22px] font-semibold">
              {overall ?? "—"}
              <span className="text-[12px] text-ink-3">/100</span>
            </div>
            <div className="mt-0.5 text-[12px] text-ink-2">{healthLabel(overall)}</div>
            {h?.coverage != null && (
              <div className="mt-1 text-[10px] text-ink-3">Độ phủ số liệu {(h.coverage * 100).toFixed(0)}%</div>
            )}
          </div>
          {(
            [
              ["Sinh lời", h?.scores?.profitability],
              ["Thanh khoản", h?.scores?.liquidity],
              ["Đòn bẩy / solvency", h?.scores?.leverage],
              ["Chất lượng dòng tiền", h?.scores?.cashflow],
              ["Hiệu quả", h?.scores?.efficiency],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-line/60 p-3">
              <div className="text-[10px] uppercase text-ink-3">{label}</div>
              <div className="num mt-1 text-[16px]">{v ?? "—"}</div>
            </div>
          ))}
        </div>
        {h?.warnings?.length ? (
          <p className="mt-2 text-[11px] text-warn/90">{h.warnings.join(" • ")}</p>
        ) : null}
      </Panel>

      <Panel title="Chỉ số theo nhóm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <RatioGrid title="A. Sinh lời" ratios={h?.groups?.profitability} />
          <RatioGrid title="B. Thanh khoản" ratios={h?.groups?.liquidity} />
          <RatioGrid title="C. Khả năng trả nợ" ratios={h?.groups?.leverage} />
          <RatioGrid title="D. Dòng tiền" ratios={h?.groups?.cashflow} />
          <RatioGrid title="E. Hiệu quả" ratios={h?.groups?.efficiency} />
        </div>
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
          P/E, P/B, EV/EBITDA sẽ hiển thị khi engine định giá có đủ giá thị trường + EPS/book. Module industry scoring
          (ngân hàng, BĐS…) thuộc Phase 4 còn lại của Financial Data Engine.
        </p>
      </Panel>
    </div>
  );
}

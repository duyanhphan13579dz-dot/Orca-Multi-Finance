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
      return "Bản lưu gần nhất";
    case "SOURCE_UNAVAILABLE":
      return "Nguồn không khả dụng";
    default:
      return s ?? "—";
  }
}

function fmtRatio(v: number | null | undefined, kind: "pct" | "x" | "num" = "num"): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "x") return `${v.toFixed(2)}x`;
  if (Math.abs(v) >= 1e9 || Math.abs(v) < 0.01) return fmtCompact(v);
  return v.toFixed(2);
}

function RatioBlock({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number | null | undefined; kind?: "pct" | "x" | "num" }[];
}) {
  return (
    <div className="rounded-lg border border-line/50 p-3">
      <div className="mb-2 text-[11px] font-medium text-ink-2">{title}</div>
      <ul className="space-y-1.5 text-[12px]">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-2">
            <span className="text-ink-3">{it.label}</span>
            <span className="num font-medium text-ink-2">{fmtRatio(it.value, it.kind ?? "num")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StockFundamentalsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
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
        title={`Không lấy được phân tích cơ bản ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn đang gián đoạn."}
      />
    );
  }

  const h = data.financialHealth;
  const fm = data.financialMeta;
  const growth = data.financialGrowth;
  const overall = h?.scores?.overall ?? null;
  const g = h?.groups;

  return (
    <div className="space-y-3">
      <Panel title="Sức khỏe tài chính">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-ink-3">Điểm tổng</div>
            <div className="text-xl font-semibold text-ink-2">
              {overall != null ? overall.toFixed(0) : "—"}
              <span className="ml-2 text-[12px] font-normal text-ink-3">{healthLabel(overall)}</span>
            </div>
            {h?.coverage != null && (
              <div className="mt-1 text-[10px] text-ink-3">Độ phủ số liệu {(h.coverage * 100).toFixed(0)}%</div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Kỳ / Phạm vi</div>
            <div className="font-medium text-ink-2">
              {fm?.latestPeriod ?? "—"}
              {fm?.statementScope && fm.statementScope !== "unknown" ? ` · ${fm.statementScope}` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Nguồn</div>
            <div className="font-medium text-ink-2">{fm?.primarySource ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Trạng thái</div>
            <div className="font-medium text-ink-2">{statusVi(fm?.freshnessStatus)}</div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          {(
            [
              ["Sinh lời", h?.scores?.profitability],
              ["Thanh khoản", h?.scores?.liquidity],
              ["Đòn bẩy", h?.scores?.leverage],
              ["Dòng tiền", h?.scores?.cashflow],
              ["Hiệu quả", h?.scores?.efficiency],
            ] as const
          ).map(([label, score]) => (
            <div key={label} className="rounded-md border border-line/40 px-2 py-1.5 text-center">
              <div className="text-[10px] text-ink-3">{label}</div>
              <div className="text-[14px] font-semibold text-ink-2">{score != null ? score.toFixed(0) : "—"}</div>
            </div>
          ))}
        </div>

        {h?.industry && (
          <p className="mt-2 text-[11px] text-ink-3">
            <strong className="text-ink-2">Profile ngành:</strong> {h.industry.labelVi} ({h.industry.id})
          </p>
        )}

        {h?.riskFlags && h.riskFlags.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-warn/90">
            {h.riskFlags.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        )}
      </Panel>

      {g && (
        <Panel title="Nhóm chỉ số">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <RatioBlock
              title="Sinh lời"
              items={[
                { label: "Biên gộp", value: g.profitability.grossMargin, kind: "pct" },
                { label: "Biên HĐKD", value: g.profitability.operatingMargin, kind: "pct" },
                { label: "Biên ròng", value: g.profitability.netMargin, kind: "pct" },
                { label: "ROE", value: g.profitability.roe, kind: "pct" },
                { label: "ROA", value: g.profitability.roa, kind: "pct" },
              ]}
            />
            <RatioBlock
              title="Thanh khoản"
              items={[
                { label: "Current ratio", value: g.liquidity.currentRatio, kind: "x" },
                { label: "Quick ratio", value: g.liquidity.quickRatio, kind: "x" },
                { label: "Cash ratio", value: g.liquidity.cashRatio, kind: "x" },
              ]}
            />
            <RatioBlock
              title="Đòn bẩy"
              items={[
                { label: "Nợ / VCSH", value: g.leverage.debtToEquity, kind: "x" },
                { label: "Nợ / Tài sản", value: g.leverage.debtToAssets, kind: "x" },
                { label: "Interest coverage", value: g.leverage.interestCoverage, kind: "x" },
              ]}
            />
            <RatioBlock
              title="Dòng tiền"
              items={[
                { label: "OCF / LN", value: g.cashflow.ocfToNi, kind: "x" },
                { label: "FCF margin", value: g.cashflow.fcfMargin, kind: "pct" },
              ]}
            />
            <RatioBlock
              title="Hiệu quả"
              items={[
                { label: "Asset turnover", value: g.efficiency.assetTurnover, kind: "x" },
                { label: "Receivable days", value: g.efficiency.receivableDays, kind: "num" },
                { label: "Inventory days", value: g.efficiency.inventoryDays, kind: "num" },
              ]}
            />
          </div>
        </Panel>
      )}

      {growth && (growth.yoy.length > 0 || growth.qoq.length > 0) && (
        <Panel title="Tăng trưởng">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">
                YoY
                {growth.latestPeriod && growth.priorYearPeriod
                  ? ` (${growth.latestPeriod} vs ${growth.priorYearPeriod})`
                  : ""}
              </div>
              {!growth.yoy.length ? (
                <p className="text-[11px] text-ink-3">Chưa có so sánh YoY.</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {growth.yoy.map((c) => (
                    <li key={c.key} className="flex justify-between gap-2">
                      <span className="text-ink-3">{c.labelVi ?? c.key}</span>
                      <span className="num font-medium">
                        {c.value != null ? `${(c.value * 100).toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">
                QoQ
                {growth.latestPeriod && growth.priorQuarterPeriod
                  ? ` (${growth.latestPeriod} vs ${growth.priorQuarterPeriod})`
                  : ""}
              </div>
              {!growth.qoq.length ? (
                <p className="text-[11px] text-ink-3">Không có quý liền trước để so sánh.</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {growth.qoq.map((c) => (
                    <li key={c.key} className="flex justify-between gap-2">
                      <span className="text-ink-3">{c.labelVi ?? c.key}</span>
                      <span className="num font-medium">
                        {c.value != null ? `${(c.value * 100).toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Nguồn đối chiếu (VNDIRECT DStock)">
        <ul className="space-y-1.5 text-[12px]">
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Bảng cân đối kế toán — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kết quả kinh doanh — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lưu chuyển tiền tệ — {symbol}
            </a>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

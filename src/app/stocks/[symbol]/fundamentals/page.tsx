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
        note={res && !res.success ? res.error.message : "Nguồn báo cáo đang gián đoạn."}
      />
    );
  }

  const h = data.financialHealth;
  const fm = data.financialMeta;
  const growth = data.financialGrowth;
  const ttm = data.financialTtm;

  return (
    <div className="space-y-3">
      <Panel title="Sức khỏe tài chính">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-ink-3">Điểm tổng</div>
            <div className="text-xl font-semibold text-ink-2">
              {h?.score != null ? h.score.toFixed(0) : "—"}
              <span className="ml-2 text-[12px] font-normal text-ink-3">{healthLabel(h?.score)}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Kỳ mới nhất</div>
            <div className="font-medium text-ink-2">{fm?.latestPeriod ?? "—"}</div>
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
        {h?.industry && (
          <p className="mt-2 text-[11px] text-ink-3">
            Ngành: <strong className="text-ink-2">{h.industry.labelVi ?? h.industry.id}</strong>
          </p>
        )}
      </Panel>

      {h?.pillars && h.pillars.length > 0 && (
        <Panel title="Trụ cột">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {h.pillars.map((p) => (
              <div key={p.id} className="rounded-lg border border-line/60 bg-background-secondary/40 px-3 py-2">
                <div className="text-[11px] text-ink-3">{p.labelVi ?? p.id}</div>
                <div className="text-[15px] font-semibold text-ink-2">
                  {p.score != null ? p.score.toFixed(0) : "—"}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {ttm && (
        <Panel title={`TTM ${ttm.period ?? ""}`.trim()}>
          <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-[10px] text-ink-3">Doanh thu thuần</div>
              <div className="font-medium">{fmtCompact(ttm.metrics?.netRevenue ?? ttm.metrics?.revenue)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink-3">LN sau thuế</div>
              <div className="font-medium">{fmtCompact(ttm.metrics?.netIncome)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink-3">Tổng tài sản</div>
              <div className="font-medium">{fmtCompact(ttm.metrics?.totalAssets)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink-3">Vốn chủ</div>
              <div className="font-medium">{fmtCompact(ttm.metrics?.equity)}</div>
            </div>
          </div>
        </Panel>
      )}

      {growth && (growth.yoy?.length || growth.qoq?.length) ? (
        <Panel title="Tăng trưởng">
          <div className="grid gap-3 md:grid-cols-2">
            {growth.yoy?.length ? (
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">YoY</div>
                <ul className="space-y-1 text-[12px]">
                  {growth.yoy.slice(0, 8).map((g) => (
                    <li key={g.key} className="flex justify-between gap-2">
                      <span className="text-ink-3">{g.labelVi ?? g.key}</span>
                      <span className="num font-medium">
                        {g.value != null ? `${(g.value * 100).toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {growth.qoq?.length ? (
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">QoQ</div>
                <ul className="space-y-1 text-[12px]">
                  {growth.qoq.slice(0, 8).map((g) => (
                    <li key={g.key} className="flex justify-between gap-2">
                      <span className="text-ink-3">{g.labelVi ?? g.key}</span>
                      <span className="num font-medium">
                        {g.value != null ? `${(g.value * 100).toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

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

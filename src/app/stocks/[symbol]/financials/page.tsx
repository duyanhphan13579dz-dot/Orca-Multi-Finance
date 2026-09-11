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

/** Metadata fields — never show as metric rows */
const META_KEYS = new Set([
  "period",
  "year",
  "quarter",
  "fiscalDate",
  "source",
  "periodType",
  "metricProfile",
  "metricLabelsVi",
  "metricLabelsEn",
]);

const METRIC_VI: Record<string, string> = {
  // Income
  revenue: "Doanh thu",
  netRevenue: "Doanh thu thuần",
  cogs: "Giá vốn hàng bán",
  grossProfit: "Lợi nhuận gộp",
  operatingProfit: "LN thuần từ HĐKD",
  ebit: "EBIT",
  ebitda: "EBITDA",
  interestExpense: "Chi phí lãi vay",
  profitBeforeTax: "LN trước thuế",
  taxExpense: "Chi phí thuế TNDN",
  netIncome: "LN sau thuế",
  netProfit: "LN sau thuế",
  netIncomeParent: "LN thuộc công ty mẹ",
  // Balance
  cash: "Tiền & tương đương tiền",
  shortTermInvestments: "Đầu tư tài chính ngắn hạn",
  receivables: "Phải thu ngắn hạn",
  inventory: "Hàng tồn kho",
  currentAssets: "Tài sản ngắn hạn",
  fixedAssets: "Tài sản cố định",
  longTermAssets: "Tài sản dài hạn",
  totalAssets: "Tổng tài sản",
  shortTermDebt: "Vay ngắn hạn",
  longTermDebt: "Vay dài hạn",
  currentLiabilities: "Nợ ngắn hạn",
  totalLiabilities: "Tổng nợ phải trả",
  equity: "Vốn chủ sở hữu",
  retainedEarnings: "Lợi nhuận giữ lại",
  // Cash flow
  operatingCashFlow: "LC tiền thuần từ HĐKD",
  investingCashFlow: "LC tiền thuần từ HĐ đầu tư",
  financingCashFlow: "LC tiền thuần từ HĐ tài chính",
  capex: "Mua sắm TSCĐ (Capex)",
  freeCashFlow: "Dòng tiền tự do (FCF)",
  cashBegin: "Tiền đầu kỳ",
  cashEnd: "Tiền cuối kỳ",
  // Ratios
  grossMargin: "Biên LN gộp",
  operatingMargin: "Biên LN HĐKD",
  netMargin: "Biên LN ròng",
  roe: "ROE",
  roa: "ROA",
  debtToEquity: "Nợ / Vốn chủ",
  currentRatio: "Hệ số thanh toán hiện hành",
  ocfToNi: "OCF / LN ròng",
};

const RATIO_PCT_KEYS = new Set(["grossMargin", "operatingMargin", "netMargin", "roe", "roa"]);

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

function formatMetricValue(key: string, v: number): string {
  if (RATIO_PCT_KEYS.has(key)) {
    return `${(v * 100).toFixed(1)}%`;
  }
  if (key === "debtToEquity" || key === "currentRatio" || key === "ocfToNi") {
    return v.toFixed(2);
  }
  return fmtCompact(v);
}

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

  const metricKeys = Object.keys(rows?.[0] ?? {}).filter(
    (k) => !META_KEYS.has(k) && typeof rows?.[0]?.[k] === "number",
  );
  const preferred = Object.keys(METRIC_VI).filter((k) => metricKeys.includes(k));
  const rest = metricKeys.filter((k) => !METRIC_VI[k]);
  const orderedKeys = [...preferred, ...rest].slice(0, 24);

  return (
    <div className="space-y-3">
      <Panel title="Trạng thái báo cáo">
        <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-ink-3">Dữ liệu mới nhất</div>
            <div className="font-medium text-ink-2">{fm?.latestPeriod ?? "Chưa xác định kỳ"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Loại báo cáo</div>
            <div className="font-medium text-ink-2">
              {fm?.reportTypeLabel ?? "—"}
              {fm?.auditStatus && fm.auditStatus !== "unknown" ? ` · ${fm.auditStatus}` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Phạm vi</div>
            <div className="font-medium text-ink-2">
              {fm?.statementScope === "consolidated"
                ? "Hợp nhất"
                : fm?.statementScope === "standalone"
                  ? "Riêng"
                  : "Chưa phân loại"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Trạng thái</div>
            <div className="font-medium text-ink-2">{statusVi(fm?.freshnessStatus)}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span>
            Nguồn: <strong className="text-ink-2">{sourceLabel}</strong>
          </span>
          {fm?.fetchedAt && (
            <span>
              Lấy lúc:{" "}
              {new Date(fm.fetchedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            </span>
          )}
          {fm?.fallbackLevel != null && fm.fallbackLevel > 0 && (
            <span>Fallback level: {fm.fallbackLevel}</span>
          )}
        </div>
        {fm?.freshnessStatus === "LATEST_AVAILABLE" && (
          <p className="mt-2 text-[11px] text-ink-3">
            Đang hiển thị kỳ gần nhất hiện có. Kỳ mới hơn (nếu có) sẽ cập nhật khi VNDIRECT DStock công bố.
          </p>
        )}
        {fm?.freshnessStatus === "STALE" && (
          <p className="mt-2 text-[11px] text-warn/90">
            Đang dùng bản lưu gần nhất — nguồn live tạm thời không phản hồi.
          </p>
        )}
      </Panel>

      <Panel
        title="Bảng báo cáo"
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
        <div className="mb-2 text-[11px] text-ink-3">
          Nguồn bảng <strong className="text-ink-2">{TABS.find((x) => x.key === tab)?.label}</strong>:{" "}
          <strong className="text-ink-2">{sourceLabel}</strong>
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
                {orderedKeys.map((k) => (
                  <tr key={k} className="border-b border-line/40">
                    <td className="max-w-56 truncate py-1.5 pr-3 text-ink-2" title={METRIC_VI[k] ?? k}>
                      {METRIC_VI[k] ?? k}
                    </td>
                    {rows.slice(0, 6).map((r, i) => (
                      <td key={i} className="num py-1.5 text-right">
                        {typeof r[k] === "number" ? formatMetricValue(k, r[k] as number) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-[10px] text-ink-3">
          Số liệu tuyệt đối (VND) từ api-finfo VNDIRECT — cùng nguồn structured với DStock. DStock UI thường
          hiển thị đơn vị <strong className="text-ink-2">tỷ đồng</strong>. Chỉ số biên lợi nhuận / ROE /
          ROA hiển thị dạng %.
        </p>
      </Panel>

      <Panel title="Nguồn đối chiếu (VNDIRECT DStock)">
        <ul className="space-y-1.5 text-[12px]">
          <li>
            <span className="text-ink-3">Bảng cân đối kế toán: </span>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              dstock.vndirect.com.vn/bang-can-doi-ke-toan/{symbol}
            </a>
          </li>
          <li>
            <span className="text-ink-3">Kết quả kinh doanh: </span>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/{symbol}
            </a>
          </li>
          <li>
            <span className="text-ink-3">Lưu chuyển tiền tệ: </span>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/{symbol}
            </a>
          </li>
        </ul>
      </Panel>

      {data.notes.length > 0 && (
        <p className="text-[11px] text-warn/90">{data.notes.join(" • ")}</p>
      )}
    </div>
  );
}

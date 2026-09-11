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
  { key: "ratios", label: "Chỉ số tự động" },
];

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

/** Chuẩn hóa tên chỉ tiêu tiếng Việt (bám DStock / VAS) */
const METRIC_VI: Record<string, string> = {
  // Kết quả kinh doanh
  revenue: "Doanh thu",
  netRevenue: "Doanh thu thuần",
  cogs: "Giá vốn hàng bán",
  grossProfit: "Lợi nhuận gộp",
  operatingProfit: "Lợi nhuận thuần từ HĐKD",
  ebit: "EBIT (LN trước lãi & thuế)",
  ebitda: "EBITDA",
  interestExpense: "Chi phí lãi vay",
  profitBeforeTax: "Lợi nhuận trước thuế",
  taxExpense: "Chi phí thuế TNDN",
  netIncome: "Lợi nhuận sau thuế",
  netProfit: "Lợi nhuận sau thuế",
  netIncomeParent: "LNST thuộc về công ty mẹ",
  // Cân đối kế toán
  cash: "Tiền và tương đương tiền",
  shortTermInvestments: "Đầu tư tài chính ngắn hạn",
  receivables: "Các khoản phải thu ngắn hạn",
  inventory: "Hàng tồn kho",
  currentAssets: "Tài sản ngắn hạn",
  fixedAssets: "Tài sản cố định",
  longTermAssets: "Tài sản dài hạn",
  totalAssets: "Tổng cộng tài sản",
  shortTermDebt: "Vay và nợ thuê tài chính ngắn hạn",
  longTermDebt: "Vay và nợ thuê tài chính dài hạn",
  currentLiabilities: "Nợ ngắn hạn",
  totalLiabilities: "Tổng nợ phải trả",
  equity: "Vốn chủ sở hữu",
  retainedEarnings: "Lợi nhuận sau thuế chưa phân phối",
  // Lưu chuyển tiền tệ
  operatingCashFlow: "Lưu chuyển tiền thuần từ HĐKD",
  investingCashFlow: "Lưu chuyển tiền thuần từ HĐ đầu tư",
  financingCashFlow: "Lưu chuyển tiền thuần từ HĐ tài chính",
  capex: "Chi mua sắm TSCĐ (Capex)",
  freeCashFlow: "Dòng tiền tự do (FCF)",
  cashBegin: "Tiền và tương đương tiền đầu kỳ",
  cashEnd: "Tiền và tương đương tiền cuối kỳ",
  // Chỉ số tự động tính
  grossMargin: "Biên lợi nhuận gộp",
  operatingMargin: "Biên lợi nhuận HĐKD",
  netMargin: "Biên lợi nhuận ròng",
  roe: "ROE (LNST / Vốn chủ)",
  roa: "ROA (LNST / Tổng tài sản)",
  debtToEquity: "Hệ số nợ / Vốn chủ sở hữu",
  currentRatio: "Hệ số thanh toán hiện hành",
  ocfToNi: "OCF / Lợi nhuận sau thuế",
};

/** Thứ tự hiển thị ưu tiên theo từng bảng */
const ORDER: Record<TabKey, string[]> = {
  income: [
    "netRevenue",
    "revenue",
    "cogs",
    "grossProfit",
    "operatingProfit",
    "ebit",
    "ebitda",
    "interestExpense",
    "profitBeforeTax",
    "taxExpense",
    "netIncome",
    "netProfit",
    "netIncomeParent",
  ],
  balance: [
    "cash",
    "shortTermInvestments",
    "receivables",
    "inventory",
    "currentAssets",
    "fixedAssets",
    "longTermAssets",
    "totalAssets",
    "shortTermDebt",
    "currentLiabilities",
    "longTermDebt",
    "totalLiabilities",
    "equity",
    "retainedEarnings",
  ],
  cashflow: [
    "operatingCashFlow",
    "investingCashFlow",
    "financingCashFlow",
    "capex",
    "freeCashFlow",
    "cashBegin",
    "cashEnd",
  ],
  ratios: [
    "grossMargin",
    "operatingMargin",
    "netMargin",
    "roe",
    "roa",
    "debtToEquity",
    "currentRatio",
    "ocfToNi",
  ],
};

const RATIO_PCT_KEYS = new Set(["grossMargin", "operatingMargin", "netMargin", "roe", "roa"]);

function statusVi(s: string | undefined): string {
  switch (s) {
    case "VERIFIED":
      return "Đã xác thực";
    case "LATEST_AVAILABLE":
      return "Kỳ gần nhất hiện có";
    case "STALE":
      return "Bản lưu gần nhất";
    case "SOURCE_UNAVAILABLE":
      return "Nguồn không khả dụng";
    default:
      return s ?? "—";
  }
}

function formatMetricValue(key: string, v: number): string {
  if (RATIO_PCT_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  if (key === "debtToEquity" || key === "currentRatio" || key === "ocfToNi") return v.toFixed(2);
  return fmtCompact(v);
}

function periodHeader(r: Record<string, unknown>): string {
  const p = r.period;
  if (typeof p === "string" && p) return p;
  const y = r.year;
  const q = r.quarter;
  if (y != null && q != null) return `${y}-Q${q}`;
  if (y != null) return String(y);
  return "—";
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
  const rows = data.financials[tab] ?? [];

  const metricKeys = Object.keys(rows[0] ?? {}).filter(
    (k) => !META_KEYS.has(k) && typeof rows[0]?.[k] === "number",
  );
  const preferred = ORDER[tab].filter((k) => metricKeys.includes(k));
  const rest = metricKeys.filter((k) => !preferred.includes(k));
  const orderedKeys = [...preferred, ...rest].slice(0, 28);

  return (
    <div className="space-y-3">
      {/* Ưu tiên: bảng báo cáo tài chính lên đầu */}
      <Panel
        title="Bảng báo cáo tài chính"
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
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span>
            {TABS.find((x) => x.key === tab)?.label} · Nguồn{" "}
            <strong className="text-ink-2">{sourceLabel}</strong>
          </span>
          {fm?.latestPeriod && (
            <span>
              Kỳ mới nhất: <strong className="text-ink-2">{fm.latestPeriod}</strong>
            </span>
          )}
          {tab === "ratios" && (
            <span className="text-accent/90">Chỉ số được tính tự động từ BCTC</span>
          )}
        </div>

        {!rows.length ? (
          <p className="text-[12px] text-ink-3">Bảng này chưa có dữ liệu từ {sourceLabel}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="sticky left-0 bg-bg-2 py-1.5 pr-3 font-medium">Chỉ tiêu</th>
                  {rows.slice(0, 8).map((r, i) => (
                    <th key={i} className="num py-1.5 pl-2 text-right font-medium">
                      {periodHeader(r as Record<string, unknown>)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedKeys.map((k) => (
                  <tr key={k} className="border-b border-line/40">
                    <td
                      className="sticky left-0 max-w-64 truncate bg-bg-2 py-1.5 pr-3 text-ink-2"
                      title={METRIC_VI[k] ?? k}
                    >
                      {METRIC_VI[k] ?? k}
                    </td>
                    {rows.slice(0, 8).map((r, i) => (
                      <td key={i} className="num py-1.5 pl-2 text-right">
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
          Số tuyệt đối theo VND (api-finfo / DStock). Biên lợi nhuận, ROE, ROA hiển thị %.
        </p>
      </Panel>

      <Panel title="Trạng thái báo cáo">
        <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-ink-3">Dữ liệu mới nhất</div>
            <div className="font-medium text-ink-2">{fm?.latestPeriod ?? "Chưa xác định kỳ"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-3">Loại báo cáo</div>
            <div className="font-medium text-ink-2">{fm?.reportTypeLabel ?? "—"}</div>
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
    </div>
  );
}

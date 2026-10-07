"use client";

import "@/app/stock-fs-table.css";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import { fmtCompact, Loading, Panel, Unavailable } from "@/components/ui";
import { financialsApiUrl, type FinTablePayload } from "@/components/stocks/financials-table-data";

type TabKey = "income" | "balance" | "cashflow" | "ratios";

const TABS: { key: TabKey; label: string; short: string }[] = [
  { key: "income", label: "Kết quả kinh doanh", short: "KQKD" },
  { key: "balance", label: "Cân đối kế toán", short: "CĐKT" },
  { key: "cashflow", label: "Lưu chuyển tiền tệ", short: "LCTT" },
  { key: "ratios", label: "Chỉ số tự động", short: "Chỉ số" },
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
  "sourceUrl",
  "sourceUrls",
  "unit",
]);

const METRIC_VI: Record<string, string> = {
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
  netIncomeParent: "LNST thuộc về công ty mẹ",
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
  operatingCashFlow: "Lưu chuyển tiền thuần từ HĐKD",
  investingCashFlow: "Lưu chuyển tiền thuần từ HĐ đầu tư",
  financingCashFlow: "Lưu chuyển tiền thuần từ HĐ tài chính",
  capex: "Chi mua sắm TSCĐ (Capex)",
  freeCashFlow: "Dòng tiền tự do (FCF)",
  cashBegin: "Tiền và tương đương tiền đầu kỳ",
  cashEnd: "Tiền và tương đương tiền cuối kỳ",
  grossMargin: "Biên lợi nhuận gộp",
  operatingMargin: "Biên lợi nhuận HĐKD",
  netMargin: "Biên lợi nhuận ròng",
  roe: "ROE (LNST / Vốn chủ)",
  roa: "ROA (LNST / Tổng tài sản)",
  debtToEquity: "Hệ số nợ / Vốn chủ sở hữu",
  currentRatio: "Hệ số thanh toán hiện hành",
  ocfToNi: "OCF / Lợi nhuận sau thuế",
};

const HIDDEN_DUPLICATE_KEYS = new Set(["netProfit"]);

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

function statusVi(s: string | undefined | null): string {
  switch (s) {
    case "VERIFIED":
      return "Đã xác thực";
    case "LATEST_AVAILABLE":
      return "Kỳ gần nhất hiện có";
    case "STALE":
      return "Bản lưu gần nhất";
    case "SOURCE_UNAVAILABLE":
      return "Nguồn không khả dụng";
    case "FRESH":
      return "Mới";
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

function sortColumnsPeriods<T extends { year?: number | null; quarter?: number | null }>(rows: T[]): T[] {
  const rank = (r: T): number => {
    const y = r.year ?? 0;
    return r.quarter == null ? y * 10 + 5 : y * 10 + (r.quarter - 1) * 1.2;
  };
  return [...rows].sort((a, b) => rank(b) - rank(a));
}

export default function StockFinancialsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [tab, setTab] = useState<TabKey>("income");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading, error } = useApi<FinTablePayload>(
    symbol ? financialsApiUrl(symbol) : null,
    { refreshInterval: 300_000, timeoutMs: 55_000 },
  );

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;

  const failNote = (() => {
    if (res && !res.success) {
      const msg = (res as { error?: { message?: string } }).error?.message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "Nguồn báo cáo đang gián đoạn. Thử lại sau hoặc mở link DStock bên dưới.";
  })();

  if (!res?.success || !data?.financials) {
    return (
      <Unavailable title={`Không lấy được BCTC ${symbol || ""}`} note={failNote} />
    );
  }

  const fm = data.packageMeta ?? null;
  const sourceLabel = typeof fm?.primarySource === "string" ? fm.primarySource : "vndirect-fs";
  const fin = data.financials;
  const rawList = fin[tab];
  const rawRows: Record<string, unknown>[] = Array.isArray(rawList)
    ? (rawList.filter((r) => r && typeof r === "object") as Record<string, unknown>[])
    : [];
  const rows = sortColumnsPeriods(
    rawRows as { year?: number | null; quarter?: number | null }[],
  ) as Record<string, unknown>[];

  const metricKeys = Object.keys(rows[0] ?? {}).filter(
    (k) => !META_KEYS.has(k) && !HIDDEN_DUPLICATE_KEYS.has(k) && typeof rows[0]?.[k] === "number",
  );
  const preferred = ORDER[tab].filter((k) => metricKeys.includes(k));
  const rest = metricKeys.filter((k) => !preferred.includes(k));
  const orderedKeys = [...preferred, ...rest].slice(0, 28);

  const periodRows = rows.slice(0, 8);
  const mobilePeriodRows = rows.slice(0, 4);

  return (
    <div className="stock-workspace space-y-3">
      <Panel title="Bảng báo cáo tài chính">
        <div className="stock-fs-tabs mb-3 hidden max-md:grid">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg border text-[11px] font-medium transition-colors ${
                tab === t.key
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-border-subtle text-ink-3 hover:text-ink"
              }`}
            >
              {t.short}
              <span className="mt-0.5 block text-[9px] font-normal opacity-70">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="mb-3 hidden flex-wrap gap-1 md:flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-2.5 py-1 text-[11px] ${
                tab === t.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="stock-fs-meta mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
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
          <>
            <div className="stock-fs-scroll md:hidden">
              <table className="stock-table stock-fs-table w-full text-[11px]">
                <colgroup>
                  <col className="stock-fs-col-metric" />
                  {mobilePeriodRows.map((_, i) => (
                    <col key={i} className="stock-fs-col-period" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th className="stock-fs-sticky bg-bg-2 py-2 pr-2 text-left font-medium">Chỉ tiêu</th>
                    {mobilePeriodRows.map((r, i) => (
                      <th key={i} className="num px-1 py-2 text-right font-medium tabular-nums">
                        {periodHeader(r)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedKeys.map((k) => (
                    <tr key={k} className="border-t border-line/40">
                      <td className="stock-fs-sticky bg-bg-2 py-1.5 pr-2 text-left text-ink-2" title={METRIC_VI[k] ?? k}>
                        {METRIC_VI[k] ?? k}
                      </td>
                      {mobilePeriodRows.map((r, i) => {
                        const val = r[k];
                        const ok = typeof val === "number" && Number.isFinite(val);
                        return (
                          <td key={i} className="num px-1 py-1.5 text-right tabular-nums text-ink-2">
                            {ok ? formatMetricValue(k, val as number) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 4 ? (
              <p className="mt-1.5 text-[10px] text-ink-3 md:hidden">
                Đang hiện 4 kỳ gần nhất · xoay ngang hoặc dùng máy tính để xem thêm cột.
              </p>
            ) : null}

            <div className="stock-fs-scroll hidden md:block">
              <table className="stock-table stock-fs-table w-full table-fixed text-[12px]">
                <colgroup>
                  <col className="stock-fs-col-metric" />
                  {periodRows.map((_, i) => (
                    <col key={i} className="stock-fs-col-period" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th className="stock-fs-sticky bg-bg-2 py-2 pr-3 text-left font-medium">Chỉ tiêu</th>
                    {periodRows.map((r, i) => (
                      <th key={i} className="num px-1.5 py-2 text-right font-medium tabular-nums">
                        {periodHeader(r)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedKeys.map((k) => (
                    <tr key={k} className="border-t border-line/40">
                      <td
                        className="stock-fs-sticky truncate bg-bg-2 py-1.5 pr-3 text-left text-ink-2"
                        title={METRIC_VI[k] ?? k}
                      >
                        {METRIC_VI[k] ?? k}
                      </td>
                      {periodRows.map((r, i) => {
                        const val = r[k];
                        const ok = typeof val === "number" && Number.isFinite(val);
                        return (
                          <td key={i} className="num px-1.5 py-1.5 text-right tabular-nums text-ink-2">
                            {ok ? formatMetricValue(k, val as number) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="stock-fs-hint mt-2 text-[10px] text-ink-3">
          Số tuyệt đối theo VND (api-finfo / DStock). Biên lợi nhuận, ROE, ROA hiển thị %.
        </p>
        {data.notes?.length ? (
          <ul className="mt-2 space-y-0.5 text-[10px] text-ink-3">
            {data.notes.slice(0, 4).map((n, i) => (
              <li key={i}>· {typeof n === "string" ? n : String(n)}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Trạng thái báo cáo">
        <div className="stock-fs-status grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
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
              className="break-all text-accent underline-offset-2 hover:underline"
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
              className="break-all text-accent underline-offset-2 hover:underline"
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
              className="break-all text-accent underline-offset-2 hover:underline"
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

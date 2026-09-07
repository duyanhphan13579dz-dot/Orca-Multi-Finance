"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ChartNoAxesCombined, ExternalLink, Info, Landmark, RefreshCw, Search, X } from "lucide-react";
import { Badge, Chg, FreshnessDot, Loading, Unavailable } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import {
  ECONOMIC_DATASETS,
  ECONOMIC_FREQUENCIES,
  economicChange,
  filterEconomicIndicators,
  normalizeEconomicText,
  type EconomicDataset,
  type EconomicFrequency,
  type EconomicIndicator,
  type EconomicSnapshot,
  type EconomicValue,
} from "@/lib/economic-data";

const HIGHLIGHTS: Record<EconomicDataset, { label: string; match: RegExp }[]> = {
  "macro-economic": [
    { label: "Tăng trưởng GDP (YoY)", match: /^tang truong gdp\b/ },
    { label: "Tăng trưởng CPI (YoY)", match: /^tang truong cpi\b/ },
    { label: "Chỉ số PMI", match: /^pmi\b/ },
    { label: "Cán cân thương mại", match: /^can can thuong mai\b/ },
  ],
  "currency-interest-rate": [
    { label: "Tăng trưởng tín dụng (YoY)", match: /^tang truong tin dung\b/ },
    { label: "Tỷ giá trung tâm", match: /^ty gia trung tam\b/ },
    { label: "Lãi suất liên ngân hàng ON", match: /^lai suat lien ngan hang\b.*\bon\b/ },
    { label: "Huy động 12 tháng · NHTM lớn", match: /^lai suat huy dong 12 thang\b/ },
  ],
};

function SourceValue({ value, className = "" }: { value: EconomicValue; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${value.value == null ? "text-text-muted" : ""} ${className}`} title={value.value == null ? `Nguồn chưa có số liệu hợp lệ (${value.text})` : undefined}>
      {value.value == null ? "—" : value.text}
    </span>
  );
}

function Change({ row }: { row: EconomicIndicator }) {
  const change = economicChange(row);
  if (!change) return <span className="text-text-muted" title="Không đủ số liệu cùng đơn vị để so sánh">—</span>;
  return (
    <span className="whitespace-nowrap" title={change.isPercentagePoint ? "Chênh lệch điểm phần trăm (đpt), không phải phần trăm tăng trưởng" : "Kỳ hiện tại trừ kỳ trước, cùng đơn vị với số liệu nguồn"}>
      <Chg value={change.value} suffix={change.isPercentagePoint ? " đpt" : ""} />
    </span>
  );
}

function Highlights({ rows, dataset }: { rows: EconomicIndicator[]; dataset: EconomicDataset }) {
  const highlights = HIGHLIGHTS[dataset].flatMap((item) => {
    const row = rows.find((r) => item.match.test(normalizeEconomicText(r.name).replace(/_/g, " ")));
    return row ? [{ ...item, row }] : [];
  });
  if (!highlights.length) return null;
  return (
    <section aria-label="Chỉ tiêu nổi bật" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
      {highlights.map(({ label, row }) => (
        <div key={row.id} className="panel min-w-0 overflow-hidden p-4">
          <h2 className="text-[12px] font-medium text-text-secondary" title={row.name}>{label}</h2>
          <div className="mt-2"><SourceValue value={row.current} className="text-[25px] font-semibold tracking-tight" /></div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <Change row={row} />
            <span className="text-text-muted">so với kỳ trước</span>
          </div>
          <div className="mt-3 border-t border-border-subtle pt-2 text-[11px] text-text-secondary">{row.period}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{row.name}</p>
        </div>
      ))}
    </section>
  );
}

export function EconomicDataPage({ dataset }: { dataset: EconomicDataset }) {
  const config = ECONOMIC_DATASETS[dataset];
  const Icon = dataset === "macro-economic" ? ChartNoAxesCombined : Landmark;
  const [query, setQuery] = useState("");
  const [frequency, setFrequency] = useState<EconomicFrequency | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const { data, res, error, isLoading, mutate } = useApi<EconomicSnapshot>(`/api/v1/${dataset}`, { refreshInterval: 5 * 60_000 });
  // useApi intentionally exposes meta only on success; retain error-envelope metadata here,
  // without changing the shared hook's behavior for any other module.
  const meta = res?.meta ?? null;
  const stale = Boolean(data && (meta?.stale || error));
  const filtered = useMemo(() => filterEconomicIndicators(data?.rows ?? [], query, frequency), [data, query, frequency]);
  const frequencies = useMemo(() => ECONOMIC_FREQUENCIES.map((item) => ({
    ...item, count: data?.rows.filter((row) => row.frequency === item.key).length ?? 0,
  })).filter((item) => item.count > 0), [data]);

  async function refresh() {
    setRefreshing(true);
    try {
      await mutate();
    } catch {
      // SWR exposes the network failure through `error`; don't leave an unhandled rejection.
    } finally {
      setRefreshing(false);
    }
  }

  function resetFilters() {
    setQuery("");
    setFrequency("all");
  }

  return (
    <div className="space-y-3">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Dữ liệu kinh tế Việt Nam</p>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Icon className="size-5 text-accent-primary" aria-hidden="true" />{config.title}</h1>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-text-secondary">{config.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[12px] text-text-secondary hover:border-border-default hover:text-accent-primary">
              VietnamBiz Data <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
            <button type="button" onClick={() => void refresh()} disabled={isLoading || refreshing} title="Tải lại bảng dữ liệu; bộ nhớ đệm nguồn tối đa 15 phút" className="inline-flex items-center gap-1.5 rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-3 py-2 text-[12px] text-accent-primary hover:bg-accent-primary/15 disabled:cursor-wait disabled:opacity-60">
              <RefreshCw className={`size-3.5 ${refreshing || isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              {refreshing ? "Đang tải…" : "Làm mới"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-4 py-2.5">
          <nav aria-label="Trang dữ liệu kinh tế" className="flex flex-wrap gap-1.5">
            {(Object.keys(ECONOMIC_DATASETS) as EconomicDataset[]).map((key) => (
              <Link key={key} href={`/${key}`} aria-current={dataset === key ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${dataset === key ? "bg-accent-primary/12 text-accent-primary" : "text-text-secondary hover:bg-surface-elevated"}`}>
                {ECONOMIC_DATASETS[key].title}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-[10px] text-text-muted sm:ml-auto" aria-live="polite">
            {isLoading && !data ? <span>Đang kết nối nguồn…</span> : <><span>Đồng bộ nguồn</span><FreshnessDot status={stale ? "STALE" : meta?.freshness} />{meta?.cached && <Badge>Bản lưu</Badge>}</>}
          </div>
        </div>
      </section>

      {stale && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-[12px] leading-relaxed text-text-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>Đang hiển thị bản lưu gần nhất vì chưa lấy được bản mới. Vui lòng kiểm tra thời điểm lấy dữ liệu và kỳ công bố bên dưới; đây không phải dữ liệu trực tiếp.</p>
        </div>
      )}
      {data && data.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[12px] leading-relaxed text-text-secondary">
          <p className="font-medium text-warning">Dữ liệu nguồn chưa đầy đủ</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}

      {isLoading && !data ? (
        <div role="status" aria-label="Đang tải bảng dữ liệu" className="panel p-4"><span className="sr-only">Đang tải bảng dữ liệu</span><Loading rows={7} /></div>
      ) : !data ? (
        <Unavailable title={`Chưa có dữ liệu ${config.title.toLowerCase()}`} note={res && !res.success ? res.error.message : "Không kết nối được nguồn dữ liệu. Bạn có thể bấm Làm mới để thử lại hoặc mở VietnamBiz Data. Hệ thống không thay thế bằng dữ liệu giả."} meta={meta} />
      ) : (
        <>
          <Highlights rows={data.rows} dataset={dataset} />
          <section className="panel overflow-hidden" aria-label="Bảng chỉ tiêu kinh tế">
            <div className="border-b border-border-subtle p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><h2 className="text-[14px] font-semibold">Bảng chỉ tiêu</h2><Badge>{data.rows.length} chỉ tiêu</Badge></div>
                <div className="relative w-full sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={config.searchPlaceholder} aria-label="Tìm kiếm chỉ tiêu" className="w-full rounded-lg border border-border-subtle bg-surface-elevated py-2 pl-9 pr-9 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/15 [&::-webkit-search-cancel-button]:appearance-none" />
                  {query && <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary"><X className="size-3.5" /></button>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Lọc theo kỳ công bố">
                <span className="mr-1 text-[11px] text-text-muted">Kỳ công bố</span>
                {[{ key: "all" as const, label: "Tất cả", count: data.rows.length }, ...frequencies].map((item) => (
                  <button key={item.key} type="button" onClick={() => setFrequency(item.key)} aria-pressed={frequency === item.key} className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${frequency === item.key ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary" : "border-border-subtle text-text-secondary hover:border-border-default"}`}>
                    {item.label}<span className="num ml-1.5 opacity-65">{item.count}</span>
                  </button>
                ))}
                <span className="text-[11px] text-text-muted sm:ml-auto" aria-live="polite">Hiển thị {filtered.length}/{data.rows.length} chỉ tiêu</span>
              </div>
            </div>

            {!filtered.length ? (
              <div className="px-4 py-10 text-center" role="status">
                <p className="text-[13px] text-text-secondary">Không tìm thấy chỉ tiêu phù hợp.</p>
                <button type="button" onClick={resetFilters} className="mt-3 rounded-md border border-border-default px-3 py-1.5 text-[12px] text-accent-primary hover:bg-surface-elevated">Xóa bộ lọc</button>
              </div>
            ) : (
              <div role="region" aria-label="Bảng dữ liệu, có thể cuộn ngang" tabIndex={0} className="overflow-x-auto">
                <table className={`w-full border-collapse text-left text-[12px] ${config.hasReleaseSchedule ? "min-w-[980px]" : "min-w-[760px]"}`}>
                  <caption className="sr-only">{config.title} từ VietnamBiz Data: kỳ hiện tại, kỳ trước và chênh lệch.</caption>
                  <thead className="bg-surface-elevated text-[11px] text-text-secondary">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">Chỉ tiêu</th>
                      <th scope="col" className="px-4 py-3 font-medium">Kỳ công bố</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Kỳ hiện tại</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Kỳ trước</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Chênh lệch</th>
                      {config.hasReleaseSchedule && <th scope="col" className="px-4 py-3 font-medium">Ngày công bố tiếp theo</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id} className="row-hover border-t border-border-subtle even:bg-surface-elevated/25">
                        <th scope="row" className="min-w-[210px] max-w-[310px] px-4 py-3 text-[12.5px] font-medium leading-relaxed">{row.name}</th>
                        <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.period}</td>
                        <td className="px-4 py-3 text-right font-semibold"><SourceValue value={row.current} /></td>
                        <td className="px-4 py-3 text-right text-text-secondary"><SourceValue value={row.previous} /></td>
                        <td className="px-4 py-3 text-right"><Change row={row} /></td>
                        {config.hasReleaseSchedule && <td className="min-w-[200px] max-w-[260px] px-4 py-3 text-[11px] leading-relaxed text-text-muted">{row.nextRelease || "Chưa công bố"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-border-subtle px-4 py-2.5 text-[10.5px] leading-relaxed text-text-muted">
              <span className="mr-2 lg:hidden">Cuộn ngang để xem đầy đủ bảng.</span>
              Chênh lệch = kỳ hiện tại − kỳ trước. Chỉ tiêu % dùng điểm phần trăm (đpt); chỉ tiêu khác giữ nguyên đơn vị nguồn. Màu chỉ thể hiện tăng/giảm, không đánh giá tốt/xấu.
            </div>
          </section>
        </>
      )}

      <section className="panel p-4" aria-label="Thông tin nguồn dữ liệu">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-accent-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-2 text-[11px] leading-relaxed text-text-muted">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-text-secondary">
              <span>Nguồn: <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">data.vietnambiz.vn/{dataset}</a></span>
              {data && <span>Lấy dữ liệu lúc: <time dateTime={data.fetchedAt}>{new Date(data.fetchedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}</time> (giờ Việt Nam)</span>}
            </div>
            <p>Trạng thái FRESH/STALE phản ánh lần đồng bộ nguồn, không phải kỳ số liệu. Mỗi chỉ tiêu có lịch công bố riêng; không gán nhãn LIVE cho dữ liệu định kỳ. Bộ nhớ đệm nguồn tối đa 15 phút; khi nguồn lỗi, bản hợp lệ gần nhất có thể được giữ tối đa 24 giờ và gắn nhãn STALE.</p>
            <p>Số liệu và cách ghi đơn vị được giữ theo nguồn. {config.hasReleaseSchedule ? "Lịch công bố là mô tả từ VietnamBiz, không phải ngày dự báo do ORCA tự tính." : "Nguồn không cung cấp lịch công bố tiếp theo cho bảng lãi suất tiền tệ."}</p>
            <p className="border-t border-border-subtle pt-2">Dữ liệu thuộc bản quyền CTCP WiGroup · Xem chi tiết tại <a href="https://wichart.vn/" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">WiChart.vn</a> · Nguồn dữ liệu <a href="https://www.wigroup.vn/san-pham/wifeed" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">WiFeed.vn</a>.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

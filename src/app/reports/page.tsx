"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import { StockReportSection } from "@/components/stock-report";
import { OrcaMark } from "@/components/logo";
import type { DailyReport, ReportListItem } from "@/lib/services/report-engine";
import type { ApiResponse } from "@/lib/types";
import { Badge, FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
import { BookOpenText, History, Play, Printer } from "lucide-react";
import { printDailyReport } from "@/lib/report-print";
import { ReportVnIndexWeeklyChart } from "@/components/report-vnindex-weekly-chart";

type Tab = "morning_brief" | "intraday_brief" | "market_summary" | "strategy" | "company";

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: "morning_brief", label: "Morning Brief", desc: "Trước giờ mở cửa" },
  { id: "intraday_brief", label: "Intraday Brief", desc: "Cập nhật giữa phiên" },
  { id: "market_summary", label: "Market Summary", desc: "Sau giờ đóng cửa" },
  { id: "strategy", label: "Weekly Strategy", desc: "Chiến lược tuần · tự chấm điểm" },
  { id: "company", label: "Company Reports", desc: "On-demand theo mã" },
];

export default function ReportCenterPage() {
  const [tab, setTab] = useState<Tab>("morning_brief");
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <OrcaMark size={34} />
          <div>
            <h1 className="text-lg font-semibold">ORCA Report Center</h1>
            <p className="text-[12px] text-text-muted">
              Vietnam-first market & financial intelligence — dựng từ dữ liệu đã xác minh, có traceability đầy đủ.
            </p>
          </div>
          <div className="ml-auto flex max-w-full gap-1 overflow-x-auto pb-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                  tab === t.id
                    ? "bg-accent-primary/15 text-accent-primary"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>
      {tab === "company" ? <StockReportSection /> : <DailyReportView type={tab} />}
    </div>
  );
}

function DailyReportView({ type }: { type: Exclude<Tab, "company"> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<DailyReport | null>(null);
  const [meta, setMeta] = useState<import("@/lib/types").Meta | null>(null);
  const firstLoad = useRef(true);
  const { data: history, mutate: reloadHistory } = useApi<{ items: ReportListItem[] }>(
    `/api/v1/reports?type=${type}&limit=7`,
    { refreshInterval: 120_000 },
  );

  useEffect(() => {
    setCurrent(null);
    setError(null);
    firstLoad.current = true;
  }, [type]);

  useEffect(() => {
    if (firstLoad.current && history?.items.length && !current) {
      firstLoad.current = false;
      void loadById(history.items[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  async function loadById(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = (await fetch(`/api/v1/reports/${id}`).then((r) => r.json())) as ApiResponse<DailyReport>;
      if (!res.success) throw new Error(res.error?.message ?? "load failed");
      setCurrent(res.data);
      setMeta(res.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = (await fetch(`/api/v1/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      }).then((r) => r.json())) as ApiResponse<DailyReport>;
      if (!res.success) throw new Error(res.error?.message ?? "generate failed");
      setCurrent(res.data);
      setMeta(res.meta ?? null);
      void reloadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setBusy(false);
    }
  }

  function exportPdf() {
    if (!current) return;
    printDailyReport(current);
  }

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel
        className="col-span-12 max-h-[70dvh] overflow-y-auto lg:col-span-3"
        title={
          <span className="flex items-center gap-1.5">
            <History className="size-3.5" /> Lịch sử {TABS.find((t) => t.id === type)?.label}
          </span>
        }
        pad={false}
      >
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="m-2 flex w-[calc(100%-1rem)] items-center justify-center gap-1.5 rounded-md bg-accent-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
        >
          <Play className="size-3.5" /> {busy ? "Đang dựng báo cáo…" : "Tạo báo cáo mới"}
        </button>
        <ul className="divide-y divide-border-subtle">
          {(history?.items ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void loadById(r.id)}
                className="w-full px-3 py-2.5 text-left hover:bg-surface-elevated"
              >
                <div className="text-[10px] text-text-muted">
                  {new Date(r.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[12px] text-text-primary">{r.title}</div>
              </button>
            </li>
          ))}
          {!history?.items.length && (
            <li className="px-3 py-3 text-[11.5px] text-text-muted">
              Chưa có bản nào trong kho — bấm “Tạo báo cáo mới”. Scheduler khuyến nghị Chủ Nhật
              18:00–20:00 VN (Weekly Strategy) hoặc 08:15 / 15:45 các ngày trong tuần khi bật.
            </li>
          )}
          {history?.items.length ? (
            <li className="border-t border-border-subtle px-3 py-2 text-[10px] text-text-muted">
              {history.items.length}/7 bản · tạo bản thứ 8 sẽ xóa hết lịch sử loại này và chỉ giữ bản mới.
            </li>
          ) : null}
        </ul>
      </Panel>

      <div className="col-span-12 lg:col-span-9">
        {busy && <Loading rows={10} />}
        {error && !busy && <Unavailable title="Không tạo được báo cáo" note={error} />}
        {current && !busy && <ReportView report={current} meta={meta} onExportPdf={exportPdf} />}
        {!current && !busy && !error && (
          <Unavailable
            title="Chọn hoặc tạo một báo cáo"
            note="Báo cáo được dựng từ dữ liệu thị trường đã xác minh tại thời điểm phát hành (freshness gate) — không dùng dữ liệu cũ che giấu."
          />
        )}
      </div>
    </div>
  );
}

function isWeekOverviewHeading(heading: string): boolean {
  return /tổng quan diễn biến tuần/i.test(heading);
}

function ReportView({
  report,
  meta,
  onExportPdf,
}: {
  report: DailyReport;
  meta: import("@/lib/types").Meta | null;
  onExportPdf: () => void;
}) {
  return (
    <article className="panel p-5 pb-4">
      <div>
        <div className="hd flex items-center gap-3 border-b border-line pb-3">
          <OrcaMark size={44} />
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold leading-tight">{report.title}</h2>
            <p className="text-[12px] text-text-muted">{report.subtitle}</p>
          </div>
          <span className="bd ml-auto shrink-0 text-[9.5px] tracking-[0.2em] text-accent-primary">
            ORCA RESEARCH
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <span>
            Phát hành:{" "}
            {new Date(report.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
          </span>
          {report.marketDataTimestamp && (
            <span>
              · Dữ liệu đến:{" "}
              {new Date(report.marketDataTimestamp).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </span>
          )}
          <span className="flex items-center gap-1">
            <BookOpenText className="size-3" /> {report.type.replace(/_/g, " ")}
          </span>
          {meta && <FreshnessDot status={meta.freshness} ageMs={null} />}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.entries(report.freshness).map(([k, v]) => (
            <Badge
              key={k}
              tone={v === "LIVE" || v === "FRESH" ? "up" : v === "UNAVAILABLE" ? "down" : "warn"}
            >
              {k}: {v}
            </Badge>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          {report.sections.map((s) => (
            <section key={s.heading}>
              <h3
                className={`text-[13px] font-semibold ${
                  s.tone === "up"
                    ? "text-up"
                    : s.tone === "down"
                      ? "text-down"
                      : "text-text-primary"
                }`}
              >
                {s.heading}
              </h3>
              <div className="mt-1.5 space-y-1.5 text-[12.5px] leading-relaxed text-text-secondary">
                {s.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              {report.type === "strategy" && isWeekOverviewHeading(s.heading) && (
                <ReportVnIndexWeeklyChart height={280} limit={120} />
              )}
            </section>
          ))}
        </div>

        {report.scenarios?.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[13px] font-semibold">Kịch bản Base / Bull / Bear</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {report.scenarios.map((sc) => (
                <div key={sc.label} className="rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold">{sc.label}</span>
                    <span className="text-[10px] text-text-muted">{sc.probabilityRange}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-text-secondary">{sc.drivers}</p>
                  <p className="mt-1 text-[11px] text-text-muted">{sc.indexZones}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onExportPdf}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <Printer className="size-3.5" /> Xuất PDF
        </button>
      </div>
    </article>
  );
}

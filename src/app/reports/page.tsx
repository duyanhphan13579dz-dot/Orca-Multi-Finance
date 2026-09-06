"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import { StockReportSection } from "@/components/stock-report";
import { OrcaMark } from "@/components/logo";
import type { DailyReport, ReportListItem } from "@/lib/services/report-engine";
import type { ApiResponse } from "@/lib/types";
import { Badge, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { BookOpenText, FileText, History, Play, Printer } from "lucide-react";

/**
 * ORCA REPORT CENTER — Vietnam-first financial intelligence reports.
 * Morning Brief (chuẩn bị phiên) · Market Summary (giải mã phiên) ·
 * Strategy (market view + scenarios) · Company Reports (on-demand).
 */

type Tab = "morning_brief" | "market_summary" | "strategy" | "company";

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: "morning_brief", label: "Morning Brief", desc: "Trước giờ mở cửa" },
  { id: "market_summary", label: "Market Summary", desc: "Sau giờ đóng cửa" },
  { id: "strategy", label: "Vietnam Strategy", desc: "Market view & kịch bản" },
  { id: "company", label: "Company Reports", desc: "On-demand theo mã" },
];

export default function ReportCenterPage() {
  const [tab, setTab] = useState<Tab>("morning_brief");
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <OrcaMark size={34} />
          <div>
            <h1 className="text-lg font-semibold">ORCA Report Center</h1>
            <p className="text-[12px] text-text-muted">Vietnam-first market & financial intelligence — dựng từ dữ liệu đã xác minh, có traceability đầy đủ.</p>
          </div>
          <div className="ml-auto flex gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 text-[12px] transition-colors ${tab === t.id ? "bg-accent-primary/15 text-accent-primary" : "text-text-muted hover:text-text-primary"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>
      {tab === "company" ? (
        <StockReportSection />
      ) : (
        <DailyReportView type={tab} />
      )}
    </div>
  );
}

/* ------------------------------ daily reports ------------------------------ */

function DailyReportView({ type }: { type: Exclude<Tab, "company"> }) {
  const [current, setCurrent] = useState<DailyReport | null>(null);
  const [meta, setMeta] = useState<DailyReport["generatedAt"] extends string ? import("@/lib/types").Meta | null : never>(null as never);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: history, mutate: reloadHistory } = useApi<{ items: ReportListItem[] }>(`/api/v1/reports?type=${type}&limit=20`, { refreshInterval: 120_000 });
  const firstLoad = useRef(true);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) });
      const json = (await res.json()) as ApiResponse<DailyReport>;
      if (json.success) {
        setCurrent(json.data);
        setMeta(json.meta ?? null);
        void reloadHistory();
      } else setError(json.error.message);
    } finally {
      setBusy(false);
    }
  };

  const loadById = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/reports/${id}`);
      const json = (await res.json()) as ApiResponse<DailyReport>;
      if (json.success) setCurrent(json.data);
      else setError(json.error.message);
    } finally {
      setBusy(false);
    }
  };

  // auto-load latest from history on first mount
  useEffect(() => {
    if (firstLoad.current && history?.items.length && !current) {
      void loadById(history.items[0].id);
    }
    firstLoad.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const print = () => {
    const el = document.getElementById("report-print-area");
    if (!el) return;
    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) return;
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${current?.title ?? "ORCA Report"}</title><style>
      body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0c1a33;margin:32px;line-height:1.65;font-size:13px}
      .hd{display:flex;align-items:center;gap:14px;border-bottom:3px solid #123;padding-bottom:14px;margin-bottom:18px}
      .hd h1{font-size:19px;margin:0;color:#0c1a33}
      .hd p{margin:2px 0 0;color:#5a6b8c;font-size:11.5px}
      .bd{border:1px solid #ccd;border-radius:8px;padding:3px 12px;font-size:10px;color:#134078;font-weight:700;letter-spacing:.12em}
      h2{font-size:13.5px;color:#123f7c;margin:18px 0 6px;border-left:3px solid #123f7c;padding-left:8px}
      p{margin:6px 0;font-size:12.8px}
      .scen{display:table;border-collapse:collapse;width:100%;margin:10px 0}
      .scen>div{display:table-cell;border:1px solid #ccd;padding:10px;width:33%;vertical-align:top}
      .scen b{display:block;font-size:11px;letter-spacing:.08em;margin-bottom:4px}
      .scen span{font-size:10.5px;color:#5a6b8c;display:block}
      .assump{font-size:10.5px;color:#5a6b8c;border-top:1px dashed #ccd;margin-top:16px;padding-top:8px}
      .foot{margin-top:24px;text-align:center;font-size:10px;color:#5a6b8c}
      img{width:44px;height:44px;border-radius:10px}
      @media print{body{margin:12mm}}
    </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  };

  return (
    <div className="grid grid-cols-12 gap-3">
      {/* history */}
      <Panel className="col-span-12 max-h-[70dvh] overflow-y-auto lg:col-span-3" title={<span className="flex items-center gap-1.5"><History className="size-3.5" /> Lịch sử {TABS.find((t) => t.id === type)?.label}</span>} pad={false}>
        <button onClick={generate} disabled={busy} className="m-2 mb-1 flex w-[calc(100%-16px)] items-center justify-center gap-1.5 rounded-md bg-accent-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60">
          <Play className="size-3.5" /> {busy ? "Đang dựng báo cáo…" : "Tạo báo cáo mới"}
        </button>
        <ul className="divide-y divide-border-subtle/60">
          {(history?.items ?? []).map((r) => (
            <li key={r.id}>
              <button onClick={() => loadById(r.id)} className={`block w-full px-3 py-2 text-left hover:bg-surface-elevated ${current?.generatedAt === r.generatedAt ? "bg-accent-primary/8" : ""}`}>
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <FileText className="size-3" />
                  {new Date(r.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[12px] text-text-primary">{r.title}</div>
              </button>
            </li>
          ))}
          {!history?.items.length && <li className="px-3 py-3 text-[11.5px] text-text-muted">Chưa có bản nào trong kho — bấm “Tạo báo cáo mới”. Scheduler tự chạy 08:15 / 15:45 các ngày trong tuần khi bật.</li>}
        </ul>
      </Panel>

      {/* report body */}
      <div className="col-span-12 lg:col-span-9">
        {busy && <Loading rows={10} />}
        {error && !busy && <Unavailable title="Không tạo được báo cáo" note={error} />}
        {current && !busy && <ReportView report={current} meta={meta} onPrint={print} />}
        {!current && !busy && !error && (
          <Unavailable title="Chọn hoặc tạo một báo cáo" note="Báo cáo được dựng từ dữ liệu thị trường đã xác minh tại thờ điểm phát hành (freshness gate) — không dùng dữ liệu cũ che giấu." />
        )}
      </div>
    </div>
  );
}

function ReportView({ report, meta, onPrint }: { report: DailyReport; meta: import("@/lib/types").Meta | null; onPrint: () => void }) {
  return (
    <article className="panel p-5 pb-4 print:shadow-none">
      {/* report header */}
      <div id="report-print-area">
        <div className="hd flex items-center gap-3 border-b border-line pb-3">
          <img src="/brand/orca-mark.svg" alt="ORCA" className="size-11 rounded-lg" />
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold leading-tight">{report.title}</h2>
            <p className="text-[12px] text-text-muted">{report.subtitle}</p>
          </div>
          <span className="bd ml-auto shrink-0 text-[9.5px] tracking-[0.2em] text-accent-primary">ORCA RESEARCH</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <span>Phát hành: {new Date(report.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
          {report.marketDataTimestamp && <span>· Dữ liệu đến: {new Date(report.marketDataTimestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>}
          <span className="flex items-center gap-1"><BookOpenText className="size-3" /> {report.type.replace(/_/g, " ")}</span>
          {meta && <FreshnessDot status={meta.freshness} ageMs={null} />}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.entries(report.freshness).map(([k, v]) => (
            <Badge key={k} tone={v === "LIVE" || v === "FRESH" ? "up" : v === "UNAVAILABLE" ? "down" : "warn"}>{k}: {v}</Badge>
          ))}
        </div>

        {/* sections */}
        <div className="mt-4 space-y-4">
          {report.sections.map((s, i) => (
            <section key={i}>
              <h2 className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold">
                <span className={`size-1.5 rounded-full ${s.tone === "up" ? "bg-up" : s.tone === "down" ? "bg-down" : "bg-warn"}`} />
                {s.heading}
              </h2>
              <div className="space-y-2 text-[13.5px] leading-[1.8] text-ink-2">
                {s.paragraphs.filter(Boolean).map((p, j) => <p key={j}>{p}</p>)}
              </div>
            </section>
          ))}

          {/* scenarios */}
          <section>
            <h2 className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold">
              <span className="size-1.5 rounded-full bg-accent-primary" /> Kịch bản thị trường (Base / Bull / Bear)
            </h2>
            <div className="scen grid gap-2 md:grid-cols-3">
              {report.scenarios.map((sc) => (
                <div key={sc.label} className="panel-inset p-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-[12px] font-bold tracking-wide ${sc.label === "Bull" ? "text-up" : sc.label === "Bear" ? "text-down" : "text-text-primary"}`}>{sc.label.toUpperCase()}</span>
                    <span className="num text-[11px] text-text-muted">{sc.probabilityRange}</span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-text-secondary"><b>Drivers:</b> {sc.drivers}</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary"><b>Vùng kỹ thuật:</b> {sc.indexZones}</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary"><b>Ngành:</b> {sc.sectorImpact}</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-warn/90"><b>Rủi ro:</b> {sc.risks}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* assumptions / traceability */}
        <footer className="assump mt-5 border-t border-dashed border-line pt-3 text-[10.5px] leading-relaxed text-text-muted">
          <b className="text-text-secondary">Assumptions & data traceability:</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {report.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          <div className="foot mt-3 text-center text-[10px] text-text-muted">
            ORCA Financial — Generated from verified market data · không phải khuyến nghị đầu tư
          </div>
        </footer>
      </div>

      {/* actions + meta */}
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        {meta ? <MetaLine meta={meta} /> : <span />}
        <button onClick={onPrint} className="flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:border-accent-primary/50 hover:text-accent-primary">
          <Printer className="size-4" /> Xuất PDF / In báo cáo
        </button>
      </div>
    </article>
  );
}

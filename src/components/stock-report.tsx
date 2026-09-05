"use client";

import { useState } from "react";
import type { StockReport } from "@/lib/services/intelligence";
import type { ApiResponse } from "@/lib/types";
import { Badge, FreshnessDot, Loading, MetaLine, Panel } from "@/components/ui";
import { Calculator, FileSearch, Lightbulb, Newspaper, Route } from "lucide-react";

/**
 * STOCK REPORT view — FACT / CALCULATION / INTERPRETATION / SCENARIO blocks.
 * Feeds from /api/v1/reports/stock/[symbol] (intelligence pipeline).
 */
export function StockReportSection() {
  const [symbol, setSymbol] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [report, setReport] = useState<StockReport | null>(null);
  const [meta, setMeta] = useState<ApiResponse<StockReport>["meta"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    setError(null);
    setActive(s);
    try {
      const res = await fetch(`/api/v1/reports/stock/${encodeURIComponent(s)}`);
      const json = (await res.json()) as ApiResponse<StockReport>;
      if (json.success) {
        setReport(json.data);
        setMeta(json.meta ?? null);
      } else {
        setReport(null);
        setError(json.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      className="mx-auto max-w-3xl"
      pad={false}
      title={
        <span className="flex items-center gap-2">
          <FileSearch className="size-4 text-accent-primary" /> Stock Report (Intelligence Engine)
        </span>
      }
    >
      <div className="p-4">
        <p className="text-[12px] text-text-muted">
          Pipeline: fetch mới nhất → validate → Financial Health → Valuation → Market State → Risk → Structured Contract → High-level LLM (có output validation chống hallucination). Phân biệt rõ FACT với INTERPRETATION.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(symbol)}
            placeholder="HPG, VCB, FPT…"
            className="num flex-1 rounded-md border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] uppercase text-text-primary placeholder:normal-case focus:border-accent-primary/50 focus:outline-none"
          />
          <button onClick={() => run(symbol)} disabled={busy || !symbol.trim()} className="rounded-md bg-accent-primary px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy ? "Đang phân tích…" : "Tạo report"}
          </button>
        </div>
        {busy && <div className="mt-4"><Loading rows={6} /></div>}
        {error && !busy && (
          <p className="mt-3 rounded-lg border border-dashed border-border-default bg-surface-elevated p-3 text-[12px] text-text-secondary">
            {error} — hệ thống giữ nguyên nguyên tắc: không có dữ liệu thật thì không tạo report.
          </p>
        )}
        {report && !busy && active && <ReportView report={report} meta={meta} />}
      </div>
    </Panel>
  );
}

function ReportView({ report, meta }: { report: StockReport; meta: ApiResponse<StockReport>["meta"] | null }) {
  return (
    <div className="mt-4 space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-text-primary">{report.title}</h2>
        <Badge tone={report.confidence === "HIGH" ? "up" : report.confidence === "MEDIUM" ? "warn" : "down"}>Confidence {report.confidence}</Badge>
        <Badge tone={report.dataQuality === "HIGH" ? "up" : report.dataQuality === "MEDIUM" ? "warn" : "down"}>Data quality {report.dataQuality}</Badge>
        <Badge tone="accent">{report.mode === "llm-assisted" ? `LLM-assisted${report.model ? ` · ${report.model}` : ""}` : "Deterministic engine"}</Badge>
        {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
      </div>
      {meta?.outputValidation && (
        <p className="text-[10.5px] text-text-muted">
          Output validation: {meta.outputValidation.validated ? "đã kiểm chứng — mọi số liệu trace về nguồn" : `phát hiện ${meta.outputValidation.unsupportedClaims} claim không trace được → engine đã fallback deterministic`}
          {meta.outputValidation.recovered ? ` (${meta.outputValidation.recovered})` : ""}
        </p>
      )}
      <Block icon={<Newspaper className="size-4" />} title="FACT — Dữ liệu nguồn" items={report.sections.fact} tone="text-text-secondary" />
      <Block icon={<Calculator className="size-4" />} title="CALCULATION — Engine tính toán" items={report.sections.calculation} tone="text-text-secondary" />
      <Block icon={<Lightbulb className="size-4" />} title="INTERPRETATION — Diễn giải" items={report.sections.interpretation} prose tone="text-text-primary" />
      <Block icon={<Route className="size-4" />} title="SCENARIO — Kịch bản" items={report.sections.scenario} prose tone="text-text-secondary" />
      <div className="flex items-center justify-between gap-2 pt-1 text-[10.5px] text-text-muted">
        <span>Tạo lúc {new Date(report.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
        {meta && <MetaLine meta={meta} />}
      </div>
    </div>
  );
}

function Block({ icon, title, items, prose, tone }: { icon: React.ReactNode; title: string; items: string[]; prose?: boolean; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="panel-inset p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-primary">
        {icon} {title}
      </div>
      {prose ? (
        <div className={`space-y-2 text-[13px] leading-[1.75] ${tone}`}>
          {items.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <ul className="space-y-1 text-[12.5px] leading-relaxed">
          {items.map((p, i) => <li key={i} className={tone}>▸ {p}</li>)}
        </ul>
      )}
    </div>
  );
}

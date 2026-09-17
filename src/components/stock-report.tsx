"use client";

import { useMemo, useState } from "react";
import type { CompanyAnalysisReport, ChartPoint } from "@/lib/services/company-analysis-report";
import type { ApiResponse } from "@/lib/types";
import { Badge, FreshnessDot, Loading, MetaLine, Panel } from "@/components/ui";
import {
  Building2,
  Factory,
  FileSearch,
  GitBranch,
  LineChart,
  Printer,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Globe2,
  Scale,
  Landmark,
} from "lucide-react";

export function StockReportSection() {
  const [symbol, setSymbol] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [report, setReport] = useState<CompanyAnalysisReport | null>(null);
  const [meta, setMeta] = useState<ApiResponse<CompanyAnalysisReport>["meta"] | null>(null);
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
      const json = (await res.json()) as ApiResponse<CompanyAnalysisReport>;
      if (json.success) {
        setReport(json.data);
        setMeta(json.meta ?? null);
      } else {
        setReport(null);
        setError(json.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi mạng");
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      className="mx-auto max-w-4xl"
      pad={false}
      title={
        <span className="flex items-center gap-2">
          <FileSearch className="size-4 text-accent-primary" /> Company Report — Báo cáo phân tích DN
        </span>
      }
      right={
        report && !busy ? (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary print:hidden"
          >
            <Printer className="size-3.5" /> Xuất PDF / In
          </button>
        ) : null
      }
    >
      <div className="p-4">
        <p className="text-[12px] text-text-muted print:hidden">
          Báo cáo chi tiết: hồ sơ · moat · ngành · chuỗi giá trị · KQKD · kỹ thuật (có chart) · định giá · dự phóng ·
          catalyst · risk · so sánh ngành · vĩ mô · nhận định. Dữ liệu VNDirect + pipeline ORCA.
        </p>
        <div className="mt-3 flex gap-2 print:hidden">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(symbol)}
            placeholder="HPG, VCB, FPT, TCX…"
            className="num flex-1 rounded-md border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] uppercase text-text-primary placeholder:normal-case focus:border-accent-primary/50 focus:outline-none"
          />
          <button
            onClick={() => void run(symbol)}
            disabled={busy || !symbol.trim()}
            className="rounded-md bg-accent-primary px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Đang dựng báo cáo…" : "Tạo báo cáo"}
          </button>
        </div>
        {busy && (
          <div className="mt-4">
            <Loading rows={8} />
          </div>
        )}
        {error && !busy && (
          <p className="mt-3 rounded-lg border border-dashed border-border-default bg-surface-elevated p-3 text-[12px] text-text-secondary">
            {error}
          </p>
        )}
        {report && !busy && active && (
          <div className="company-report-print mt-4 space-y-3 border-t border-border-subtle pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-text-primary">{report.title}</h2>
              <Badge tone={report.dataQuality === "HIGH" ? "up" : report.dataQuality === "MEDIUM" ? "warn" : "down"}>
                Data {report.dataQuality}
              </Badge>
              {report.floor && <Badge tone="accent">{report.floor}</Badge>}
              {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
            </div>

            <Sec icon={<Building2 className="size-4" />} title="1. Giới thiệu doanh nghiệp" lines={report.sections.intro} />
            <Sec icon={<ShieldAlert className="size-4" />} title="2. Moat / lợi thế cạnh tranh" lines={report.sections.moat} />
            <Sec icon={<Factory className="size-4" />} title="3. Ngành hoạt động" lines={report.sections.industry} />
            <ValueChainBlock vc={report.sections.valueChain} />
            <Sec icon={<Landmark className="size-4" />} title="5. Kết quả kinh doanh" lines={report.sections.businessResults} />
            <Sec icon={<LineChart className="size-4" />} title="6. Phân tích kỹ thuật" lines={report.sections.technical}>
              <PriceLineChart series={report.sections.priceSeries} symbol={report.symbol} />
            </Sec>
            <Sec icon={<Scale className="size-4" />} title="7. Định giá" lines={report.sections.valuation} />
            <Sec icon={<TrendingUp className="size-4" />} title="8. Dự phóng KQKD & định giá" lines={report.sections.projection} />
            <Sec icon={<Sparkles className="size-4" />} title="9. Catalyst tăng trưởng" lines={report.sections.catalysts} />
            <Sec icon={<Target className="size-4" />} title="10. Rủi ro doanh nghiệp" lines={report.sections.risks} />
            <Sec icon={<GitBranch className="size-4" />} title="11. Tiềm năng so với ngành" lines={report.sections.vsIndustry} />
            <Sec icon={<Globe2 className="size-4" />} title="12. Yếu tố vĩ mô" lines={report.sections.macro} />
            <Sec icon={<FileSearch className="size-4" />} title="13. Nhận xét đánh giá chung" lines={report.sections.overall} />

            <div className="flex items-center justify-between gap-2 pt-2 text-[10.5px] text-text-muted">
              <span>
                Tạo lúc{" "}
                {new Date(report.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
              </span>
              {meta && <MetaLine meta={meta} />}
            </div>
            <p className="text-[10px] text-text-muted">
              ORCA Multi-Finance — báo cáo nghiên cứu, không phải khuyến nghị đầu tư.
            </p>
          </div>
        )}
      </div>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .company-report-print,
          .company-report-print * {
            visibility: visible;
          }
          .company-report-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 16px;
            background: #fff !important;
            color: #111 !important;
          }
        }
      `}</style>
    </Panel>
  );
}

function Sec({
  icon,
  title,
  lines,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  children?: React.ReactNode;
}) {
  if (!lines?.length && !children) return null;
  return (
    <div className="rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
        {icon} {title}
      </div>
      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-text-secondary">
        {lines.map((line, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {renderBold(line)}
          </p>
        ))}
      </div>
      {children}
    </div>
  );
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-text-primary">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function ValueChainBlock({
  vc,
}: {
  vc: { input: string[]; process: string[]; output: string[] } | null;
}) {
  if (!vc) {
    return (
      <Sec
        icon={<GitBranch className="size-4" />}
        title="4. Chuỗi giá trị (Input → Process → Output)"
        lines={["Chưa suy được chuỗi giá trị từ hồ sơ/ngành."]}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
        <GitBranch className="size-4" /> 4. Chuỗi giá trị (Input → Process → Output)
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Input", items: vc.input },
          { label: "Process", items: vc.process },
          { label: "Output", items: vc.output },
        ].map((col) => (
          <div key={col.label} className="rounded-md border border-border-subtle/60 p-2">
            <div className="text-[10px] font-semibold uppercase text-text-muted">{col.label}</div>
            <ul className="mt-1 space-y-0.5 text-[12px] text-text-secondary">
              {(col.items?.length ? col.items : ["—"]).map((x, i) => (
                <li key={i}>• {x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceLineChart({ series, symbol }: { series: ChartPoint[]; symbol: string }) {
  const path = useMemo(() => {
    if (!series?.length) return null;
    const w = 640;
    const h = 180;
    const pad = 12;
    const ys = series.map((p) => p.c);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const pts = series.map((p, i) => {
      const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p.c - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      d: `M ${pts.join(" L ")}`,
      w,
      h,
      min,
      max,
      first: series[0],
      last: series[series.length - 1],
    };
  }, [series]);

  if (!path) {
    return <p className="mt-2 text-[11px] text-text-muted">Không có chuỗi giá để vẽ chart.</p>;
  }

  const up = (path.last?.c ?? 0) >= (path.first?.c ?? 0);

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
        <span>
          {symbol} · giá đóng cửa ~{series.length} phiên
        </span>
        <span>
          {path.min.toFixed(2)} — {path.max.toFixed(2)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${path.w} ${path.h}`}
        className="w-full rounded-md border border-border-subtle/50 bg-surface/50"
        role="img"
        aria-label={`Biểu đồ giá ${symbol}`}
      >
        <path
          d={path.d}
          fill="none"
          stroke={up ? "rgb(34 197 94)" : "rgb(239 68 68)"}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

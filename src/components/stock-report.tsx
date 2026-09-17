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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function boldHtml(text: string): string {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function sectionHtml(title: string, lines: string[]): string {
  if (!lines?.length) return "";
  const body = lines.map((l) => `<p>${boldHtml(l)}</p>`).join("");
  return `<h2>${esc(title)}</h2>${body}`;
}

function valueChainHtml(vc: { input: string[]; process: string[]; output: string[] } | null): string {
  if (!vc) {
    return sectionHtml("4. Chuỗi giá trị (Input → Process → Output)", [
      "Chưa suy được chuỗi giá trị từ hồ sơ/ngành.",
    ]);
  }
  const col = (label: string, items: string[]) =>
    `<div><b>${esc(label)}</b>${(items?.length ? items : ["—"])
      .map((x) => `<p style="margin:2px 0">• ${esc(x)}</p>`)
      .join("")}</div>`;
  return `<h2>4. Chuỗi giá trị (Input → Process → Output)</h2>
    <div class="scen">${col("Input", vc.input)}${col("Process", vc.process)}${col("Output", vc.output)}</div>`;
}

function chartSvgHtml(series: ChartPoint[], symbol: string): string {
  if (!series?.length) return "<p>Không có chuỗi giá để vẽ chart.</p>";
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
  const d = `M ${pts.join(" L ")}`;
  const up = (series[series.length - 1]?.c ?? 0) >= (series[0]?.c ?? 0);
  const stroke = up ? "#16a34a" : "#dc2626";
  return `<div style="margin:8px 0 4px;font-size:10.5px;color:#5a6b8c;display:flex;justify-content:space-between">
    <span>${esc(symbol)} · giá đóng cửa ~${series.length} phiên</span>
    <span>${min.toFixed(2)} — ${max.toFixed(2)}</span>
  </div>
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="180" style="border:1px solid #ccd;border-radius:8px;background:#f8fafc">
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" />
  </svg>`;
}

/** CSS + popup print giống Morning Brief */
function printCompanyReport(report: CompanyAnalysisReport) {
  const when = new Date(report.generatedAt).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const s = report.sections;
  const body = `
    <div class="hd">
      <div style="width:44px;height:44px;border-radius:10px;background:#123f7c;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px">OR</div>
      <div style="flex:1">
        <h1>${esc(report.title)}</h1>
        <p>ORCA Company Report · ${esc(report.symbol)}${report.floor ? ` · ${esc(report.floor)}` : ""} · Data ${esc(report.dataQuality)}</p>
      </div>
      <span class="bd">COMPANY</span>
    </div>

    ${sectionHtml("1. Giới thiệu doanh nghiệp", s.intro)}
    ${sectionHtml("2. Moat / lợi thế cạnh tranh", s.moat)}
    ${sectionHtml("3. Ngành hoạt động", s.industry)}
    ${valueChainHtml(s.valueChain)}
    ${sectionHtml("5. Kết quả kinh doanh", s.businessResults)}
    <h2>6. Phân tích kỹ thuật</h2>
    ${s.technical.map((l) => `<p>${boldHtml(l)}</p>`).join("")}
    ${chartSvgHtml(s.priceSeries, report.symbol)}
    ${sectionHtml("7. Định giá", s.valuation)}
    ${sectionHtml("8. Dự phóng KQKD & định giá", s.projection)}
    ${sectionHtml("9. Catalyst tăng trưởng", s.catalysts)}
    ${sectionHtml("10. Rủi ro doanh nghiệp", s.risks)}
    ${sectionHtml("11. Tiềm năng so với ngành", s.vsIndustry)}
    ${sectionHtml("12. Yếu tố vĩ mô", s.macro)}
    ${sectionHtml("13. Nhận xét đánh giá chung", s.overall)}

    <div class="assump">
      <b>Assumptions &amp; data traceability</b>
      <p>Nguồn: VNDirect (profile, BCTC, ratios, dchart) · pipeline ORCA quant · tạo lúc ${esc(when)}.</p>
      <div class="foot">ORCA Financial — Generated from verified market data · không phải khuyến nghị đầu tư</div>
    </div>
  `;

  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
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
      @media print{body{margin:12mm}}
    </style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 350);
}

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
            onClick={() => printCompanyReport(report)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary"
          >
            <Printer className="size-3.5" /> Xuất PDF / In
          </button>
        ) : null
      }
    >
      <div className="p-4">
        <p className="text-[12px] text-text-muted">
          Báo cáo chi tiết: hồ sơ · moat · ngành · chuỗi giá trị · KQKD · kỹ thuật (có chart) · định giá · dự phóng ·
          catalyst · risk · so sánh ngành · vĩ mô · nhận định. Xuất PDF cùng format Morning Brief.
        </p>
        <div className="mt-3 flex gap-2">
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
          <article className="mt-4 border-t border-border-subtle pt-4">
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

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              {meta ? <MetaLine meta={meta} /> : <span />}
              <button
                type="button"
                onClick={() => printCompanyReport(report)}
                className="flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:border-accent-primary/50 hover:text-accent-primary"
              >
                <Printer className="size-4" /> Xuất PDF / In báo cáo
              </button>
            </div>
          </article>
        )}
      </div>
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
    <div className="mt-3 rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
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
    <div className="mt-3 rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
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

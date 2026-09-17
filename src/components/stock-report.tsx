"use client";

import { useMemo, useState } from "react";
import type { CompanyAnalysisReport, ChartPoint } from "@/lib/services/company-analysis-report";
import type { ApiResponse } from "@/lib/types";
import { Badge, FreshnessDot, Loading, MetaLine, Panel } from "@/components/ui";
import { OrcaMark } from "@/components/logo";
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
  const a = String.fromCharCode(38);
  return s
    .replace(/&/g, a + "amp;")
    .replace(/</g, a + "lt;")
    .replace(/>/g, a + "gt;")
    .replace(/"/g, a + "quot;");
}

function boldHtml(text: string): string {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function sectionHtml(title: string, lines: string[]): string {
  if (!lines?.length) return "";
  const body = lines.map((l) => `<p>${boldHtml(l)}</p>`).join("");
  return `<h2>${esc(title)}</h2>${body}`;
}

/** Tách dòng **tiêu đề nhóm** thành các khối con độc lập (dùng cho Catalyst / Vĩ mô). */
function groupedSectionHtml(title: string, lines: string[], tone: "catalyst" | "macro"): string {
  if (!lines?.length) return "";
  const groups: { head: string | null; items: string[] }[] = [];
  let cur: { head: string | null; items: string[] } = { head: null, items: [] };
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*$/);
    if (m) {
      if (cur.head || cur.items.length) groups.push(cur);
      cur = { head: m[1], items: [] };
    } else {
      cur.items.push(line);
    }
  }
  if (cur.head || cur.items.length) groups.push(cur);
  const border = tone === "catalyst" ? "#c2410c" : "#1d4ed8";
  const bg = tone === "catalyst" ? "#fff7ed" : "#eff6ff";
  const blocks = groups
    .map((g) => {
      const h = g.head
        ? `<div class="grp-h" style="color:${border}">${esc(g.head)}</div>`
        : "";
      const body = g.items.map((l) => `<p>${boldHtml(l)}</p>`).join("");
      return `<div class="grp" style="border-left:3px solid ${border};background:${bg}">${h}${body}</div>`;
    })
    .join("");
  return `<h2>${esc(title)}</h2>${blocks}`;
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

function businessTableHtml(
  rows: { metric: string; current: string; prior: string; change: string }[] | undefined,
  fallback: string[],
  meta?: { periodCurrent: string; periodPrior: string; compareMode: string } | null,
): string {
  if (rows?.length) {
    const cLabel = meta?.periodCurrent ?? "Kỳ gần";
    const pLabel = meta?.periodPrior ?? "Kỳ trước";
    const mode = meta?.compareMode === "YoY" ? "YoY" : meta?.compareMode === "QoQ" ? "QoQ" : "Δ";
    const tr = rows
      .map(
        (r) =>
          `<tr><td>${esc(r.metric)}</td><td class="num">${esc(r.current)}</td><td class="num">${esc(r.prior)}</td><td class="num">${esc(r.change)}</td></tr>`,
      )
      .join("");
    return `<p style="font-size:11px;color:#5a6b8c;margin:4px 0 6px">So sánh <b>${esc(mode)}</b> · ${esc(cLabel)} vs ${esc(pLabel)}</p>
    <table class="kq"><thead><tr><th>Chỉ tiêu</th><th>${esc(cLabel)}</th><th>${esc(pLabel)}</th><th>${esc(mode)}</th></tr></thead><tbody>${tr}</tbody></table>`;
  }
  if (fallback?.length) return fallback.map((l) => `<p>${boldHtml(l)}</p>`).join("");
  return "<p>Chưa có số liệu KQKD 2 kỳ.</p>";
}

function printCompanyReport(report: CompanyAnalysisReport) {
  const when = new Date(report.generatedAt).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const orcaLogoSrc = `${origin}/brand/orca-mark.svg`;
  const s = report.sections;
  const body = `
  <div class="wrap">
    <div class="hd">
      <img class="logo-orca" src="${orcaLogoSrc}" alt="ORCA" width="44" height="44" />
      ${report.companyLogo ? `<img class="logo-co" src="${esc(report.companyLogo)}" alt="${esc(report.symbol)}" width="44" height="44" onerror="this.style.display='none'" />` : ""}
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
    <h2>5. Kết quả kinh doanh</h2>
    ${businessTableHtml(s.businessTable, s.businessResults, s.businessTableMeta)}
    <h2>6. Phân tích kỹ thuật</h2>
    ${s.technical.map((l) => `<p>${boldHtml(l)}</p>`).join("")}
    ${chartSvgHtml(s.priceSeries, report.symbol)}
    ${sectionHtml("7. Định giá", s.valuation)}
    ${sectionHtml("8. Dự phóng KQKD & định giá", s.projection)}
    ${groupedSectionHtml("9. Catalyst tăng trưởng (độc lập)", s.catalysts, "catalyst")}
    ${sectionHtml("10. Rủi ro doanh nghiệp", s.risks)}
    ${sectionHtml("11. Tiềm năng so với ngành", s.vsIndustry)}
    ${groupedSectionHtml("12. Phân tích vĩ mô (độc lập)", s.macro, "macro")}
    ${sectionHtml("13. Kết luận hành động", s.overall)}

    <div class="assump">
      <b>Assumptions & data traceability</b>
      <p>Nguồn: VNDirect (profile, BCTC, ratios, dchart) · pipeline ORCA quant · tạo lúc ${esc(when)}.</p>
      <div class="foot">ORCA Financial — Generated from verified market data · không phải khuyến nghị đầu tư</div>
    </div>
  </div>
  `;

  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>
      @page{size:A4;margin:14mm 16mm 16mm 16mm}
      body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0c1a33;margin:0;padding:0;line-height:1.6;font-size:12.5px}
      .wrap{max-width:180mm;margin:0 auto}
      .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #123;padding-bottom:12px;margin-bottom:14px}
      .logo-orca,.logo-co{width:44px;height:44px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid #ccd}
      .hd h1{font-size:17px;margin:0;color:#0c1a33}
      .hd p{margin:2px 0 0;color:#5a6b8c;font-size:11px}
      .bd{border:1px solid #ccd;border-radius:8px;padding:3px 10px;font-size:9.5px;color:#134078;font-weight:700;letter-spacing:.12em;white-space:nowrap}
      h2{font-size:12.5px;color:#123f7c;margin:14px 0 6px;border-left:3px solid #123f7c;padding-left:8px}
      p{margin:4px 0;font-size:12px}
      .grp{margin:8px 0;padding:8px 10px;border-radius:6px}
      .grp-h{font-size:11px;font-weight:700;letter-spacing:.04em;margin-bottom:4px}
      .grp p{margin:3px 0;font-size:11.5px}
      .scen{display:table;border-collapse:collapse;width:100%;margin:8px 0}
      .scen>div{display:table-cell;border:1px solid #ccd;padding:8px;width:33%;vertical-align:top}
      .scen b{display:block;font-size:10.5px;letter-spacing:.08em;margin-bottom:4px}
      table.kq{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:12px}
      table.kq th,table.kq td{border:1px solid #ccd;padding:7px 10px;text-align:left;vertical-align:top}
      table.kq th{background:#eef3f9;color:#123f7c;font-size:10.5px;letter-spacing:.04em;font-weight:700}
      table.kq td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:#0c1a33;white-space:nowrap}
      table.kq td.note{color:#5a6b8c;font-size:11px}
      .assump{font-size:10px;color:#5a6b8c;border-top:1px dashed #ccd;margin-top:14px;padding-top:8px}
      .foot{margin-top:16px;text-align:center;font-size:9.5px;color:#5a6b8c}
      @media print{body{margin:0}}
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
          Báo cáo chi tiết · KQKD 2 kỳ (QoQ/YoY) · Catalyst & Vĩ mô tách độc lập · PDF lề A4 + logo.
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <OrcaMark size={40} className="rounded-lg border border-border-subtle bg-white" />
                {report.companyLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={report.companyLogo}
                    alt={report.symbol}
                    className="size-10 rounded-lg border border-border-subtle bg-white object-contain"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold text-text-primary">{report.title}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={report.dataQuality === "HIGH" ? "up" : report.dataQuality === "MEDIUM" ? "warn" : "down"}>
                    Data {report.dataQuality}
                  </Badge>
                  {report.floor && <Badge tone="accent">{report.floor}</Badge>}
                  {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
                </div>
              </div>
            </div>

            <Sec icon={<Building2 className="size-4" />} title="1. Giới thiệu doanh nghiệp" lines={report.sections.intro} />
            <Sec icon={<ShieldAlert className="size-4" />} title="2. Moat / lợi thế cạnh tranh" lines={report.sections.moat} />
            <Sec icon={<Factory className="size-4" />} title="3. Ngành hoạt động" lines={report.sections.industry} />
            <ValueChainBlock vc={report.sections.valueChain} />
            <BusinessTableBlock
              rows={report.sections.businessTable}
              fallback={report.sections.businessResults}
              meta={report.sections.businessTableMeta}
            />
            <Sec icon={<LineChart className="size-4" />} title="6. Phân tích kỹ thuật" lines={report.sections.technical}>
              <PriceLineChart series={report.sections.priceSeries} symbol={report.symbol} />
            </Sec>
            <Sec icon={<Scale className="size-4" />} title="7. Định giá" lines={report.sections.valuation} />
            <Sec icon={<TrendingUp className="size-4" />} title="8. Dự phóng KQKD & định giá" lines={report.sections.projection} />

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <GroupedSec
                icon={<Sparkles className="size-4" />}
                title="9. Catalyst tăng trưởng"
                lines={report.sections.catalysts}
                tone="catalyst"
              />
              <GroupedSec
                icon={<Globe2 className="size-4" />}
                title="12. Phân tích vĩ mô"
                lines={report.sections.macro}
                tone="macro"
              />
            </div>

            <Sec icon={<Target className="size-4" />} title="10. Rủi ro doanh nghiệp" lines={report.sections.risks} />
            <Sec icon={<GitBranch className="size-4" />} title="11. Tiềm năng so với ngành" lines={report.sections.vsIndustry} />
            <Sec icon={<FileSearch className="size-4" />} title="13. Kết luận hành động" lines={report.sections.overall} />

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

/** Khối độc lập cho Catalyst / Vĩ mô — tách nhóm con theo dòng **tiêu đề**. */
function GroupedSec({
  icon,
  title,
  lines,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  tone: "catalyst" | "macro";
}) {
  if (!lines?.length) return null;
  const groups: { head: string | null; items: string[] }[] = [];
  let cur: { head: string | null; items: string[] } = { head: null, items: [] };
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*$/);
    if (m) {
      if (cur.head || cur.items.length) groups.push(cur);
      cur = { head: m[1], items: [] };
    } else {
      cur.items.push(line);
    }
  }
  if (cur.head || cur.items.length) groups.push(cur);

  const border =
    tone === "catalyst"
      ? "border-orange-500/40 bg-orange-500/5"
      : "border-blue-500/40 bg-blue-500/5";
  const headColor = tone === "catalyst" ? "text-orange-400" : "text-blue-400";

  return (
    <div className={`rounded-lg border ${border} p-3`}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
        {icon} {title}
      </div>
      <div className="space-y-2">
        {groups.map((g, gi) => (
          <div key={gi} className="rounded-md border border-border-subtle/60 bg-surface-elevated/50 p-2.5">
            {g.head && (
              <div className={`mb-1.5 text-[11px] font-bold tracking-wide ${headColor}`}>{g.head}</div>
            )}
            <div className="space-y-1 text-[12.5px] leading-relaxed text-text-secondary">
              {g.items.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {renderBold(line)}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={i} className="font-semibold text-text-primary">{m[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

function ValueChainBlock({ vc }: { vc: CompanyAnalysisReport["sections"]["valueChain"] }) {
  return (
    <div className="mt-3 rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
        <Landmark className="size-4" /> 4. Chuỗi giá trị (Input → Process → Output)
      </div>
      {!vc ? (
        <p className="text-[12.5px] text-text-secondary">Chưa suy được chuỗi giá trị từ hồ sơ/ngành.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["Input", vc.input],
              ["Process", vc.process],
              ["Output", vc.output],
            ] as const
          ).map(([label, items]) => (
            <div key={label} className="rounded-md border border-border-subtle/70 bg-surface p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
              <ul className="space-y-0.5 text-[12px] text-text-secondary">
                {(items?.length ? items : ["—"]).map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessTableBlock({
  rows,
  fallback,
  meta,
}: {
  rows: CompanyAnalysisReport["sections"]["businessTable"];
  fallback: string[];
  meta: CompanyAnalysisReport["sections"]["businessTableMeta"];
}) {
  return (
    <div className="mt-3 rounded-lg border border-border-subtle/80 bg-surface-elevated/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
        <Factory className="size-4" /> 5. Kết quả kinh doanh
      </div>
      {rows?.length ? (
        <>
          {meta && (
            <p className="mb-2 text-[11px] text-text-muted">
              So sánh <span className="font-semibold text-text-secondary">{meta.compareMode}</span> ·{" "}
              {meta.periodCurrent} vs {meta.periodPrior}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="py-1.5 pr-2">Chỉ tiêu</th>
                  <th className="py-1.5 pr-2 text-right">{meta?.periodCurrent ?? "Kỳ gần"}</th>
                  <th className="py-1.5 pr-2 text-right">{meta?.periodPrior ?? "Kỳ trước"}</th>
                  <th className="py-1.5 text-right">{meta?.compareMode ?? "Δ"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.metric} className="border-b border-border-subtle/50">
                    <td className="py-1.5 pr-2 text-text-secondary">{r.metric}</td>
                    <td className="num py-1.5 pr-2 text-right font-medium text-text-primary">{r.current}</td>
                    <td className="num py-1.5 pr-2 text-right text-text-muted">{r.prior}</td>
                    <td className="num py-1.5 text-right font-medium text-text-primary">{r.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="space-y-1 text-[12.5px] text-text-secondary">
          {fallback.map((l, i) => (
            <p key={i}>{renderBold(l)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceLineChart({ series, symbol }: { series: ChartPoint[]; symbol: string }) {
  const path = useMemo(() => {
    if (!series?.length) return null;
    const w = 640;
    const h = 120;
    const pad = 8;
    const ys = series.map((p) => p.c);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const pts = series.map((p, i) => {
      const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p.c - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { d: `M ${pts.join(" L ")}`, min, max, w, h };
  }, [series]);

  if (!path) return <p className="mt-2 text-[12px] text-text-muted">Không có chuỗi giá để vẽ chart.</p>;
  const up = (series[series.length - 1]?.c ?? 0) >= (series[0]?.c ?? 0);

  return (
    <div className="mt-2">
      <div className="mb-1 flex justify-between text-[10.5px] text-text-muted">
        <span>
          {symbol} · giá đóng cửa ~{series.length} phiên
        </span>
        <span>
          {path.min.toFixed(2)} — {path.max.toFixed(2)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${path.w} ${path.h}`}
        className="h-[120px] w-full rounded-lg border border-border-subtle bg-surface"
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

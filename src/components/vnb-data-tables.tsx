"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { BarChart3, Boxes, Landmark, Search } from "lucide-react";
import type { Meta } from "@/lib/types";

/**
 * VietnamBiz DATA (WiFeed) — 2 trang dữ liệu:
 *  - Kinh tế vĩ mô: /macro-economic (GDP/CPI/PMI/FDI/xuất nhập khẩu + kỳ +
 *    ngày công bố tiếp theo)
 *  - Lãi suất & tiền tệ: /currency-interest-rate (M2/tín dụng/tỷ giá/lãi suất)
 * Cùng style Panel/Badge/Freshness với phần còn lại của app. Không mock:
 * mọi số là giá WiFeed công bố; nguồn + bản quyền WiGroup luôn hiển thị.
 */

/* ------------------------------ API types ------------------------------ */

interface SectionOk<T> { ok: true; data: T; url: string }
interface SectionErr { ok: false; error: string; url: string }
type Section<T> = SectionOk<T> | SectionErr;

export interface VnbGoodsRow {
  name: string;
  unit: string;
  price: number | null;
  pctDay: number | null;
  pctMonth: number | null;
  pctYear: number | null;
  date: string | null;
  dateTs: number | null;
}
export interface VnbMacroRow {
  indicator: string;
  period: string;
  current: number | null;
  currentRaw: string | null;
  previous: number | null;
  previousRaw: string | null;
  nextRelease: string | null;
}
export interface VnbRateRow {
  indicator: string;
  period: string;
  current: number | null;
  currentRaw: string | null;
  previous: number | null;
  previousRaw: string | null;
}

export interface VnbDataSnapshot {
  source: string;
  provider: string;
  baseUrl: string;
  fetchedAt: string;
  note: string;
  goods: Section<{ rows: VnbGoodsRow[]; mapped: Record<string, unknown> }>;
  macro: Section<{ rows: VnbMacroRow[]; url: string }>;
  rates: Section<{ rows: VnbRateRow[]; url: string }>;
}

/* ------------------------------ helpers ------------------------------ */

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function delta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  const d = current - previous;
  return Math.abs(d) < 1e-9 ? 0 : Number(d.toFixed(4));
}

function fmtDelta(d: number | null, pct: boolean): string {
  if (d == null) return "—";
  const up = d > 0;
  const flat = Math.abs(d) < 1e-9;
  return `${flat ? "" : up ? "+" : ""}${d.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}${pct ? " pp" : ""}`;
}

function Trend({ d, unit }: { d: number | null; unit: string }) {
  if (d == null) return <span className="text-ink-3">—</span>;
  const up = d > 0;
  const flat = Math.abs(d) < 1e-9;
  const cls = flat ? "text-ink-2" : up ? "text-up" : "text-down";
  return <span className={`num inline-flex items-center gap-0.5 text-[11.5px] ${cls}`}>{fmtDelta(d, unit === "pp")}</span>;
}

function ValueCell({ raw, num, prev }: { raw: string | null; num: number | null; prev: number | null }) {
  if (raw == null) return <span className="text-ink-3">—</span>;
  const isPct = /%/.test(raw);
  const d = delta(num, prev);
  const cls =
    d == null || Math.abs(d) < 1e-9 ? "text-ink" : d > 0 ? "text-up" : "text-down";
  return <span className={`num text-[12.5px] font-medium ${cls}`}>{raw}</span>;
}

/* ------------------------------ shared shell ------------------------------ */

function VnbPageShell({
  mode,
  meta,
  isLoading,
  hasSection,
  children,
  error,
  extra,
}: {
  mode: "macro" | "rates";
  meta: Meta | null;
  isLoading: boolean;
  hasSection: boolean;
  children: React.ReactNode;
  error?: string | null;
  extra?: React.ReactNode;
}) {
  const isMacro = mode === "macro";
  const Icon = isMacro ? BarChart3 : Landmark;
  const title = isMacro ? "Kinh tế vĩ mô Việt Nam" : "Lãi suất & tiền tệ";
  const desc = isMacro
    ? "GDP, CPI, PMI, FDI, xuất nhập khẩu, cán cân thương mại… kèm kỳ công bố và ngày công bố tiếp theo."
    : "Cung tiền M2, tín dụng, tỷ giá trung tâm/NHTM/tự do, lãi suất liên ngân hàng, chiết khấu, tái cấp vốn, huy động.";

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Icon className="size-5 text-accent" /> {title}
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <p className="text-[12px] text-ink-3">{desc}</p>
          <div className="text-[11px] text-ink-3">
            Nguồn: <a href="https://data.vietnambiz.vn" target="_blank" rel="noreferrer" className="text-accent hover:underline">VietnamBiz Data (WiFeed/WiGroup)</a>{" "}
            · dữ liệu thuộc bản quyền <span className="text-ink-2">CTCP WiGroup</span> · dùng có ghi nguồn.
          </div>
          {extra}
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {isLoading && !hasSection ? (
        <Loading rows={16} />
      ) : !hasSection ? (
        <Unavailable
          title={isMacro ? "Dữ liệu kinh tế vĩ mô chưa khả dụng" : "Dữ liệu lãi suất tiền tệ chưa khả dụng"}
          note={error ?? "data.vietnambiz.vn chưa trả dữ liệu — thử lại sau."}
          meta={meta}
        />
      ) : (
        <>{children}</>
      )}
    </div>
  );
}

function SourceFooter({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2.5 text-[10.5px] text-ink-3">
      <span>
        Nguồn: <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">VietnamBiz Data (WiFeed)</a> — {label}
      </span>
      <span>Bản quyền: CTCP WiGroup · WiFeed.vn · WiChart.vn</span>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="mt-1 flex w-full max-w-sm items-center gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
      <Search className="size-3.5 text-ink-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
      />
    </label>
  );
}

/* ------------------------------ Macro table ------------------------------ */

const thCls = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3";
const tdCls = "px-3 py-2.5 align-top";
const trCls = "border-t border-line/60 transition-colors hover:bg-panel-2/60";

export function VnbMacroView({ snapshot, meta, isLoading }: { snapshot: VnbDataSnapshot | null; meta: Meta | null; isLoading: boolean }) {
  const section = snapshot?.macro;
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    if (!section?.ok) return [];
    const needle = normalize(q.trim());
    return needle
      ? section.data.rows.filter((r) => normalize(`${r.indicator} ${r.period}`).includes(needle))
      : section.data.rows;
  }, [section, q]);

  return (
    <VnbPageShell
      mode="macro"
      meta={meta}
      isLoading={isLoading}
      hasSection={Boolean(section?.ok)}
      error={section && !section.ok ? section.error : null}
      extra={<SearchInput value={q} onChange={setQ} placeholder="Lọc chỉ tiêu… (vd: GDP, CPI, PMI)" />}
    >
      <Panel pad={false} title={`Chỉ số vĩ mô (${rows.length})`} right={section?.ok ? <Badge tone="accent">WiFeed · theo kỳ</Badge> : undefined}>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-ink-3">Không có chỉ tiêu khớp từ khóa “{q}”.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="bg-panel-2/70">
                <tr>
                  <th className={thCls}>Chỉ tiêu</th>
                  <th className={thCls}>Kỳ công bố</th>
                  <th className={thCls}>Kỳ hiện tại</th>
                  <th className={thCls}>Kỳ trước</th>
                  <th className={thCls}>Δ kỳ trước</th>
                  <th className={thCls}>Ngày công bố tiếp theo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = Boolean(r.currentRaw && /%/.test(r.currentRaw));
                  return (
                    <tr key={`${r.indicator}-${r.period}`} className={trCls}>
                      <td className={`${tdCls} font-medium text-ink`}>{r.indicator}</td>
                      <td className={`${tdCls} whitespace-nowrap text-ink-2`}>{r.period}</td>
                      <td className={tdCls}>
                        <ValueCell raw={r.currentRaw} num={r.current} prev={r.previous} />
                      </td>
                      <td className={`${tdCls} num text-ink-2`}>{r.previousRaw ?? "—"}</td>
                      <td className={tdCls}>
                        <Trend d={delta(r.current, r.previous)} unit={pct ? "pp" : ""} />
                      </td>
                      <td className={`${tdCls} max-w-[200px] text-[11px] leading-snug text-ink-3`}>{r.nextRelease ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SourceFooter url="https://data.vietnambiz.vn/macro-economic" label="bảng chỉ số kinh tế vĩ mô (GDP/CPI/PMI/FDI…)" />
      </Panel>
    </VnbPageShell>
  );
}

/* ------------------------------ Rates table ------------------------------ */

export function VnbRatesView({ snapshot, meta, isLoading }: { snapshot: VnbDataSnapshot | null; meta: Meta | null; isLoading: boolean }) {
  const section = snapshot?.rates;
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    if (!section?.ok) return [];
    const needle = normalize(q.trim());
    return needle
      ? section.data.rows.filter((r) => normalize(`${r.indicator} ${r.period}`).includes(needle))
      : section.data.rows;
  }, [section, q]);

  return (
    <VnbPageShell
      mode="rates"
      meta={meta}
      isLoading={isLoading}
      hasSection={Boolean(section?.ok)}
      error={section && !section.ok ? section.error : null}
      extra={<SearchInput value={q} onChange={setQ} placeholder="Lọc chỉ tiêu… (vd: M2, tỷ giá, lãi suất)" />}
    >
      <Panel pad={false} title={`Chỉ số tiền tệ & lãi suất (${rows.length})`} right={section?.ok ? <Badge tone="accent">WiFeed · theo kỳ</Badge> : undefined}>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-ink-3">Không có chỉ tiêu khớp từ khóa “{q}”.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="bg-panel-2/70">
                <tr>
                  <th className={thCls}>Chỉ tiêu</th>
                  <th className={thCls}>Kỳ công bố</th>
                  <th className={thCls}>Kỳ hiện tại</th>
                  <th className={thCls}>Kỳ trước</th>
                  <th className={thCls}>Δ kỳ trước</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = Boolean(r.currentRaw && /%/.test(r.currentRaw));
                  return (
                    <tr key={`${r.indicator}-${r.period}`} className={trCls}>
                      <td className={`${tdCls} font-medium text-ink`}>{r.indicator}</td>
                      <td className={`${tdCls} whitespace-nowrap text-ink-2`}>{r.period}</td>
                      <td className={tdCls}>
                        <ValueCell raw={r.currentRaw} num={r.current} prev={r.previous} />
                      </td>
                      <td className={`${tdCls} num text-ink-2`}>{r.previousRaw ?? "—"}</td>
                      <td className={tdCls}>
                        <Trend d={delta(r.current, r.previous)} unit={pct ? "pp" : ""} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SourceFooter url="https://data.vietnambiz.vn/currency-interest-rate" label="bảng lãi suất tiền tệ (M2/tín dụng/tỷ giá/lãi suất)" />
      </Panel>
    </VnbPageShell>
  );
}

/** Tiny teaser linking both pages + goods (used by both pages above nav). */
export function VnbDatasetLinks({ active }: { active: "macro" | "rates" }) {
  const links = [
    { key: "macro" as const, href: "/macro", label: "Kinh tế vĩ mô", icon: BarChart3 },
    { key: "rates" as const, href: "/rates", label: "Lãi suất & tiền tệ", icon: Landmark },
    { key: "goods" as const, href: "/commodities", label: "Hàng hóa", icon: Boxes },
  ];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${active === l.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:bg-panel-2 hover:text-ink"}`}
        >
          <l.icon className="size-3.5" /> {l.label}
        </a>
      ))}
    </div>
  );
}

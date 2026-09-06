"use client";

import type { FreshnessStatus, Meta } from "@/lib/types";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Database, Minus, Unplug } from "lucide-react";

/* ------------------------------- primitives ------------------------------- */

export function Panel({ title, right, children, className = "", pad = true, style }: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <h2 className="text-[13px] font-medium tracking-wide text-ink">{title}</h2>
          <div className="flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={pad ? "p-3.5" : ""}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "up" | "down" | "neutral" | "warn" | "accent" }) {
  const cls =
    tone === "up" ? "bg-up/10 text-up border-up/25"
    : tone === "down" ? "bg-down/10 text-down border-down/25"
    : tone === "warn" ? "bg-warn/10 text-warn border-warn/30"
    : tone === "accent" ? "bg-accent/10 text-accent border-accent/30"
    : "bg-panel-3 text-ink-2 border-line";
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

export function Chg({ value, suffix = "%", arrow = true, className = "" }: { value: number | null | undefined; suffix?: string; arrow?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`num text-ink-3 ${className}`}>—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 1e-9;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`num inline-flex items-center gap-0.5 ${flat ? "text-ink-2" : up ? "text-up" : "text-down"} ${className}`}>
      {arrow && <Icon className="size-3.5" />}
      {up ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

/* ------------------------------ freshness UI ------------------------------ */

const F_LABEL: Record<FreshnessStatus, string> = {
  LIVE: "LIVE",
  FRESH: "FRESH",
  DELAYED: "DELAYED",
  STALE: "STALE",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
};
const F_CLS: Record<FreshnessStatus, string> = {
  LIVE: "bg-up live-dot",
  FRESH: "bg-up/70",
  DELAYED: "bg-warn",
  STALE: "bg-warn/60",
  DEGRADED: "bg-down/80",
  UNAVAILABLE: "bg-down",
};

export function FreshnessDot({ status, ageMs }: { status?: FreshnessStatus | null; ageMs?: number | null }) {
  const s = status ?? "UNAVAILABLE";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-ink-2" title={ageMs != null ? `Dữ liệu cách nguồn ${formatAge(ageMs)}` : s}>
      <span className={`size-1.5 rounded-full ${F_CLS[s]}`} />
      {F_LABEL[s]}
      {ageMs != null && <span className="text-ink-3">· {formatAge(ageMs)}</span>}
    </span>
  );
}

export function MetaLine({ meta }: { meta: Meta | null | undefined }) {
  if (!meta) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
      <span className="inline-flex items-center gap-1">
        <Database className="size-3" />
        {meta.source}
      </span>
      {meta.sourceTimestamp && <span>nguồn: {new Date(meta.sourceTimestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>}
      {meta.cached && <span>cache</span>}
      {meta.note && <span className="text-warn/90">{meta.note}</span>}
    </div>
  );
}

export function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s trước`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}p trước`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h trước`;
  return `${Math.round(h / 24)}d trước`;
}

/* ------------------------------ state blocks ------------------------------ */

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 w-full" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function Unavailable({ title = "Nguồn dữ liệu chưa khả dụng", note, meta }: { title?: string; note?: string | null; meta?: Meta | null }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-line-2 bg-panel-2/50 p-4">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Unplug className="size-4 text-warn" />
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        {note ??
          "Provider đang lỗi hoặc chưa được cấu hình. Hệ thống không dùng dữ liệu giả — module này sẽ tự phục hồi khi nguồn sẵn sàng. Kiểm tra trạng thái tại mục Hệ thống."}
      </p>
      {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-down/25 bg-down/5 p-3 text-[12px] text-ink-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-down" />
      <span>{message}</span>
    </div>
  );
}

/* --------------------------------- numbers -------------------------------- */

import { getSettingsSnapshot } from "@/lib/settings";

export function fmtLocale(): string {
  return getSettingsSnapshot().appearance.numberFormat ?? "en-US";
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(fmtLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

export function priceDigits(p: number): number {
  if (p >= 1000) return 1;
  if (p >= 100) return 2;
  if (p >= 1) return 3;
  if (p >= 0.01) return 5;
  return 8;
}

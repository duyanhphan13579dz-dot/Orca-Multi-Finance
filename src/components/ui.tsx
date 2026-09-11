import { Database, AlertTriangle } from "lucide-react";
import type { FreshnessStatus, Meta } from "@/lib/types";

export function Panel({
  title,
  right,
  children,
  className = "",
  pad = true,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title != null || right != null) && (
        <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border-subtle/60 px-3.5 pb-2 pt-3">
          <h3 className="text-[12.5px] font-semibold tracking-wide text-text-primary">{title}</h3>
          {right}
        </div>
      )}
      <div className={pad ? "px-3.5 pb-3.5" : ""}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "up" | "down" | "neutral" | "warn" | "accent" }) {
  const map: Record<string, string> = {
    up: "bg-up/15 text-up border-up/30",
    down: "bg-down/15 text-down border-down/30",
    neutral: "bg-surface-elevated text-text-muted border-border-subtle",
    warn: "bg-warn/15 text-warn border-warn/30",
    accent: "bg-accent-primary/15 text-accent-primary border-accent-primary/30",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] sm:text-[11px] ${map[tone]}`}>{children}</span>;
}

export function Chg({ value, suffix = "%", arrow = true, className = "" }: { value: number | null | undefined; suffix?: string; arrow?: boolean; className?: string }) {
  if (value == null || Number.isNaN(value)) return <span className={`num text-text-muted ${className}`}>—</span>;
  const up = value > 0;
  const down = value < 0;
  const color = up ? "text-up" : down ? "text-down" : "text-text-muted";
  const prefix = up ? "+" : "";
  return (
    <span className={`num ${color} ${className}`}>
      {arrow && up && "▲ "}
      {arrow && down && "▼ "}
      {prefix}
      {Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)}
      {suffix}
    </span>
  );
}

const statusColor: Record<string, string> = {
  LIVE: "bg-up",
  FRESH: "bg-up",
  DELAYED: "bg-warn",
  STALE: "bg-warn",
  UNAVAILABLE: "bg-text-muted",
  ERROR: "bg-down",
};

export function FreshnessDot({ status, ageMs }: { status?: FreshnessStatus | null; ageMs?: number | null }) {
  const s = status ?? "UNAVAILABLE";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-ink-2" title={ageMs != null ? `Dữ liệu cách nguồn ${formatAge(ageMs)}` : s}>
      <span className={`inline-block size-1.5 rounded-full ${statusColor[s] ?? "bg-text-muted"}`} />
      {s}
    </span>
  );
}

export function MetaLine({ meta }: { meta: Meta | null | undefined }) {
  if (!meta) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
      <span className="inline-flex items-center gap-1">
        <Database className="size-3" />
        <span className="max-w-[12rem] truncate sm:max-w-none">{meta.source}</span>
      </span>
      {meta.sourceTimestamp && (
        <span className="hidden sm:inline">
          nguồn: {new Date(meta.sourceTimestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
        </span>
      )}
      {meta.cached && <span>cache</span>}
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

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-md bg-surface-elevated" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

export function Unavailable({ title = "Nguồn dữ liệu chưa khả dụng", note, meta }: { title?: string; note?: string | null; meta?: Meta | null }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-surface-panel p-5">
      <div className="flex items-center gap-2 text-warn">
        <AlertTriangle className="size-4" />
        <span className="text-[13.5px] font-semibold">{title}</span>
      </div>
      {note && <p className="text-[12px] leading-relaxed text-text-muted">{note}</p>}
      {meta && <MetaLine meta={meta} />}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-[12px] text-down">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function priceDigits(p: number): number {
  if (p >= 1000) return 0;
  if (p >= 1) return 2;
  return 4;
}

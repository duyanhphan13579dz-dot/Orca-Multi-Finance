import type { ReactNode } from "react";
import { Database } from "lucide-react";
import type { FreshnessStatus, Meta } from "@/lib/types";

export function Panel({
  title,
  right,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title != null || right != null) && (
        <header className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
          <div className="text-[12px] font-semibold tracking-wide text-ink-1">{title}</div>
          {right}
        </header>
      )}
      <div className={pad ? "px-0.5" : ""}>{children}</div>
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "warn" | "accent";
}) {
  const cls =
    tone === "up"
      ? "border-positive/30 bg-positive/10 text-positive"
      : tone === "down"
        ? "border-negative/30 bg-negative/10 text-negative"
        : tone === "warn"
          ? "border-warn/30 bg-warn/10 text-warn"
          : tone === "accent"
            ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
            : "border-border-subtle bg-surface-elevated text-text-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] sm:text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

export function Chg({
  value,
  className = "",
  arrow = true,
}: {
  value: number | null | undefined;
  className?: string;
  arrow?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={`num text-text-muted ${className}`}>—</span>;
  const up = value >= 0;
  return (
    <span className={`num ${up ? "text-up" : "text-down"} ${className}`}>
      {arrow ? (up ? "▲ " : "▼ ") : ""}
      {up && value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function priceDigits(price: number | null | undefined): number {
  if (price == null) return 2;
  if (price >= 1000) return 0;
  if (price >= 100) return 1;
  if (price >= 1) return 2;
  return 4;
}

export function FreshnessDot({
  status,
  ageMs,
}: {
  status?: FreshnessStatus | string | null;
  ageMs?: number | null;
}) {
  const s = (status ?? "UNKNOWN").toString().toUpperCase();
  const color =
    s === "LIVE" || s === "FRESH"
      ? "bg-positive"
      : s === "STALE" || s === "DELAYED"
        ? "bg-warn"
        : s === "UNAVAILABLE" || s === "ERROR"
          ? "bg-negative"
          : "bg-text-muted";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-ink-2"
      title={ageMs != null ? `Dữ liệu cách nguồn ${formatAge(ageMs)}` : s}
    >
      <span className={`inline-block size-1.5 rounded-full ${color}`} />
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
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}p`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-surface-elevated" />
      ))}
    </div>
  );
}

export function Unavailable({
  title = "Nguồn dữ liệu chưa khả dụng",
  note,
  meta,
}: {
  title?: string;
  note?: string | null;
  meta?: Meta | null;
}) {
  return (
    <div className="panel p-4">
      <div className="text-[13px] font-semibold text-ink-1">{title}</div>
      {note && <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{note}</p>}
      {meta && (
        <div className="mt-2">
          <MetaLine meta={meta} />
        </div>
      )}
    </div>
  );
}

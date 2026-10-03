import type React from "react";
import { AlertTriangle } from "lucide-react";
import type { FreshnessStatus, Meta } from "@/lib/types";

export function Panel({
  title,
  subtitle,
  eyebrow,
  right,
  footer,
  children,
  className = "",
  pad = true,
  tone = "default",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  tone?: "default" | "elevated" | "inset";
}) {
  const toneClass = tone === "elevated" ? "panel-elevated" : tone === "inset" ? "panel-inset" : "";
  return (
    <section data-orca-card className={`panel ${toneClass} ${className}`.trim()}>
      {(title != null || right != null || eyebrow != null || subtitle != null) && (
        <header className="panel-header">
          <div className="min-w-0">
            {eyebrow != null && <div className="panel-eyebrow">{eyebrow}</div>}
            {title != null && <h3 className="panel-title">{title}</h3>}
            {subtitle != null && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {right != null && <div className="panel-actions">{right}</div>}
        </header>
      )}
      <div className={pad ? "panel-body" : "min-w-0"}>{children}</div>
      {footer != null && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

export function PanelMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "neutral" | "up" | "down" | "warn";
}) {
  return (
    <div className={`panel-metric panel-metric-${tone}`}>
      <span className="panel-metric-label">{label}</span>
      <strong className="panel-metric-value num">{value}</strong>
      {detail != null && <span className="panel-metric-detail">{detail}</span>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "up" | "down" | "neutral" | "warn" | "accent" | "bull";
  className?: string;
}) {
  const map: Record<string, string> = {
    up: "bg-up/15 text-up border-up/30",
    bull: "bg-up/15 text-up border-up/30",
    down: "bg-down/15 text-down border-down/30",
    neutral: "bg-surface-elevated text-text-muted border-border-subtle",
    warn: "bg-warn/15 text-warn border-warn/30",
    accent: "bg-accent-primary/15 text-accent-primary border-accent-primary/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] sm:text-[11px] ${map[tone]} ${className ?? ""}`}>
      {children}
    </span>
  );
}

export function Chg({
  value,
  suffix = "%",
  arrow = true,
  className = "",
}: {
  value: number | null | undefined;
  suffix?: string;
  arrow?: boolean;
  className?: string;
}) {
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

export function FreshnessDot({
  status,
  ageMs,
}: {
  status?: FreshnessStatus | null;
  ageMs?: number | null;
}) {
  const s = status ?? "UNAVAILABLE";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-ink-2"
      title={ageMs != null ? `Dữ liệu cách nguồn ${formatAge(ageMs)}` : s}
    >
      <span className={`inline-block size-1.5 rounded-full ${statusColor[s] ?? "bg-text-muted"}`} />
      {s}
    </span>
  );
}

/** Hidden — source chains clutter the UI; keep export for callers. */
type MetaLineValue =
  | Meta
  | { freshness?: string; ageMs?: number | null; note?: string }
  | null
  | undefined;

export function MetaLine(_props: { meta: MetaLineValue }) {
  return null;
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

export function Spinner({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={`orca-spinner orca-spinner-${size} ${className}`.trim()}
      role="status"
      aria-label="Đang tải"
    />
  );
}

export function Button({
  children,
  loading = false,
  disabled,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
}) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`orca-btn orca-btn-${variant} orca-btn-${size} ${className}`.trim()}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? "md" : "sm"} /> : null}
      <span className={loading ? "opacity-90" : undefined}>{children}</span>
    </button>
  );
}

/**
 * Shared ORCA brand loader — logo + name + subtitle + blinking dots.
 * Centered in the page frame (full) or in the section box (compact).
 */
export function BrandLoading({
  title,
  size = "md",
  full = false,
}: {
  title?: string;
  size?: "sm" | "md" | "lg";
  /** Fill content viewport and center brand in the frame */
  full?: boolean;
}) {
  const mark = size === "lg" ? 64 : size === "sm" ? 36 : 48;
  const nameCls =
    size === "lg"
      ? "text-[18px] sm:text-[20px]"
      : size === "sm"
        ? "text-[13px]"
        : "text-[15px] sm:text-[16px]";
  const subCls = size === "sm" ? "text-[9px]" : "text-[10px] sm:text-[10.5px]";

  const shell = full
    ? "orca-page-loading relative -mx-3 flex w-[calc(100%+1.5rem)] flex-col items-center justify-center px-4 sm:-mx-4 sm:w-[calc(100%+2rem)]"
    : "orca-page-loading flex w-full flex-col items-center justify-center px-3 py-8";

  const minH = full
    ? "calc(100dvh - 7rem)"
    : size === "sm"
      ? "9rem"
      : size === "lg"
        ? "14rem"
        : "11rem";

  return (
    <div
      className={shell}
      style={{ minHeight: minH }}
      aria-busy="true"
      aria-label={title ? `Đang tải ${title}` : "Đang tải"}
    >
      <div className="orca-loading-brand flex flex-col items-center justify-center gap-3 text-center">
        <div className="orca-loading-logo-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/orca-mark.svg"
            alt="ORCA Financial"
            width={mark}
            height={mark}
            className="orca-loading-logo block shrink-0 rounded-lg"
            style={{ width: mark, height: mark }}
            draggable={false}
          />
        </div>
        <div className="flex flex-col items-center gap-1 leading-none">
          <span className={`font-bold tracking-[0.04em] text-text-primary ${nameCls}`}>
            ORCA<span className="text-accent-primary"> FINANCIAL</span>
          </span>
          <span className={`font-medium uppercase tracking-[0.1em] text-text-muted ${subCls}`}>
            Intelligent Investment
          </span>
        </div>
        {title ? (
          <span className="text-[12px] font-medium text-text-secondary">{title}</span>
        ) : null}
        <div className="orca-loading-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

/** Compact inline loader for tab panels / list sections */
export function TabLoading({ label = "Đang tải…" }: { label?: string }) {
  return <BrandLoading size="sm" title={label} />;
}

/**
 * Default loading used across pages & panels.
 * `rows` kept for API compatibility (maps to size / full-frame).
 */
export function Loading({
  rows = 6,
  label,
  full,
}: {
  rows?: number;
  label?: string;
  full?: boolean;
}) {
  const isFull = full ?? rows >= 6;
  const size = isFull || rows >= 8 ? "lg" : rows >= 4 ? "md" : "sm";
  return <BrandLoading size={size as "sm" | "md" | "lg"} title={label} full={isFull} />;
}

export function Unavailable({
  title = "Nguồn dữ liệu chưa khả dụng",
  note,
}: {
  title?: string;
  note?: string | null;
  meta?: Meta | null;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-surface-panel p-5">
      <div className="flex items-center gap-2 text-warn">
        <AlertTriangle className="size-4" />
        <span className="text-[13.5px] font-semibold">{title}</span>
      </div>
      {note && <p className="text-[12px] leading-relaxed text-text-muted">{note}</p>}
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

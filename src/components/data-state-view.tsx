"use client";

import React from "react";
import { AlertCircle, AlertTriangle, Database, Inbox, RefreshCw } from "lucide-react";
import type { FreshnessStatus, Meta } from "@/lib/types";
import { formatAge, Loading } from "@/components/ui";

/**
 * Phase 4 — Standardized 7 Data States for ORCA UI:
 * 1. LOADING: Skeleton or brand loader
 * 2. FRESH / LOADED: Up-to-date payload within SLA
 * 3. DELAYED: Valid data but exceeds fresh SLA
 * 4. STALE: Older than stale SLA threshold
 * 5. DEGRADED / PARTIAL: Incomplete or fallback in effect
 * 6. EMPTY: Valid query but zero records found
 * 7. UNAVAILABLE: Source offline / not yet supported
 * 8. ERROR: Network / HTTP failure with Retry CTA
 */

export type StandardDataState =
  | "loading"
  | "fresh"
  | "delayed"
  | "stale"
  | "degraded"
  | "empty"
  | "unavailable"
  | "error";

export function resolveDataState(args: {
  isLoading?: boolean;
  isValidating?: boolean;
  hasData?: boolean;
  error?: unknown;
  meta?: Meta | null;
  isEmpty?: boolean;
}): StandardDataState {
  if (args.isLoading && !args.hasData) return "loading";
  if (args.error && !args.hasData) return "error";
  if (!args.hasData) return "unavailable";
  if (args.isEmpty) return "empty";

  const status = args.meta?.freshness?.toUpperCase() as FreshnessStatus | undefined;
  if (status === "DELAYED") return "delayed";
  if (status === "STALE" || args.meta?.stale) return "stale";
  if (status === "DEGRADED" || args.meta?.degraded || args.meta?.partial) return "degraded";
  if (status === "UNAVAILABLE") return "unavailable";

  return "fresh";
}

/**
 * Standardized Empty State View.
 */
export function EmptyState({
  title = "Không có dữ liệu",
  description = "Chưa có bản ghi nào phù hợp với điều kiện tìm kiếm hoặc khoảng thời gian đã chọn.",
  actionLabel,
  onAction,
  icon: CustomIcon,
  className = "",
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const Icon = CustomIcon ?? Inbox;
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-panel/40 px-6 py-10 text-center ${className}`.trim()}
    >
      <div className="mb-3 flex size-12 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-text-muted">
        <Icon className="size-6" />
      </div>
      <h4 className="text-[14px] font-semibold text-text-primary">{title}</h4>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-text-muted">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-1.5 text-[12px] font-medium text-text-primary transition hover:border-accent-primary hover:text-accent-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Standardized Error State with Retry Button.
 */
export function ErrorState({
  title = "Không thể tải dữ liệu",
  message,
  onRetry,
  className = "",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-3 rounded-xl border border-down/30 bg-down/10 p-5 ${className}`.trim()}
    >
      <div className="flex items-center gap-2 text-down">
        <AlertCircle className="size-5 shrink-0" />
        <h4 className="text-[13.5px] font-semibold">{title}</h4>
      </div>
      <p className="text-[12px] leading-relaxed text-text-secondary">
        {message || "Đã xảy ra lỗi khi kết nối tới máy chủ hoặc nguồn dữ liệu bên ngoài. Vui lòng thử lại sau giây lát."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-down/40 bg-down/15 px-3 py-1.5 text-[12px] font-semibold text-down transition hover:bg-down/25 active:scale-95"
        >
          <RefreshCw className="size-3.5" />
          Thử lại
        </button>
      )}
    </div>
  );
}

/**
 * Unobtrusive Warning Strip for Stale / Delayed / Degraded data.
 */
export function FreshnessAlertBanner({
  state,
  ageMs,
  note,
  source,
  className = "",
}: {
  state: "delayed" | "stale" | "degraded";
  ageMs?: number | null;
  note?: string;
  source?: string;
  className?: string;
}) {
  const isStale = state === "stale";
  const isDegraded = state === "degraded";

  const colorCls = isStale
    ? "border-warn/30 bg-warn/10 text-warn"
    : isDegraded
      ? "border-down/30 bg-down/10 text-down"
      : "border-warn/25 bg-warn/5 text-warn/90";

  const title = isStale
    ? "Dữ liệu cũ (Stale)"
    : isDegraded
      ? "Nguồn dữ liệu suy giảm (Degraded)"
      : "Dữ liệu cập nhật chậm (Delayed)";

  const defaultMsg = isStale
    ? `Dữ liệu nhận từ ${source ?? "nguồn"} cách đây ${ageMs != null ? formatAge(ageMs) : "lâu"}, đã vượt ngưỡng tươi SLA.`
    : isDegraded
      ? "Một số chỉ số chưa được tính toán đầy đủ hoặc nguồn phụ đang được kích hoạt thay thế."
      : `Dữ liệu chậm hơn nhịp thị trường (${ageMs != null ? formatAge(ageMs) : "trễ"}).`;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${colorCls} ${className}`.trim()}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <span className="font-semibold">{title}: </span>
        <span>{note || defaultMsg}</span>
      </div>
    </div>
  );
}

/**
 * Synchronized Market Metric Badge:
 * Unifies price, unit, percentage, source and timestamp formatting between Card, Chart, and Table.
 */
export function SyncMetricBadge({
  price,
  changePercent,
  unit = "VND",
  source,
  updatedAt,
  freshnessStatus = "LIVE",
}: {
  price?: number | null;
  changePercent?: number | null;
  unit?: string;
  source?: string;
  updatedAt?: number | string | null;
  freshnessStatus?: FreshnessStatus;
}) {
  const up = (changePercent ?? 0) > 0;
  const down = (changePercent ?? 0) < 0;
  const chgColor = up ? "text-up" : down ? "text-down" : "text-text-muted";
  const statusColor =
    freshnessStatus === "LIVE" || freshnessStatus === "FRESH"
      ? "bg-up"
      : freshnessStatus === "DELAYED" || freshnessStatus === "STALE"
        ? "bg-warn"
        : "bg-text-muted";

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-panel/80 px-2.5 py-1 text-[11.5px]">
      {price != null && Number.isFinite(price) && (
        <span className="font-bold text-text-primary num">
          {price.toLocaleString("vi-VN")} <span className="text-[10px] font-normal text-text-muted">{unit}</span>
        </span>
      )}
      {changePercent != null && Number.isFinite(changePercent) && (
        <span className={`font-semibold num ${chgColor}`}>
          {up ? "▲ +" : down ? "▼ " : ""}
          {changePercent.toFixed(2)}%
        </span>
      )}
      {source && (
        <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
          {source}
        </span>
      )}
      <div className="flex items-center gap-1 text-[10.5px] text-text-muted">
        <span className={`inline-block size-1.5 rounded-full ${statusColor}`} />
        <span>{freshnessStatus}</span>
        {updatedAt && (
          <span className="opacity-75">
            · {typeof updatedAt === "number" ? formatAge(Date.now() - updatedAt) : String(updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Universal Container for 7 Data States.
 * Transparently wraps any panel or module content with state compliance.
 */
export function DataStateView({
  state,
  meta,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  loadingRows = 5,
  loadingLabel = "Đang tải dữ liệu…",
  children,
  className = "",
}: {
  state: StandardDataState;
  meta?: Meta | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  loadingRows?: number;
  loadingLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (state === "loading") {
    return <Loading rows={loadingRows} label={loadingLabel} />;
  }

  if (state === "error") {
    return <ErrorState message={meta?.note ?? undefined} onRetry={onRetry} className={className} />;
  }

  if (state === "empty") {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
        className={className}
      />
    );
  }

  if (state === "unavailable") {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-border-subtle bg-surface-panel p-5">
        <div className="flex items-center gap-2 text-warn">
          <Database className="size-4" />
          <span className="text-[13.5px] font-semibold">Nguồn dữ liệu chưa khả dụng</span>
        </div>
        <p className="text-[12px] leading-relaxed text-text-muted">
          {meta?.note || "Dữ liệu cho mã này hiện chưa được đồng bộ từ nguồn ngoài hoặc nhà cung cấp đang tạm dừng cung cấp."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-1.5 text-[12px] font-medium transition hover:border-accent-primary hover:text-accent-primary"
          >
            Thử lại
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {(state === "delayed" || state === "stale" || state === "degraded") && (
        <FreshnessAlertBanner
          state={state}
          ageMs={meta?.sourceTimestampMs ? Date.now() - meta.sourceTimestampMs : null}
          note={meta?.note}
          source={meta?.source}
        />
      )}
      {children}
    </div>
  );
}

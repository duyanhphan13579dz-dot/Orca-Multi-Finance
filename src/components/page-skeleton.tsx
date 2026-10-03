"use client";

import { OrcaMark } from "@/components/logo";

type Variant = "dashboard" | "table" | "detail" | "content" | "form";

/**
 * Route-level loading UI — ORCA brand center + optional page context.
 * Shown while the segment is suspending / page chunk is loading.
 */
export function PageSkeleton({
  variant = "dashboard",
  title,
}: {
  variant?: Variant;
  title?: string;
}) {
  return (
    <div
      className="orca-page-loading flex min-h-[48dvh] flex-col items-center justify-center gap-5 px-4"
      aria-busy="true"
      aria-label="Đang tải trang"
      data-variant={variant}
    >
      <div className="orca-loading-brand flex flex-col items-center gap-3.5">
        <div className="orca-loading-logo-wrap">
          <OrcaMark size={56} className="orca-loading-logo" />
        </div>

        <div className="flex flex-col items-center gap-1 text-center leading-none">
          <span className="text-[17px] font-bold tracking-[0.03em] text-text-primary sm:text-[18px]">
            ORCA<span className="text-accent-primary"> FINANCIAL</span>
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted sm:text-[10.5px]">
            Intelligent Investment
          </span>
        </div>

        {title ? (
          <span className="mt-0.5 text-[12px] font-medium text-text-secondary">{title}</span>
        ) : null}

        <div className="orca-loading-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* Soft structural hint — keeps layout from feeling empty */}
      <div className="mt-2 w-full max-w-2xl opacity-40">
        {variant === "table" && <HintTable />}
        {variant === "detail" && <HintDetail />}
        {(variant === "dashboard" || variant === "content" || variant === "form") && <HintCards />}
      </div>
    </div>
  );
}

function HintCards() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="orca-skeleton h-14 rounded-lg" />
      <div className="orca-skeleton h-14 rounded-lg" />
      <div className="orca-skeleton h-14 rounded-lg" />
    </div>
  );
}

function HintTable() {
  return (
    <div className="space-y-1.5">
      <div className="orca-skeleton h-8 rounded-lg" />
      <div className="orca-skeleton h-8 rounded-lg" />
      <div className="orca-skeleton h-8 rounded-lg" />
    </div>
  );
}

function HintDetail() {
  return (
    <div className="space-y-2">
      <div className="orca-skeleton h-10 w-1/3 rounded-lg" />
      <div className="orca-skeleton h-28 rounded-xl" />
    </div>
  );
}

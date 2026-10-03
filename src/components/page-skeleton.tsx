"use client";

import { OrcaMark } from "@/components/logo";

type Variant = "dashboard" | "table" | "detail" | "content" | "form";

/**
 * Route / panel loading UI — ORCA brand centered in the frame.
 * Logo + name + subtitle + blinking dots.
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
      className="orca-page-loading flex min-h-[min(72dvh,720px)] w-full flex-col items-center justify-center px-4 py-10"
      aria-busy="true"
      aria-label="Đang tải trang"
      data-variant={variant}
    >
      <div className="orca-loading-brand flex flex-col items-center gap-4">
        <div className="orca-loading-logo-wrap">
          <OrcaMark size={64} className="orca-loading-logo" />
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center leading-none">
          <span className="text-[18px] font-bold tracking-[0.03em] text-text-primary sm:text-[20px]">
            ORCA<span className="text-accent-primary"> FINANCIAL</span>
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-text-muted sm:text-[11px]">
            Intelligent Investment
          </span>
        </div>

        {title ? (
          <span className="text-[12.5px] font-medium text-text-secondary">{title}</span>
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

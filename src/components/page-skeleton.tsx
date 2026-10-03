"use client";

import { OrcaMark } from "@/components/logo";

type Variant = "dashboard" | "table" | "detail" | "content" | "form";

/**
 * Route / panel loading UI — logo + name centered in the main content frame.
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
      className="orca-page-loading relative -m-3 flex w-[calc(100%+1.5rem)] items-center justify-center sm:-m-4 sm:w-[calc(100%+2rem)]"
      style={{ minHeight: "calc(100dvh - 3.5rem)" }}
      aria-busy="true"
      aria-label="Đang tải trang"
      data-variant={variant}
    >
      <div className="orca-loading-brand flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="orca-loading-logo-wrap">
          <OrcaMark size={72} className="orca-loading-logo" />
        </div>

        <div className="flex flex-col items-center gap-1.5 leading-none">
          <span className="text-[20px] font-bold tracking-[0.04em] text-text-primary sm:text-[22px]">
            ORCA<span className="text-accent-primary"> FINANCIAL</span>
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
            Intelligent Investment
          </span>
        </div>

        {title ? (
          <span className="text-[13px] font-medium text-text-secondary">{title}</span>
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

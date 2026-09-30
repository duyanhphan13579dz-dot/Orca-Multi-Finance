"use client";

/**
 * ORCA FINANCIAL brand system — sticker orca mark + wordmark.
 * Source asset: /brand/orca-mark.svg (AI-crafted, navy-optimized).
 */

export function OrcaMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/orca-mark.svg"
      alt="ORCA Financial"
      width={size}
      height={size}
      className={`block shrink-0 rounded-lg ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export function OrcaWordmark({
  size = 32,
  subtitle = true,
  className = "",
  compact = false,
}: {
  size?: number;
  subtitle?: boolean;
  className?: string;
  /** Mobile drawer: full visible brand, no aggressive truncate */
  compact?: boolean;
}) {
  return (
    <span
      className={`flex min-w-0 max-w-full items-center gap-2.5 overflow-hidden ${className}`}
    >
      <OrcaMark size={size} />
      <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden leading-tight">
        <span
          className={
            compact
              ? "whitespace-nowrap text-[14px] font-bold tracking-[0.02em] text-text-primary"
              : "truncate text-[13px] font-bold tracking-[0.03em] text-text-primary sm:text-[14px] sm:tracking-[0.04em]"
          }
        >
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        {subtitle ? (
          <span
            className={
              compact
                ? "mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-text-muted"
                : "mt-0.5 truncate text-[8px] font-medium uppercase tracking-[0.12em] text-text-muted sm:text-[8.5px] sm:tracking-[0.18em]"
            }
          >
            Intelligent Investment
          </span>
        ) : null}
      </span>
    </span>
  );
}

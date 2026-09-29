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
}: {
  size?: number;
  subtitle?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <OrcaMark size={size} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="truncate text-[14px] font-bold tracking-[0.04em] text-text-primary">
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        {subtitle ? (
          <span className="mt-0.5 truncate text-[8.5px] font-medium uppercase tracking-[0.18em] text-text-muted">
            Intelligent Investment
          </span>
        ) : null}
      </span>
    </span>
  );
}

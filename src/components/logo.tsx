"use client";

/**
 * ORCA FINANCIAL brand system — sticker orca mark + wordmark.
 * Source asset: /brand/orca-mark.png (AI-crafted, navy-optimized).
 */

export function OrcaMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/orca-mark.png"
      alt="ORCA Financial"
      width={size}
      height={size}
      className={`shrink-0 rounded-lg ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export function OrcaWordmark({ size = 32, subtitle = true }: { size?: number; subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <OrcaMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-[0.06em] text-text-primary">
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        {subtitle && <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.22em] text-text-muted">Intelligent Investment</span>}
      </span>
    </span>
  );
}

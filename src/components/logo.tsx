"use client";

/**
 * ORCA FINANCIAL brand system — sticker orca mark + wordmark.
 * Source asset: /brand/orca-mark.svg
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
      <OrcaMark size={size} className="shrink-0" />
      <span className="flex min-w-0 flex-col justify-center leading-none">
        <span className="whitespace-nowrap text-[13px] font-bold tracking-[0.02em] text-text-primary">
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        {subtitle ? (
          <span className="mt-0.5 whitespace-nowrap text-[8px] font-medium uppercase tracking-[0.06em] text-text-muted">
            Intelligent Investment
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Mobile drawer brand — full logo + name + slogan, no overflow clip.
 */
export function OrcaMobileBrand({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <OrcaMark size={36} className="shrink-0" />
      <span className="flex flex-col gap-0.5 leading-none">
        <span className="whitespace-nowrap text-[15px] font-bold tracking-wide text-text-primary">
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Intelligent Investment
        </span>
      </span>
    </span>
  );
}

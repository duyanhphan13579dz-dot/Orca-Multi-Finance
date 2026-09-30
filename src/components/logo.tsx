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
  const titlePx = size >= 32 ? 15 : size >= 28 ? 14 : 13;
  const subPx = size >= 32 ? 9.5 : size >= 28 ? 9 : 8;

  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <OrcaMark size={size} className="shrink-0" />
      <span className="flex min-w-0 flex-col justify-center gap-0.5 leading-none">
        <span
          className="whitespace-nowrap font-bold tracking-[0.02em] text-text-primary"
          style={{ fontSize: titlePx }}
        >
          ORCA<span className="text-accent-primary"> FINANCIAL</span>
        </span>
        {subtitle ? (
          <span
            className="whitespace-nowrap font-medium uppercase tracking-[0.05em] text-text-muted"
            style={{ fontSize: subPx }}
          >
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

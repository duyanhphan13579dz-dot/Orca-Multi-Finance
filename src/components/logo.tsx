"use client";

import { useState } from "react";

/**
 * ORCA FINANCIAL brand system — sticker orca mark + wordmark.
 * Asset ưu tiên: /brand/orca-logo.png (logo shield do chủ sở hữu cung cấp —
 * đặt file tên `orca-logo.png` trong public/brand/).
 * Fallback: /brand/orca-mark.svg (asset chính thức đã commit) — không bao giờ
 * hiển thị ảnh vỡ.
 */

const PNG_SRC = "/brand/orca-logo.png";
const SVG_SRC = "/brand/orca-mark.svg";

export function OrcaMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const [src, setSrc] = useState(PNG_SRC);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="ORCA Financial"
      width={size}
      height={size}
      className={`shrink-0 rounded-lg ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
      onError={() => {
        if (src !== SVG_SRC) setSrc(SVG_SRC);
      }}
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

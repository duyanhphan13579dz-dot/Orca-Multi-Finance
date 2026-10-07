"use client";

import { fmtCompact } from "@/components/ui";

/** Khối hiển thị giá / CP lưu hành / vốn hóa từ market snapshot */
export function ValuationMarketStrip({
  price,
  sharesOutstanding,
  marketCap,
  fmtPrice,
}: {
  price: number;
  sharesOutstanding?: number | null;
  marketCap?: number | null;
  fmtPrice: (n: number | null | undefined) => string;
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-border-subtle/80 bg-surface-elevated/40 px-2.5 py-2 text-[11px]">
      <div>
        <div className="text-[9.5px] uppercase tracking-wider text-ink-3">Giá TT</div>
        <div className="num font-semibold text-ink">{fmtPrice(price)}</div>
      </div>
      <div>
        <div className="text-[9.5px] uppercase tracking-wider text-ink-3">CP lưu hành</div>
        <div className="num font-semibold text-ink">
          {sharesOutstanding != null ? fmtCompact(sharesOutstanding) : "—"}
        </div>
      </div>
      <div>
        <div className="text-[9.5px] uppercase tracking-wider text-ink-3">Vốn hóa</div>
        <div className="num font-semibold text-ink">
          {marketCap != null ? fmtCompact(marketCap) : "—"}
        </div>
      </div>
    </div>
  );
}

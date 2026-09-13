"use client";

import { useMemo } from "react";

const SYMBOL_MAP: Record<string, string> = {
  VNINDEX: "HOSE:VNINDEX",
  VN30: "HOSE:VN30",
  VN100: "HOSE:VN100",
  HNXINDEX: "HNX:HNXINDEX",
  HNX30: "HNX:HNX30",
  UPCOM: "HNX:UPCOMINDEX",
  UPCOMINDEX: "HNX:UPCOMINDEX",
};

function tradingViewSymbol(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SYMBOL_MAP[normalized] ?? `HOSE:${normalized}`;
}

export function TradingViewChartWidget({ code, title }: { code: string; title?: string }) {
  const symbol = useMemo(() => tradingViewSymbol(code), [code]);
  const src = useMemo(() => {
    const params = new URLSearchParams({
      symbol,
      interval: "D",
      theme: "dark",
      style: "1",
      locale: "vi_VN",
      timezone: "Asia/Ho_Chi_Minh",
      withdateranges: "1",
      hide_side_toolbar: "0",
      hide_top_toolbar: "0",
      hide_legend: "0",
      saveimage: "0",
      hideideas: "1",
      studies: "[]",
    });
    return `https://www.tradingview.com/widgetembed/?${params.toString()}`;
  }, [symbol]);

  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-background-secondary" aria-label="TradingView chart tham chiếu">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold text-text-primary">TradingView tham chiếu</h2>
          <p className="mt-0.5 text-[10.5px] text-text-muted">{title ?? symbol} · dữ liệu và chart do TradingView cung cấp</p>
        </div>
        <span className="rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 text-[10px] font-medium text-text-muted">External widget</span>
      </header>
      <div className="relative h-[430px] w-full bg-[#0b1220]">
        <iframe
          title={`TradingView chart ${symbol}`}
          src={src}
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          referrerPolicy="origin"
          allow="fullscreen"
        />
      </div>
      <footer className="border-t border-border-subtle px-3.5 py-2 text-[10px] leading-relaxed text-text-muted">
        Chart tham chiếu độc lập. Dữ liệu này không được lưu, chuẩn hóa hoặc dùng làm nguồn cho API/analytics của Orca.
      </footer>
    </section>
  );
}

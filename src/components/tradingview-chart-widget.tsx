"use client";

import { useMemo, useState } from "react";

const SYMBOL_MAP: Record<string, string> = {
  VNINDEX: "HOSE:VNINDEX",
  VN30: "HOSE:VN30",
  VN100: "HOSE:VN100",
  HNXINDEX: "HNX:HNXINDEX",
  HNX30: "HNX:HNX30",
  UPCOM: "HNX:UPCOMINDEX",
  UPCOMINDEX: "HNX:UPCOMINDEX",
};

function tradingViewSymbol(code: string, exchange?: string | null): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (SYMBOL_MAP[normalized]) return SYMBOL_MAP[normalized];

  const market = exchange?.toUpperCase().replace(/[^A-Z]/g, "");
  const prefix = market === "HNX" || market === "UPCOM" ? market : "HOSE";
  return `${prefix}:${normalized}`;
}

export function TradingViewChartWidget({
  code,
  exchange,
  title,
}: {
  code: string;
  exchange?: string | null;
  title?: string;
}) {
  const symbol = useMemo(() => tradingViewSymbol(code, exchange), [code, exchange]);
  const preferenceKey = useMemo(() => `orca:tradingview-widget:${symbol}:visible`, [symbol]);
  const [visible, setVisible] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem(preferenceKey) !== "false",
  );

  const toggleVisible = () => {
    setVisible((current) => {
      const next = !current;
      window.localStorage.setItem(preferenceKey, String(next));
      return next;
    });
  };

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
          <p className="mt-0.5 text-[10.5px] text-text-muted">{title ?? symbol} · {symbol} · dữ liệu và chart do TradingView cung cấp</p>
        </div>
        <button
          type="button"
          onClick={toggleVisible}
          className="rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-[10.5px] font-medium text-text-secondary transition hover:border-accent-primary hover:text-text-primary"
          aria-expanded={visible}
        >
          {visible ? "Ẩn chart" : "Hiện chart"}
        </button>
      </header>
      {visible ? (
        <>
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
        </>
      ) : (
        <div className="px-3.5 py-3 text-[11px] text-text-muted">Chart đang được ẩn trên thiết bị này cho mã {code.toUpperCase()}.</div>
      )}
    </section>
  );
}

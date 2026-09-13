"use client";

import { useEffect, useState } from "react";
import { ValuationPanel } from "@/components/stocks/valuation-panel";

export default function StockValuationPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  if (!symbol) {
    return <div className="p-4 text-[12px] text-ink-3">Đang tải…</div>;
  }

  return (
    <div className="stock-workspace">
      <ValuationPanel symbol={symbol} showAnalyst />
    </div>
  );
}

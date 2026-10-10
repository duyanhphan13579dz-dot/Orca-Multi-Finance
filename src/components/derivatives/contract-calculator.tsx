"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui";
import { Calculator, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";

interface ContractCalculatorProps {
  symbol: string;
  currentPrice: number;
  multiplier?: number; // 100,000 VND / point
}

export function ContractCalculator({
  symbol,
  currentPrice,
  multiplier = 100_000,
}: ContractCalculatorProps) {
  const [position, setPosition] = useState<"LONG" | "SHORT">("LONG");
  const [contracts, setContracts] = useState<number>(1);
  const [entryPrice, setEntryPrice] = useState<string>(currentPrice > 0 ? currentPrice.toFixed(1) : "1300.0");
  const [exitPrice, setExitPrice] = useState<string>(
    currentPrice > 0 ? (currentPrice + (position === "LONG" ? 6.0 : -6.0)).toFixed(1) : "1306.0",
  );

  const parsedEntry = Number(entryPrice) || currentPrice;
  const parsedExit = Number(exitPrice) || currentPrice;

  // Tỷ lệ ký quỹ VSDC quy chuẩn 17%
  const MARGIN_RATE = 0.17;

  const results = useMemo(() => {
    const notional = parsedEntry * multiplier * contracts;
    const marginRequired = notional * MARGIN_RATE;

    const diffPoints = position === "LONG" ? parsedExit - parsedEntry : parsedEntry - parsedExit;
    const grossPnl = diffPoints * multiplier * contracts;
    const roiOnMargin = marginRequired > 0 ? (grossPnl / marginRequired) * 100 : 0;

    // Ước tính phí giao dịch (phí sở HNX + phí môi giới ~ 25.000đ/HĐ/chiều)
    const fees = contracts * 50_000;
    const netPnl = grossPnl - fees;

    return {
      notional,
      marginRequired,
      diffPoints,
      grossPnl,
      netPnl,
      roiOnMargin,
      fees,
    };
  }, [parsedEntry, parsedExit, contracts, position, multiplier]);

  return (
    <Panel
      className="h-full !flex !flex-col min-h-0 [&_.panel-body]:!flex-1 [&_.panel-body]:!min-h-0 [&_.panel-body]:!overflow-y-auto [&_.panel-body]:!py-3 [&_.panel-body]:!px-3.5"
      title={
        <span className="flex items-center gap-2">
          <Calculator className="size-4 text-accent-primary" /> Máy tính Ký quỹ & Vị thế · {symbol}
        </span>
      }
    >
      <div className="space-y-3.5 text-xs">
        {/* 1. Chọn vị thế & Số HĐ */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-text-muted mb-1 block">Vị thế giao dịch</label>
            <div className="seg grid grid-cols-2">
              <button
                type="button"
                data-active={position === "LONG"}
                onClick={() => setPosition("LONG")}
                className="py-1 text-xs font-semibold data-[active=true]:!bg-emerald-500/20 data-[active=true]:!text-emerald-400"
              >
                LONG
              </button>
              <button
                type="button"
                data-active={position === "SHORT"}
                onClick={() => setPosition("SHORT")}
                className="py-1 text-xs font-semibold data-[active=true]:!bg-rose-500/20 data-[active=true]:!text-rose-400"
              >
                SHORT
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-text-muted mb-1 block">Số hợp đồng (HĐ)</label>
            <div className="flex items-center gap-1">
              {[1, 2, 5, 10].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setContracts(num)}
                  className={`flex-1 rounded py-1 border text-xs font-medium transition-colors ${
                    contracts === num
                      ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
                      : "border-border-subtle bg-surface-base text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Nhập Giá mở & Giá đóng */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-text-muted mb-1 block">Giá vào lệnh (Entry)</label>
            <input
              type="number"
              step="0.1"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="input w-full py-1.5 px-2 text-xs font-semibold num"
            />
          </div>

          <div>
            <label className="text-[11px] text-text-muted mb-1 block">Giá mục tiêu (Exit)</label>
            <input
              type="number"
              step="0.1"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              className="input w-full py-1.5 px-2 text-xs font-semibold num"
            />
          </div>
        </div>

        {/* 3. Kết quả Ký quỹ & Đòn bẩy */}
        <div className="rounded-lg border border-border-subtle bg-surface-base p-3 space-y-2">
          <div className="flex items-center justify-between text-text-muted">
            <span>Ký quỹ ban đầu VSDC (17%)</span>
            <span className="font-semibold text-text-primary num">
              {(results.marginRequired).toLocaleString("vi-VN")} ₫
            </span>
          </div>

          <div className="flex items-center justify-between text-text-muted">
            <span>Tổng giá trị danh nghĩa</span>
            <span className="font-medium text-text-secondary num">
              {(results.notional).toLocaleString("vi-VN")} ₫
            </span>
          </div>

          <div className="flex items-center justify-between text-text-muted border-t border-border-subtle/60 pt-2">
            <span>Đòn bẩy thực tế</span>
            <span className="font-semibold text-amber-400">~5.9x</span>
          </div>
        </div>

        {/* 4. Kết quả Lợi nhuận / Lỗ dự kiến */}
        <div
          className={`rounded-lg border p-3 ${
            results.netPnl >= 0
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/5 text-rose-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-muted">
              Lãi / Lỗ ròng dự kiến (sau phí)
            </span>
            <span className="text-[11px] font-semibold num">
              {results.diffPoints >= 0 ? "+" : ""}
              {results.diffPoints.toFixed(1)} điểm
            </span>
          </div>

          <div className="mt-1 flex items-baseline justify-between">
            <div className="text-lg font-bold num">
              {results.netPnl >= 0 ? "+" : ""}
              {results.netPnl.toLocaleString("vi-VN")} ₫
            </div>
            <div className="text-xs font-bold num">
              {results.roiOnMargin >= 0 ? "+" : ""}
              {results.roiOnMargin.toFixed(2)}% vốn
            </div>
          </div>
        </div>

        {/* 5. Ghi chú quy chuẩn */}
        <div className="text-[10px] text-text-muted flex items-start gap-1">
          <ShieldCheck className="size-3 shrink-0 text-accent-primary mt-0.5" />
          <span>
            Quy cách: 1 điểm = 100.000 ₫ · Bước giá 0.1 điểm · Biên độ trần sàn ±7% theo quy chế HNX/VSDC.
          </span>
        </div>
      </div>
    </Panel>
  );
}

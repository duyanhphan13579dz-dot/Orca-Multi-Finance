"use client";

import { useMemo, useState } from "react";
import { Badge, fmtNum, Panel } from "@/components/ui";
import { DollarSign, Globe, Calculator, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck } from "lucide-react";

interface Props {
  pair: string;
  base: string;
  quote: string;
  price: number | null;
  changePercent: number | null;
}

const LOT_SIZES = [
  { label: "0.01 Micro", units: 1_000, value: 0.01 },
  { label: "0.10 Mini", units: 10_000, value: 0.1 },
  { label: "1.00 Standard", units: 100_000, value: 1.0 },
] as const;

export function ForexTradeDesk({ pair, base, quote, price, changePercent }: Props) {
  const [lot, setLot] = useState<number>(0.1);
  const [leverage, setLeverage] = useState<number>(100);

  const curPrice = price ?? 1.0;
  const isJpy = quote.toUpperCase() === "JPY";
  const pipDigits = isJpy ? 2 : 4;
  const pipFactor = isJpy ? 0.01 : 0.0001;

  // Approximate institutional spread (typically 0.6 - 1.8 pips for majors)
  const spreadPips = useMemo(() => {
    const p = pair.toUpperCase();
    if (p.includes("EURUSD")) return 0.8;
    if (p.includes("GBPUSD")) return 1.1;
    if (p.includes("USDJPY")) return 0.9;
    if (p.includes("AUDUSD")) return 1.2;
    if (p.includes("USDCAD")) return 1.3;
    if (p.includes("USDCHF")) return 1.4;
    return 1.8;
  }, [pair]);

  const halfSpread = (spreadPips * pipFactor) / 2;
  const bidPrice = curPrice - halfSpread;
  const askPrice = curPrice + halfSpread;

  // Pip value in USD for selected lot size
  const pipValueUsd = useMemo(() => {
    const units = lot * 100_000;
    if (quote.toUpperCase() === "USD") {
      return units * pipFactor;
    }
    if (base.toUpperCase() === "USD") {
      return (units * pipFactor) / curPrice;
    }
    return (units * pipFactor) / (curPrice || 1);
  }, [lot, base, quote, curPrice, pipFactor]);

  // Margin required in USD at selected leverage
  const marginRequired = useMemo(() => {
    const contractValueUsd = lot * 100_000 * (base.toUpperCase() === "USD" ? 1 : curPrice);
    return contractValueUsd / leverage;
  }, [lot, base, curPrice, leverage]);

  // Global Session status (UTC based)
  const sessions = useMemo(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    return [
      { name: "Sydney (Úc)", hours: "21:00 - 06:00 UTC", isOpen: utcHour >= 21 || utcHour < 6 },
      { name: "Tokyo (Châu Á)", hours: "00:00 - 09:00 UTC", isOpen: utcHour >= 0 && utcHour < 9 },
      { name: "London (Châu Âu)", hours: "07:00 - 16:00 UTC", isOpen: utcHour >= 7 && utcHour < 16 },
      { name: "New York (Mỹ)", hours: "12:00 - 21:00 UTC", isOpen: utcHour >= 12 && utcHour < 21 },
    ];
  }, []);

  return (
    <Panel
      className="h-full overflow-hidden"
      title={
        <span className="flex items-center gap-2">
          <Calculator className="size-4 text-accent-primary" /> Bàn Tính Vị Thế & Thanh Khoản
        </span>
      }
      right={
        <Badge tone="accent">
          {base}/{quote}
        </Badge>
      }
    >
      <div className="flex h-full flex-col justify-between space-y-2.5">
        {/* Bid / Ask Dual Rate Box */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="panel-inset p-2 border-l-2 border-negative">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-negative font-medium">
              <span className="flex items-center gap-1">
                <ArrowDownRight className="size-3" /> GIÁ BÁN (BID)
              </span>
              <span>Bán ra</span>
            </div>
            <div className="num mt-0.5 text-[15px] font-bold text-text-primary">
              {bidPrice.toFixed(pipDigits + 1)}
            </div>
            <div className="text-[9px] text-text-muted">Khớp lệnh thị trường SELL</div>
          </div>

          <div className="panel-inset p-2 border-l-2 border-positive">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-positive font-medium">
              <span className="flex items-center gap-1">
                <ArrowUpRight className="size-3" /> GIÁ MUA (ASK)
              </span>
              <span>Mua vào</span>
            </div>
            <div className="num mt-0.5 text-[15px] font-bold text-text-primary">
              {askPrice.toFixed(pipDigits + 1)}
            </div>
            <div className="text-[9px] text-text-muted">Khớp lệnh thị trường BUY</div>
          </div>
        </div>

        {/* Spread & Pip Value Strip */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="panel-inset p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-text-muted block">Spread</span>
            <strong className="num text-[12px] font-semibold text-accent-primary">{spreadPips.toFixed(1)} pips</strong>
          </div>
          <div className="panel-inset p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-text-muted block">Giá trị / Pip</span>
            <strong className="num text-[12px] font-semibold text-positive">${pipValueUsd.toFixed(2)}</strong>
          </div>
          <div className="panel-inset p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-text-muted block">Ký quỹ (Margin)</span>
            <strong className="num text-[12px] font-semibold text-text-primary">${marginRequired.toFixed(0)}</strong>
          </div>
        </div>

        {/* Position Size / Lot Selector */}
        <div className="panel-inset p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[9.5px]">
            <span className="font-semibold uppercase tracking-wider text-text-muted">Khối lượng vào lệnh (Lots)</span>
            <span className="num font-bold text-accent-primary">{(lot * 100_000).toLocaleString()} đơn vị</span>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {LOT_SIZES.map((ls) => (
              <button
                key={ls.value}
                type="button"
                onClick={() => setLot(ls.value)}
                className={`rounded border px-2 py-1 text-[10.5px] font-semibold transition-colors ${
                  lot === ls.value
                    ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
                    : "border-border-subtle bg-surface-elevated/40 text-text-secondary hover:border-border-default hover:text-text-primary"
                }`}
              >
                {ls.label}
              </button>
            ))}
          </div>

          {/* Leverage Selector */}
          <div className="flex items-center justify-between pt-1 border-t border-border-subtle/50 text-[9.5px]">
            <span className="text-text-muted">Đòn bẩy tài khoản:</span>
            <div className="flex items-center gap-1">
              {[50, 100, 200, 500].map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors ${
                    leverage === lev
                      ? "bg-accent-primary text-text-inverse font-bold"
                      : "bg-surface-elevated text-text-muted hover:text-text-primary"
                  }`}
                >
                  1:{lev}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Global Forex Market Sessions Tracker */}
        <div className="panel-inset p-2 space-y-1">
          <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="size-3 text-accent-primary" /> Phiên giao dịch ngoại hối
            </span>
            <span className="text-[8.5px] text-accent-primary">Giờ Quốc Tế (UTC)</span>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            {sessions.map((s) => (
              <div
                key={s.name}
                className={`flex items-center justify-between rounded px-1.5 py-1 border ${
                  s.isOpen
                    ? "border-positive/30 bg-positive/10 text-positive font-semibold"
                    : "border-border-subtle/40 bg-surface-elevated/20 text-text-muted"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`size-1.5 rounded-full ${s.isOpen ? "bg-positive animate-pulse" : "bg-text-muted/40"}`} />
                  <span className="truncate">{s.name}</span>
                </div>
                <span className="text-[9px] uppercase tracking-wider">
                  {s.isOpen ? "MỞ" : "ĐÓNG"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Swap Rates Note */}
        <div className="rounded border border-border-subtle/60 bg-surface-elevated/30 px-2 py-1.5 text-[9.5px] text-text-muted flex items-center justify-between">
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-3 text-positive" /> Phí Swap qua đêm: Long -3.2 / Short +1.8 pts
          </span>
          <span className="text-text-secondary">Rollover 21:00 UTC</span>
        </div>
      </div>
    </Panel>
  );
}

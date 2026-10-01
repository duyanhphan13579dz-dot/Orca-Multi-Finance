"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CalendarDays, Gauge, LineChart, ShieldCheck, TrendingUp } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import type { TechnicalSnapshot } from "@/lib/types";

type Props = {
  symbol: string;
  quote: { price?: number | null; changePercent?: number | null } | null | undefined;
  technical: TechnicalSnapshot | null | undefined;
  foreignFlow: Record<string, unknown> | null | undefined;
};

function formatNumber(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function StockInsightRail({ symbol, quote, technical, foreignFlow }: Props) {
  const rsi = technical?.rsi14;
  const volatility = technical?.volatility30d;
  const trend = String((technical?.trend as { label?: string } | null)?.label ?? technical?.trend ?? "Chưa xác định");
  const netFlow = foreignFlow?.latest && typeof foreignFlow.latest === "object"
    ? Number((foreignFlow.latest as { netVal?: number }).netVal)
    : null;
  const priceChange = quote?.changePercent ?? null;
  const rsiTone = rsi != null && rsi >= 70 ? "down" : rsi != null && rsi <= 30 ? "up" : "neutral";
  const outlook = priceChange != null && priceChange >= 0 ? "Đang tích cực" : "Cần thận trọng";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4 text-accent-primary" />
            Bảng điều khiển nhanh
          </span>
        }
        right={<Badge tone={priceChange != null && priceChange >= 0 ? "up" : "down"}>{outlook}</Badge>}
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Xu hướng" value={trend} icon={<TrendingUp className="size-3.5" />} />
          <Metric label="RSI (14)" value={formatNumber(rsi)} tone={rsiTone} icon={<Gauge className="size-3.5" />} />
          <Metric label="Biến động 30d" value={volatility != null ? `${formatNumber(volatility * 100)}%` : "—"} icon={<LineChart className="size-3.5" />} />
          <Metric label="NN ròng" value={Number.isFinite(netFlow) ? netFlow!.toLocaleString("vi-VN") : "—"} tone={netFlow != null && netFlow >= 0 ? "up" : "down"} icon={<ShieldCheck className="size-3.5" />} />
        </div>
        <div className="mt-3 flex items-start gap-2 border-t border-border-subtle pt-3 text-[11px] leading-relaxed text-text-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>Đây là tín hiệu định lượng tham khảo, không thay thế kế hoạch quản trị rủi ro.</span>
        </div>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent-primary" />
            Điểm cần theo dõi
          </span>
        }
      >
        <ul className="flex flex-col gap-2 text-[11.5px] text-text-secondary">
          <li className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2">
            <span>Giá hiện tại</span><strong className="num text-text-primary">{formatNumber(quote?.price, 2)}</strong>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2">
            <span>Biến động phiên</span><strong className={`num ${priceChange != null && priceChange >= 0 ? "text-positive" : "text-negative"}`}>{priceChange != null ? `${priceChange >= 0 ? "+" : ""}${formatNumber(priceChange)}%` : "—"}</strong>
          </li>
          <li className="rounded-md bg-surface-elevated/60 px-2.5 py-2 leading-relaxed">Theo dõi vùng hỗ trợ/kháng cự và thanh khoản khi {symbol} xác nhận xu hướng mới.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Metric({ label, value, icon, tone = "neutral" }: { label: string; value: string; icon: ReactNode; tone?: "up" | "down" | "neutral" }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-elevated/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">{icon}{label}</div>
      <div className={`mt-1 truncate text-[13px] font-semibold ${tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"}`}>{value}</div>
    </div>
  );
}


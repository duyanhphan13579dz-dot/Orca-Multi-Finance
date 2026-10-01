import { ArrowDownRight, ArrowUpRight, CalendarDays, Gauge, ShieldAlert, TrendingUp } from "lucide-react";
import { getForexDetail } from "@/lib/services/forex";
import type { TechnicalSnapshot } from "@/lib/types";
import { Badge, Chg, Panel, PanelMetric, Unavailable } from "@/components/ui";

function fmt(value: number | null | undefined, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

function trendLabel(technical: TechnicalSnapshot | null) {
  const label = technical?.trend.label;
  if (label === "strong-up" || label === "up") return { text: "Tăng", tone: "up" as const };
  if (label === "strong-down" || label === "down") return { text: "Giảm", tone: "down" as const };
  return { text: "Đi ngang", tone: "neutral" as const };
}

export async function ForexDetailPage({ pair }: { pair: string }) {
  const result = await getForexDetail(pair);
  if (!result) return <Unavailable title="Cặp tiền chưa khả dụng" note={`Không có dữ liệu cho ${pair}.`} />;

  const { detail } = result;
  const trend = trendLabel(detail.technical);
  const current = detail.current;
  const technical = detail.technical;
  const latestSignal = technical?.signals?.[0] ?? "Chưa có tín hiệu nổi bật";
  const support = technical?.support?.[0];
  const resistance = technical?.resistance?.[0];

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={`${detail.base}/${detail.quote}`}
        subtitle="Chi tiết ngoại hối · phân tích kỹ thuật"
        right={<Badge tone={trend.tone}>{trend.text}</Badge>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PanelMetric label="Giá hiện tại" value={current ? fmt(current.price) : "—"} detail={current ? <Chg value={current.changePercent} /> : undefined} tone={current?.changePercent && current.changePercent > 0 ? "up" : current?.changePercent && current.changePercent < 0 ? "down" : "neutral"} />
          <PanelMetric label="RSI 14" value={fmt(technical?.rsi14, 2)} detail={technical?.rsi14 && technical.rsi14 > 70 ? "Quá mua" : technical?.rsi14 && technical.rsi14 < 30 ? "Quá bán" : "Trung tính"} tone={technical?.rsi14 && (technical.rsi14 > 70 || technical.rsi14 < 30) ? "warn" : "neutral"} />
          <PanelMetric label="Biến động 30 ngày" value={technical?.volatility30d != null ? `${fmt(technical.volatility30d, 2)}%` : "—"} detail="Annualized" />
          <PanelMetric label="Drawdown tối đa" value={technical?.maxDrawdown != null ? `${fmt(technical.maxDrawdown, 2)}%` : "—"} detail="Theo chuỗi giá" tone="down" />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <Panel title="Tín hiệu & động lượng" subtitle="Tổng hợp từ các chỉ báo hiện có">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md border border-line/60 bg-surface-elevated/40 p-3">
              <Gauge className="mt-0.5 size-4 text-accent" />
              <div><div className="text-[12px] font-semibold">{latestSignal}</div><div className="mt-1 text-[11px] text-ink-3">Xu hướng hiện tại: {trend.text.toLowerCase()}.</div></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-line/60 p-2.5"><div className="text-[10px] text-ink-3">MACD histogram</div><div className="num mt-1 text-[13px]">{fmt(technical?.macd?.histogram, 5)}</div></div>
              <div className="rounded-md border border-line/60 p-2.5"><div className="text-[10px] text-ink-3">SMA 20</div><div className="num mt-1 text-[13px]">{fmt(technical?.sma.sma20)}</div></div>
              <div className="rounded-md border border-line/60 p-2.5"><div className="text-[10px] text-ink-3">ATR 14</div><div className="num mt-1 text-[13px]">{fmt(technical?.atr14)}</div></div>
            </div>
          </div>
        </Panel>

        <Panel title="Mốc quan trọng" subtitle="Vùng giá tham chiếu">
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-md border border-down/20 bg-down/5 px-3 py-2"><span className="flex items-center gap-2 text-[11px] text-ink-2"><ArrowDownRight className="size-3.5 text-down" /> Kháng cự gần</span><strong className="num text-[12px]">{fmt(resistance)}</strong></div>
            <div className="flex items-center justify-between rounded-md border border-up/20 bg-up/5 px-3 py-2"><span className="flex items-center gap-2 text-[11px] text-ink-2"><ArrowUpRight className="size-3.5 text-up" /> Hỗ trợ gần</span><strong className="num text-[12px]">{fmt(support)}</strong></div>
            <div className="flex items-center justify-between border-t border-line/60 pt-2 text-[11px]"><span className="text-ink-3">52 tuần</span><span className="num">{fmt(technical?.low52w)} — {fmt(technical?.high52w)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PanelMetric label="Hiệu suất 7 ngày" value={technical?.returns.d7 != null ? `${technical.returns.d7 > 0 ? "+" : ""}${fmt(technical.returns.d7, 2)}%` : "—"} tone={technical?.returns.d7 && technical.returns.d7 > 0 ? "up" : "down"} />
        <PanelMetric label="Hiệu suất 30 ngày" value={technical?.returns.d30 != null ? `${technical.returns.d30 > 0 ? "+" : ""}${fmt(technical.returns.d30, 2)}%` : "—"} tone={technical?.returns.d30 && technical.returns.d30 > 0 ? "up" : "down"} />
        <PanelMetric label="Dữ liệu tham chiếu" value="Realtime / cached" detail={detail.referenceNote} />
      </div>

      <div className="flex items-center gap-2 text-[10px] text-ink-3"><TrendingUp className="size-3.5" /> Cập nhật theo nguồn dữ liệu hiện có · <CalendarDays className="size-3.5" /> Phân tích kỹ thuật tự động <ShieldAlert className="ml-2 size-3.5 text-warn" /> Không phải khuyến nghị đầu tư</div>
    </div>
  );
}

export default ForexDetailPage;

import { BarChart3, LineChart, ShieldAlert, PieChart } from "lucide-react";
import { Panel } from "@/components/ui";
import type { PortfolioSnapshot } from "@/lib/portfolio";

const assetColors: Record<string, string> = {
  stock: "#60a5fa",
  crypto: "#c084fc",
  forex: "#34d399",
  commodity: "#fbbf24",
};

function maxAbs(values: number[]) {
  return Math.max(1, ...values.map((value) => Math.abs(value)));
}

function formatAsset(label: string) {
  return ({ stock: "Cổ phiếu", crypto: "Crypto", forex: "Forex", commodity: "Hàng hóa" } as Record<string, string>)[label] ?? label;
}

export function PortfolioInsights({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const performance = snapshot.performanceByAsset;
  const pnlScale = maxAbs(performance.map((item) => item.pnl));
  const allocationTotal = snapshot.allocation.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title={<span className="flex items-center gap-2"><LineChart className="size-4 text-accent-primary" /> Hiệu quả đầu tư</span>}>
        <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
          <span className="rounded border border-border-subtle px-2 py-1">Theo nhật ký giao dịch</span>
          <span className="rounded border border-border-subtle px-2 py-1">PnL sau phí</span>
        </div>
        {performance.length ? (
          <div className="space-y-2.5">
            {performance.map((item) => {
              const width = Math.max(3, (Math.abs(item.pnl) / pnlScale) * 100);
              return <div key={item.label}>
                <div className="mb-1 flex justify-between text-[11px]"><span>{formatAsset(item.label)}</span><span className={item.pnl >= 0 ? "text-positive" : "text-negative"}>{item.pnl >= 0 ? "+" : ""}{item.pnl.toFixed(2)} · {item.winRate == null ? "—" : `${(item.winRate * 100).toFixed(0)}% thắng`}</span></div>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-elevated"><div className={`rounded-full ${item.pnl >= 0 ? "bg-positive" : "bg-negative"}`} style={{ width: `${width}%` }} /></div>
              </div>;
            })}
          </div>
        ) : <Empty text="Chưa đủ giao dịch đóng để đánh giá hiệu quả." />}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-[11px]
          "><Mini label="Expectancy" value={snapshot.expectancy == null ? "—" : snapshot.expectancy.toFixed(2)} /><Mini label="Avg R" value={snapshot.averageR == null ? "—" : `${snapshot.averageR.toFixed(2)}R`} /><Mini label="Max DD" value={snapshot.maxDrawdown ? snapshot.maxDrawdown.toFixed(2) : "—"} /></div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><PieChart className="size-4 text-sky-400" /> Phân bổ tài sản</span>}>
        {snapshot.allocation.length ? <div className="space-y-3">
          <div className="flex h-4 overflow-hidden rounded-full bg-surface-elevated" aria-label="Biểu đồ phân bổ tài sản">{snapshot.allocation.map((item) => <div key={item.label} title={`${formatAsset(item.label)} ${(item.percentage * 100).toFixed(0)}%`} style={{ width: `${item.percentage * 100}%`, backgroundColor: assetColors[item.label] ?? "#94a3b8" }} />)}</div>
          {snapshot.allocation.map((item) => <div key={item.label} className="flex items-center gap-2 text-[11px]"><span className="size-2 rounded-full" style={{ backgroundColor: assetColors[item.label] ?? "#94a3b8" }} /><span className="flex-1">{formatAsset(item.label)}</span><span className="num text-text-muted">{allocationTotal ? item.value.toFixed(2) : "—"}</span><span className="num font-medium">{(item.percentage * 100).toFixed(0)}%</span></div>)}
        </div> : <Empty text="Chưa có vị thế để tính phân bổ." />}
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><BarChart3 className="size-4 text-amber-400" /> Rủi ro theo nhóm tài sản</span>}>
        {snapshot.volatilityByAsset.length ? <div className="space-y-3">{snapshot.volatilityByAsset.map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-[11px]"><span>{formatAsset(item.label)}</span><span className={item.level === "high" || item.level === "extreme" ? "text-negative" : "text-text-muted"}>{item.volatilityPct == null ? "Chưa đủ dữ liệu" : `${item.volatilityPct.toFixed(2)}% biến động`} · {item.exposurePct.toFixed(0)}% exposure</span></div><div className="h-2 rounded-full bg-surface-elevated"><div className={`h-full rounded-full ${item.level === "extreme" || item.level === "high" ? "bg-negative" : item.level === "elevated" ? "bg-warning" : "bg-positive"}`} style={{ width: `${Math.min(100, item.volatilityPct ?? 0)}%` }} /></div></div>)}</div> : <Empty text="Chưa đủ mark để đo biến động." />}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/20 bg-warning/5 p-2 text-[10px] text-text-muted"><ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> Rủi ro được suy ra từ volatility, exposure và khoảng cách tới stop-loss; không thay thế tư vấn đầu tư.</div>
      </Panel>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] text-text-muted">{label}</div><div className="num mt-0.5 font-medium">{value}</div></div>; }
function Empty({ text }: { text: string }) { return <p className="py-5 text-center text-[11px] text-text-muted">{text}</p>; }

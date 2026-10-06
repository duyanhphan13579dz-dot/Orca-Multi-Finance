"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Calculator, ChevronDown, Clock3, Info, Layers3, ShieldAlert, TrendingUp } from "lucide-react";

const contracts = [
  { symbol: "VN30F1M", expiry: "16/10/2026", price: 1_878.2, change: 0.42, volume: "184.2K", oi: "32.8K", basis: 2.4 },
  { symbol: "VN30F2M", expiry: "20/11/2026", price: 1_880.6, change: 0.36, volume: "38.6K", oi: "21.4K", basis: 4.8 },
  { symbol: "VN30F3M", expiry: "18/12/2026", price: 1_883.1, change: 0.29, volume: "5.2K", oi: "8.7K", basis: 7.3 },
];

const curve = [
  { label: "F1M", value: 1878.2, oi: 32.8 },
  { label: "F2M", value: 1880.6, oi: 21.4 },
  { label: "F3M", value: 1883.1, oi: 8.7 },
  { label: "F4M", value: 1886.4, oi: 3.1 },
];

const flowSignals = [
  { title: "Long build-up", desc: "Giá ↑ · OI ↑ · Volume ↑", tone: "positive", score: "78%" },
  { title: "Basis mở rộng", desc: "Premium tăng so với phiên trước", tone: "warning", score: "+1.8đ" },
  { title: "Spot xác nhận", desc: "VN30 tăng 0,31% · breadth tích cực", tone: "positive", score: "Đồng thuận" },
];

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        <Info className="size-4 text-text-muted" aria-label="Thông tin" />
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function DerivativesDashboard() {
  const [selected, setSelected] = useState("VN30F1M");
  const [side, setSide] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState(1878.2);
  const [contractsCount, setContractsCount] = useState(1);
  const active = contracts.find((item) => item.symbol === selected) ?? contracts[0];
  const pnl = useMemo(() => (active.price - entry) * 100_000 * contractsCount * (side === "long" ? 1 : -1), [active.price, entry, contractsCount, side]);
  const maxCurve = Math.max(...curve.map((item) => item.value));

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span className="rounded-full border border-accent-primary/30 bg-accent-primary/10 px-2 py-0.5 text-accent-primary">DERIVATIVES INTELLIGENCE</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-positive" /> HNX · Delayed 15 phút</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Thị trường phái sinh</h1>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-text-secondary">VN30 Futures là lớp thanh khoản cốt lõi. Theo dõi giá, OI, basis và flow trong cùng một góc nhìn.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[11px] text-text-secondary"><Clock3 className="size-3.5 text-accent-primary" /> Cập nhật 09:42:18 · 06/10/2026</div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {contracts.map((item) => {
            const isActive = item.symbol === selected;
            return <button key={item.symbol} onClick={() => setSelected(item.symbol)} className={`rounded-lg border p-3 text-left transition-colors ${isActive ? "border-accent-primary/50 bg-accent-primary/10" : "border-border-subtle bg-surface-elevated/40 hover:border-border-default"}`} aria-pressed={isActive}>
              <div className="flex items-center justify-between"><span className="text-[12px] font-semibold">{item.symbol}</span><span className="text-[10px] text-text-muted">Đáo hạn {item.expiry}</span></div>
              <div className="mt-2 flex items-baseline justify-between"><span className="num text-lg font-semibold">{formatNumber(item.price)}</span><span className="flex items-center gap-0.5 text-[12px] text-positive"><ArrowUpRight className="size-3" /> +{formatNumber(item.change, 2)}%</span></div>
              <div className="mt-2 flex gap-4 text-[10px] text-text-muted"><span>Vol <b className="num text-text-secondary">{item.volume}</b></span><span>OI <b className="num text-text-secondary">{item.oi}</b></span><span>Basis <b className="num text-positive">+{item.basis}</b></span></div>
            </button>;
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
        <Panel title="Price · OI · Volume" subtitle="VN30F1M · 5 phút · dữ liệu mô phỏng cho lớp hiển thị">
          <div className="mb-4 flex flex-wrap items-center gap-2"><span className="seg"><button data-active="true">Giá</button><button>OI</button><button>Volume</button></span><span className="ml-auto text-[10px] text-text-muted">Biên độ ngày 1.864,8 — 1.882,6</span></div>
          <div className="relative h-56 overflow-hidden rounded-lg border border-border-subtle bg-background-primary/70 p-3">
            <div className="absolute inset-x-3 top-7 border-t border-border-subtle/70" /><div className="absolute inset-x-3 top-1/2 border-t border-border-subtle/70" /><div className="absolute inset-x-3 bottom-7 border-t border-border-subtle/70" />
            <div className="flex h-full items-end gap-1.5 px-1 pb-2 pt-4">{[35,43,40,55,50,62,58,68,64,74,70,82,76,88,84,91,86,95,92,98].map((height, index) => <div key={index} className="group relative flex h-full flex-1 items-end"><div className="w-full rounded-t-sm bg-accent-primary/60 transition-colors group-hover:bg-accent-primary" style={{ height: `${height}%` }} /><div className="absolute bottom-0 left-1/2 h-[2px] w-1 -translate-x-1/2 rounded-full bg-white/80" /></div>)}</div>
            <div className="absolute right-3 top-3 rounded-md border border-positive/20 bg-positive/10 px-2 py-1 text-[11px] text-positive">1.878,2</div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><div><span className="text-text-muted">OI change</span><p className="mt-0.5 font-semibold text-positive">+6,42%</p></div><div><span className="text-text-muted">Volume / avg</span><p className="mt-0.5 font-semibold">1,34x</p></div><div><span className="text-text-muted">Volatility 20D</span><p className="mt-0.5 font-semibold text-warning">18,7%</p></div></div>
        </Panel>

        <Panel title="Basis monitor" subtitle="Futures − VN30 spot"><div className="rounded-lg border border-border-subtle bg-surface-elevated/50 p-3"><div className="flex items-end justify-between"><div><p className="text-[11px] text-text-muted">VN30 spot</p><p className="num mt-1 text-xl font-semibold">1.875,8</p></div><div className="text-right"><p className="text-[11px] text-text-muted">Basis</p><p className="num mt-1 text-xl font-semibold text-positive">+2,4</p></div></div><div className="mt-4 h-2 rounded-full bg-border-subtle"><div className="h-2 w-[64%] rounded-full bg-gradient-to-r from-accent-primary to-positive" /></div><div className="mt-2 flex justify-between text-[10px] text-text-muted"><span>Discount</span><span>Premium · +0,13%</span></div></div><div className="mt-4 flex flex-col gap-2">{contracts.map((item) => <div key={item.symbol} className="flex items-center justify-between text-[11px]"><span className="text-text-secondary">{item.symbol}</span><span className="num text-positive">+{item.basis.toFixed(1)} điểm</span></div>)}</div><div className="mt-4 rounded-md border border-warning/20 bg-warning/5 p-2.5 text-[10px] leading-relaxed text-text-secondary">Premium đang mở rộng. Chỉ đọc cùng thời gian đáo hạn, chi phí vốn và trạng thái spot.</div></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Futures curve" subtitle="Snapshot hiện tại · VN30 Index"><div className="flex items-end justify-between gap-3 pt-2">{curve.map((item) => <div key={item.label} className="flex flex-1 flex-col items-center gap-2"><span className="num text-[10px] text-text-secondary">{formatNumber(item.value)}</span><div className="flex h-32 w-full items-end justify-center rounded-t-md bg-accent-primary/5"><div className="w-2/3 rounded-t-md bg-accent-primary/70" style={{ height: `${(item.value / maxCurve) * 92}%` }} /></div><span className="text-[10px] font-medium text-text-muted">{item.label}</span><span className="num text-[10px] text-text-muted">OI {item.oi}K</span></div>)}</div><div className="mt-4 flex items-center gap-2 border-t border-border-subtle pt-3 text-[11px]"><TrendingUp className="size-4 text-positive" /><span className="text-text-secondary">Contango nhẹ</span><span className="ml-auto num text-positive">F4 − F1: +8,2 điểm</span></div></Panel>
        <Panel title="Flow engine" subtitle="Model signal · Không phải vị thế Long/Short thực tế"><div className="flex flex-col gap-2.5">{flowSignals.map((signal) => <div key={signal.title} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3"><div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${signal.tone === "positive" ? "bg-positive/10 text-positive" : "bg-warning/10 text-warning"}`}>{signal.tone === "positive" ? <ArrowUpRight className="size-4" /> : <Layers3 className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{signal.title}</p><p className="mt-0.5 truncate text-[10px] text-text-muted">{signal.desc}</p></div><span className={`text-[11px] font-semibold ${signal.tone === "positive" ? "text-positive" : "text-warning"}`}>{signal.score}</span></div>)}</div><div className="mt-3 flex items-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-[10px] text-text-muted"><ShieldAlert className="size-3.5 text-warning" /> Confidence cao hơn khi giá, OI, volume và basis đồng thuận.</div></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Risk calculator" subtitle="Mô phỏng P/L · multiplier theo Contract Master"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><label className="flex flex-col gap-1 text-[10px] text-text-muted">Side<select value={side} onChange={(e) => setSide(e.target.value as "long" | "short")} className="rounded-md border border-border-subtle bg-surface-elevated px-2 py-2 text-[12px] text-text-primary"><option value="long">Long</option><option value="short">Short</option></select></label><label className="flex flex-col gap-1 text-[10px] text-text-muted">Entry<input type="number" value={entry} onChange={(e) => setEntry(Number(e.target.value))} className="num rounded-md border border-border-subtle bg-surface-elevated px-2 py-2 text-[12px] text-text-primary" /></label><label className="flex flex-col gap-1 text-[10px] text-text-muted">Contracts<input type="number" min={1} max={50} value={contractsCount} onChange={(e) => setContractsCount(Number(e.target.value))} className="num rounded-md border border-border-subtle bg-surface-elevated px-2 py-2 text-[12px] text-text-primary" /></label><div className="rounded-md border border-border-subtle bg-surface-elevated px-3 py-2"><span className="block text-[10px] text-text-muted">P/L hiện tại</span><span className={`num mt-1 block text-lg font-semibold ${pnl >= 0 ? "text-positive" : "text-negative"}`}>{pnl >= 0 ? "+" : ""}{pnl.toLocaleString("vi-VN")} đ</span></div></div><div className="mt-3 flex items-center gap-2 text-[10px] text-text-muted"><Calculator className="size-3.5" /> Notional ước tính: <b className="num text-text-secondary">{(active.price * 100_000 * contractsCount).toLocaleString("vi-VN")} đ</b> · multiplier 100.000 VNĐ/điểm</div></Panel>
        <Panel title="AI market brief" subtitle="Bản tóm tắt có điều kiện · Model signal"><div className="rounded-lg border border-accent-primary/20 bg-accent-primary/5 p-3 text-[12px] leading-relaxed text-text-secondary"><p><span className="font-semibold text-accent-primary">VN30F1M</span> đang ở trạng thái nghiêng tăng nhẹ: giá tăng cùng OI và volume, trong khi basis duy trì premium so với VN30. Tổ hợp hiện phù hợp với <span className="font-semibold text-text-primary">long build-up</span> hơn là short covering.</p><p className="mt-2">Kịch bản tích cực chỉ được xác nhận nếu giá giữ trên vùng 1.875 và OI không suy giảm mạnh. Rủi ro chính: basis thu hẹp nhanh, volatility tăng hoặc thanh khoản chuyển sang hợp đồng kế tiếp.</p></div><div className="mt-3 flex items-center justify-between text-[10px] text-text-muted"><span>Nguồn: HNX · VSDC · Orca Flow Engine v0.1</span><span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-1 text-warning">Không phải khuyến nghị</span></div></Panel>
      </div>

      <div className="panel overflow-hidden"><div className="panel-header"><div><h2 className="panel-title">Sản phẩm theo dõi</h2><p className="panel-subtitle">VN100 và HĐTL TPCP được giữ ở lớp monitoring cho đến khi thanh khoản đủ sâu.</p></div><ChevronDown className="size-4 text-text-muted" /></div><div className="grid grid-cols-1 divide-y divide-border-subtle md:grid-cols-3 md:divide-x md:divide-y-0"><div className="p-3 text-[11px]"><div className="flex justify-between"><b>VN100F</b><span className="text-text-muted">P2</span></div><p className="mt-1 text-text-muted">Volume 66 HĐ/phiên · OI 77</p></div><div className="p-3 text-[11px]"><div className="flex justify-between"><b>TPCP 5Y</b><span className="text-text-muted">P3</span></div><p className="mt-1 text-text-muted">Chưa có giao dịch trong kỳ báo cáo</p></div><div className="p-3 text-[11px]"><div className="flex justify-between"><b>Commodity Futures</b><span className="text-accent-primary">Tier 2</span></div><p className="mt-1 text-text-muted">Kết nối sau lớp Hàng hóa hiện tại</p></div></div></div>
      <p className="px-1 text-[10px] leading-relaxed text-text-muted">Dữ liệu trên màn hình là lớp preview giao diện theo đặc tả nghiên cứu. Trước khi bật realtime cần hoàn tất quyền sử dụng market data, Contract Master versioning và nguồn HNX/VSDC chính thức.</p>
    </div>
  );
}

export default DerivativesDashboard;

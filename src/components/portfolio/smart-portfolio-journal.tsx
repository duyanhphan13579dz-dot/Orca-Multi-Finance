"use client";

import { useState } from "react";
import { Badge, Panel, fmtNum } from "@/components/ui";
import { NotebookPen, Plus, Trash2 } from "lucide-react";
import type { PortfolioTrade } from "@/lib/portfolio";

type JournalForm = {
  symbol: string;
  entry: string;
  exit: string;
  stopLoss: string;
  takeProfit: string;
  size: string;
  leverage: string;
  strategy: string;
  emotion: string;
  notes: string;
  side: "long" | "short";
  assetType: PortfolioTrade["assetType"];
};

const initialForm: JournalForm = {
  symbol: "", entry: "", exit: "", stopLoss: "", takeProfit: "", size: "", leverage: "",
  strategy: "", emotion: "", notes: "", side: "long", assetType: "crypto",
};

function pnlOf(trade: PortfolioTrade): number | null {
  if (trade.exit == null) return null;
  const direction = trade.side === "long" ? 1 : -1;
  return (trade.exit - trade.entry) * direction * (trade.size ?? 1) * (trade.leverage ?? 1);
}

function rOf(trade: PortfolioTrade): number | null {
  if (trade.exit == null || trade.stopLoss == null || trade.stopLoss === trade.entry) return null;
  const direction = trade.side === "long" ? 1 : -1;
  const risk = (trade.entry - trade.stopLoss) * direction;
  return risk > 0 ? ((trade.exit - trade.entry) * direction) / risk : null;
}

export function SmartPortfolioJournal({ trades, onChange }: { trades: PortfolioTrade[]; onChange: (trades: PortfolioTrade[]) => void }) {
  const [form, setForm] = useState<JournalForm>(initialForm);
  const [showForm, setShowForm] = useState(false);

  const persist = (next: PortfolioTrade[]) => {
    onChange(next);
    localStorage.setItem("orca.journal.v1", JSON.stringify(next));
    window.dispatchEvent(new Event("orca:journal"));
  };

  const add = () => {
    if (!form.symbol.trim() || !form.entry || !Number.isFinite(Number(form.entry))) return;
    const trade: PortfolioTrade = {
      id: crypto.randomUUID(),
      assetType: form.assetType,
      symbol: form.symbol.trim().toUpperCase(),
      side: form.side,
      entry: Number(form.entry),
      exit: form.exit ? Number(form.exit) : null,
      stopLoss: form.stopLoss ? Number(form.stopLoss) : null,
      takeProfit: form.takeProfit ? Number(form.takeProfit) : null,
      size: form.size ? Number(form.size) : null,
      leverage: form.leverage ? Number(form.leverage) : null,
      strategy: form.strategy.trim(),
      emotion: form.emotion.trim(),
      notes: form.notes.trim(),
      openedAt: Date.now(),
      closedAt: form.exit ? Date.now() : null,
    };
    persist([trade, ...trades]);
    setForm({ ...initialForm, assetType: form.assetType });
    setShowForm(false);
  };

  return (
    <div className="space-y-3">
      <Panel title={<span className="flex items-center gap-2"><NotebookPen className="size-4 text-accent-primary" /> Nhật ký lệnh</span>} right={<button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary/15 px-2.5 py-1.5 text-[11px] font-medium text-accent-primary"><Plus className="size-3.5" /> {showForm ? "Đóng form" : "Thêm lệnh"}</button>}>
        <p className="text-[11px] text-text-muted">Ghi entry, exit, SL, TP, chiến lược và cảm xúc để Smart Portfolio đánh giá hiệu suất lẫn kỷ luật giao dịch.</p>
      </Panel>

      {showForm && <Panel title="Lệnh mới"><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        <Field label="Loại tài sản"><select value={form.assetType} onChange={(event) => setForm({ ...form, assetType: event.target.value as PortfolioTrade["assetType"] })} className="input"><option value="crypto">Crypto</option><option value="stock">Cổ phiếu</option><option value="forex">Forex</option><option value="commodity">Hàng hóa</option></select></Field>
        <Field label="Mã"><input className="input" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} placeholder="BTCUSDT / FPT / EURUSD" /></Field>
        <Field label="Phía"><select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as "long" | "short" })} className="input"><option value="long">Long</option><option value="short">Short</option></select></Field>
        <Field label="Entry"><input className="input" type="number" value={form.entry} onChange={(event) => setForm({ ...form, entry: event.target.value })} /></Field>
        <Field label="Exit (trống nếu đang mở)"><input className="input" type="number" value={form.exit} onChange={(event) => setForm({ ...form, exit: event.target.value })} /></Field>
        <Field label="Stop loss"><input className="input" type="number" value={form.stopLoss} onChange={(event) => setForm({ ...form, stopLoss: event.target.value })} /></Field>
        <Field label="Take profit"><input className="input" type="number" value={form.takeProfit} onChange={(event) => setForm({ ...form, takeProfit: event.target.value })} /></Field>
        <Field label="Size"><input className="input" type="number" value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} /></Field>
        <Field label="Leverage"><input className="input" type="number" value={form.leverage} onChange={(event) => setForm({ ...form, leverage: event.target.value })} /></Field>
        <Field label="Chiến lược"><input className="input" value={form.strategy} onChange={(event) => setForm({ ...form, strategy: event.target.value })} placeholder="breakout, trend..." /></Field>
        <Field label="Cảm xúc"><input className="input" value={form.emotion} onChange={(event) => setForm({ ...form, emotion: event.target.value })} placeholder="calm, FOMO..." /></Field>
        <Field label="Ghi chú" className="sm:col-span-2 md:col-span-3"><input className="input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      </div><button type="button" onClick={add} className="mt-3 rounded-md bg-accent-primary/20 px-3 py-1.5 text-[12px] font-medium text-accent-primary">Lưu lệnh vào Smart Portfolio</button></Panel>}

      <Panel pad={false} title={`Lịch sử giao dịch · ${trades.length} lệnh`}>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr className="border-b border-border-subtle text-[10px] uppercase tracking-wide text-text-muted"><th className="py-2 pl-3.5">Mã</th><th className="py-2">Phía</th><th className="py-2 text-right">Entry</th><th className="py-2 text-right">Exit</th><th className="py-2 text-right">SL / TP</th><th className="py-2 text-right">PnL</th><th className="py-2 text-right">R</th><th className="py-2">Chiến lược</th><th className="py-2 pr-3.5" /></tr></thead><tbody>{trades.map((trade) => { const pnl = pnlOf(trade); const r = rOf(trade); return <tr key={trade.id} className="border-b border-border-subtle/60"><td className="py-2 pl-3.5"><span className="font-semibold">{trade.symbol}</span><span className="ml-1 text-[10px] text-text-muted">{trade.assetType}</span></td><td className="py-2"><Badge tone={trade.side === "long" ? "up" : "down"}>{trade.side}</Badge></td><td className="num py-2 text-right">{fmtNum(trade.entry, 4)}</td><td className="num py-2 text-right">{trade.exit == null ? <Badge tone="accent">đang mở</Badge> : fmtNum(trade.exit, 4)}</td><td className="num py-2 text-right text-text-muted">{trade.stopLoss ?? "—"} / {trade.takeProfit ?? "—"}</td><td className={`num py-2 text-right ${pnl == null ? "text-text-muted" : pnl >= 0 ? "text-positive" : "text-negative"}`}>{pnl == null ? "—" : fmtNum(pnl, 2)}</td><td className="num py-2 text-right">{r == null ? "—" : `${r.toFixed(2)}R`}</td><td className="max-w-40 truncate py-2 text-text-muted" title={trade.notes}>{trade.strategy || "—"}</td><td className="py-2 pr-3.5 text-right"><button type="button" onClick={() => persist(trades.filter((item) => item.id !== trade.id))} className="text-text-muted hover:text-negative" aria-label={`Xóa lệnh ${trade.symbol}`}><Trash2 className="size-3.5" /></button></td></tr>; })}{!trades.length && <tr><td colSpan={9} className="py-10 text-center text-text-muted">Chưa có lệnh. Thêm giao dịch để bắt đầu đánh giá danh mục.</td></tr>}</tbody></table></div>
      </Panel>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={className}><span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">{label}</span>{children}</label>;
}

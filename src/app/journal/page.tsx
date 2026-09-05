"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, fmtNum, Panel } from "@/components/ui";
import { NotebookPen, Plus, Trash2 } from "lucide-react";

interface Trade {
  id: string;
  assetType: "crypto" | "stock" | "forex" | "commodity";
  symbol: string;
  side: "long" | "short";
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  size: number | null;
  leverage: number | null;
  strategy: string;
  emotion: string;
  notes: string;
  openedAt: number;
  closedAt: number | null;
}

const KEY = "orca.journal.v1";
const load = (): Trade[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Trade[];
  } catch {
    return [];
  }
};

function pnlOf(t: Trade): number | null {
  if (t.exit == null) return null;
  const dir = t.side === "long" ? 1 : -1;
  const base = (t.exit - t.entry) * dir;
  return base * (t.size ?? 1) * (t.leverage ?? 1);
}
function rOf(t: Trade): number | null {
  if (t.exit == null || t.stopLoss == null || t.stopLoss === t.entry) return null;
  const dir = t.side === "long" ? 1 : -1;
  const risk = (t.entry - t.stopLoss) * dir;
  if (risk <= 0) return null;
  return ((t.exit - t.entry) * dir) / risk;
}

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [form, setForm] = useState({ symbol: "", entry: "", exit: "", stopLoss: "", takeProfit: "", size: "", leverage: "", strategy: "", emotion: "", notes: "", side: "long" as "long" | "short", assetType: "crypto" as Trade["assetType"] });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => setTrades(load()), []);
  const persist = (t: Trade[]) => {
    setTrades(t);
    localStorage.setItem(KEY, JSON.stringify(t));
  };

  const add = () => {
    if (!form.symbol || !form.entry) return;
    const t: Trade = {
      id: crypto.randomUUID(),
      assetType: form.assetType,
      symbol: form.symbol.toUpperCase(),
      side: form.side,
      entry: Number(form.entry),
      exit: form.exit ? Number(form.exit) : null,
      stopLoss: form.stopLoss ? Number(form.stopLoss) : null,
      takeProfit: form.takeProfit ? Number(form.takeProfit) : null,
      size: form.size ? Number(form.size) : null,
      leverage: form.leverage ? Number(form.leverage) : null,
      strategy: form.strategy,
      emotion: form.emotion,
      notes: form.notes,
      openedAt: Date.now(),
      closedAt: form.exit ? Date.now() : null,
    };
    persist([t, ...trades]);
    setShowForm(false);
    setForm({ ...form, symbol: "", entry: "", exit: "", strategy: "", notes: "", emotion: "" });
  };

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.exit != null);
    const wins = closed.filter((t) => (pnlOf(t) ?? 0) > 0);
    const rs = closed.map(rOf).filter((x): x is number => x != null);
    return {
      total: trades.length,
      closed: closed.length,
      winrate: closed.length ? (wins.length / closed.length) * 100 : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      totalPnl: closed.reduce((a, t) => a + (pnlOf(t) ?? 0), 0),
    };
  }, [trades]);

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Panel pad={false}>
        <div className="flex items-center justify-between p-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold"><NotebookPen className="size-5 text-accent" /> Nhật ký giao dịch</h1>
            <p className="mt-0.5 text-[12px] text-ink-3">Lưu cục bộ — PnL & R-multiple tự tính. Đồng bộ tài khoản khi đăng nhập (server tables đã sẵn sàng).</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 rounded-md bg-accent/90 px-3 py-2 text-[12px] font-semibold text-canvas hover:bg-accent">
            <Plus className="size-4" /> Ghi lệnh
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Tổng lệnh" value={String(stats.total)} />
        <Stat label="Đã đóng" value={String(stats.closed)} />
        <Stat label="Winrate" value={stats.winrate != null ? `${stats.winrate.toFixed(0)}%` : "—"} />
        <Stat label="Avg R" value={stats.avgR != null ? stats.avgR.toFixed(2) : "—"} />
        <Stat label="Tổng PnL" value={stats.closed ? fmtNum(stats.totalPnl, 2) : "—"} tone={stats.totalPnl >= 0 ? "up" : "down"} />
      </div>

      {showForm && (
        <Panel title="Lệnh mới" pad>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <F label="Mã" v={form.symbol} set={(v) => setForm({ ...form, symbol: v })} placeholder="BTCUSDT / HPG / EURUSD" />
            <label>
              <L>Loại tài sản</L>
              <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value as Trade["assetType"] })} className="input">
                <option value="crypto">Crypto</option><option value="stock">Cổ phiếu</option><option value="forex">Forex</option><option value="commodity">Hàng hóa</option>
              </select>
            </label>
            <label>
              <L>Hướng</L>
              <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "long" | "short" })} className="input">
                <option value="long">Long</option><option value="short">Short</option>
              </select>
            </label>
            <F label="Entry" v={form.entry} set={(v) => setForm({ ...form, entry: v })} num />
            <F label="Exit (nếu đóng)" v={form.exit} set={(v) => setForm({ ...form, exit: v })} num />
            <F label="Stop loss" v={form.stopLoss} set={(v) => setForm({ ...form, stopLoss: v })} num />
            <F label="Take profit" v={form.takeProfit} set={(v) => setForm({ ...form, takeProfit: v })} num />
            <F label="Size" v={form.size} set={(v) => setForm({ ...form, size: v })} num />
            <F label="Đòn bẩy" v={form.leverage} set={(v) => setForm({ ...form, leverage: v })} num />
            <F label="Chiến lược" v={form.strategy} set={(v) => setForm({ ...form, strategy: v })} placeholder="Momentum, mean reversion…" />
            <F label="Tâm lý" v={form.emotion} set={(v) => setForm({ ...form, emotion: v })} placeholder="Bình tĩnh / FOMO…" />
            <label className="col-span-2 md:col-span-2">
              <L>Ghi chú</L>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" placeholder="Bối cảnh vào lệnh, điều học được…" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={add} className="rounded-md bg-accent/90 px-3 py-1.5 text-[12px] font-semibold text-canvas hover:bg-accent">Lưu lệnh</button>
            <button onClick={() => setShowForm(false)} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-2">Hủy</button>
          </div>
        </Panel>
      )}

      <Panel title={`Lịch sử (${trades.length})`} pad={false}>
        {trades.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-3">Chưa có lệnh nào được ghi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2 font-medium">Mã</th>
                  <th className="py-2 font-medium">Hướng</th>
                  <th className="py-2 text-right font-medium">Entry</th>
                  <th className="py-2 text-right font-medium">Exit</th>
                  <th className="py-2 text-right font-medium">SL / TP</th>
                  <th className="py-2 text-right font-medium">PnL</th>
                  <th className="py-2 text-right font-medium">R</th>
                  <th className="py-2 font-medium">Chiến lược</th>
                  <th className="py-2 pr-3.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pnl = pnlOf(t);
                  const r = rOf(t);
                  return (
                    <tr key={t.id} className="row-hover border-b border-line/40">
                      <td className="px-3.5 py-2 font-semibold">{t.symbol} <span className="text-[10px] font-normal text-ink-3">{t.assetType}</span></td>
                      <td className="py-2"><Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge></td>
                      <td className="num py-2 text-right">{fmtNum(t.entry, 4)}</td>
                      <td className="num py-2 text-right">{t.exit != null ? fmtNum(t.exit, 4) : <Badge tone="accent">đang mở</Badge>}</td>
                      <td className="num py-2 text-right text-ink-3">{t.stopLoss ?? "—"} / {t.takeProfit ?? "—"}</td>
                      <td className={`num py-2 text-right ${pnl == null ? "text-ink-3" : pnl >= 0 ? "text-up" : "text-down"}`}>{pnl != null ? fmtNum(pnl, 2) : "—"}</td>
                      <td className="num py-2 text-right">{r != null ? r.toFixed(2) : "—"}</td>
                      <td className="max-w-40 truncate py-2 text-ink-3" title={t.notes}>{t.strategy || "—"}{t.emotion ? ` · ${t.emotion}` : ""}</td>
                      <td className="py-2 pr-3.5 text-right">
                        <button onClick={() => persist(trades.filter((x) => x.id !== t.id))} className="text-ink-3 hover:text-down" aria-label="Xóa"><Trash2 className="size-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <style jsx global>{`
        .input { width: 100%; border-radius: 8px; border: 1px solid var(--color-line); background: var(--color-panel-2); padding: 7px 10px; font-size: 12px; color: var(--color-ink); }
      `}</style>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-ink-3">{children}</span>;
}
function F({ label, v, set, placeholder, num }: { label: string; v: string; set: (s: string) => void; placeholder?: string; num?: boolean }) {
  return (
    <label>
      <L>{label}</L>
      <input value={v} onChange={(e) => set(e.target.value)} placeholder={placeholder} inputMode={num ? "decimal" : undefined} className="input" />
    </label>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className={`num mt-1 text-[16px] font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>{value}</div>
    </div>
  );
}

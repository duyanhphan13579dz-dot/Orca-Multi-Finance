"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, fmtNum, Panel } from "@/components/ui";
import { NotebookPen, Plus, Trash2 } from "lucide-react";
import { PriceAlertsPanel } from "@/components/journal/price-alerts-panel";
import { PortfolioAiPanel } from "@/components/journal/portfolio-ai-panel";

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
  const [form, setForm] = useState({
    symbol: "",
    entry: "",
    exit: "",
    stopLoss: "",
    takeProfit: "",
    size: "",
    leverage: "",
    strategy: "",
    emotion: "",
    notes: "",
    side: "long" as "long" | "short",
    assetType: "crypto" as Trade["assetType"],
  });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setTrades(load()), 0);
    return () => window.clearTimeout(id);
  }, []);
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
    setForm({
      symbol: "",
      entry: "",
      exit: "",
      stopLoss: "",
      takeProfit: "",
      size: "",
      leverage: "",
      strategy: "",
      emotion: "",
      notes: "",
      side: "long",
      assetType: form.assetType,
    });
    setShowForm(false);
  };

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.exit != null);
    const pnls = closed.map(pnlOf).filter((x): x is number => x != null);
    const wins = pnls.filter((p) => p > 0).length;
    const sum = pnls.reduce((a, b) => a + b, 0);
    return {
      n: trades.length,
      closed: closed.length,
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      pnl: pnls.length ? sum : null,
    };
  }, [trades]);

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <PriceAlertsPanel />

      <PortfolioAiPanel trades={trades} />

      <Panel pad={false}>
        <div className="flex items-center justify-between p-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <NotebookPen className="size-5 text-accent" /> Nhật ký giao dịch
            </h1>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Ghi chép lệnh · tính PnL / R-multiple · lưu trên thiết bị
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary/15 px-3 py-1.5 text-[12px] font-medium text-accent-primary"
          >
            <Plus className="size-4" /> Thêm lệnh
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tổng lệnh" value={String(stats.n)} />
        <Stat label="Đã đóng" value={String(stats.closed)} />
        <Stat
          label="Win rate"
          value={stats.winRate != null ? `${stats.winRate.toFixed(0)}%` : "—"}
          tone={stats.winRate != null && stats.winRate >= 50 ? "up" : undefined}
        />
        <Stat
          label="PnL"
          value={stats.pnl != null ? fmtNum(stats.pnl, 2) : "—"}
          tone={stats.pnl != null ? (stats.pnl >= 0 ? "up" : "down") : undefined}
        />
      </div>

      {showForm && (
        <Panel title="Lệnh mới">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            <label>
              <L>Loại tài sản</L>
              <select
                value={form.assetType}
                onChange={(e) => setForm({ ...form, assetType: e.target.value as Trade["assetType"] })}
                className="input"
              >
                <option value="crypto">Crypto</option>
                <option value="stock">Cổ phiếu</option>
                <option value="forex">Forex</option>
                <option value="commodity">Hàng hóa</option>
              </select>
            </label>
            <label>
              <L>Mã</L>
              <input
                className="input"
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                placeholder="BTC / FPT / EURUSD"
              />
            </label>
            <label>
              <L>Phía</L>
              <select
                value={form.side}
                onChange={(e) => setForm({ ...form, side: e.target.value as "long" | "short" })}
                className="input"
              >
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </label>
            <label>
              <L>Entry</L>
              <input
                className="input"
                type="number"
                value={form.entry}
                onChange={(e) => setForm({ ...form, entry: e.target.value })}
              />
            </label>
            <label>
              <L>Exit (để trống nếu đang mở)</L>
              <input
                className="input"
                type="number"
                value={form.exit}
                onChange={(e) => setForm({ ...form, exit: e.target.value })}
              />
            </label>
            <label>
              <L>Stop loss</L>
              <input
                className="input"
                type="number"
                value={form.stopLoss}
                onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
              />
            </label>
            <label>
              <L>Take profit</L>
              <input
                className="input"
                type="number"
                value={form.takeProfit}
                onChange={(e) => setForm({ ...form, takeProfit: e.target.value })}
              />
            </label>
            <label>
              <L>Size</L>
              <input
                className="input"
                type="number"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
              />
            </label>
            <label>
              <L>Leverage</L>
              <input
                className="input"
                type="number"
                value={form.leverage}
                onChange={(e) => setForm({ ...form, leverage: e.target.value })}
              />
            </label>
            <label>
              <L>Chiến lược</L>
              <input
                className="input"
                value={form.strategy}
                onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              />
            </label>
            <label>
              <L>Cảm xúc</L>
              <input
                className="input"
                value={form.emotion}
                onChange={(e) => setForm({ ...form, emotion: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 md:col-span-3">
              <L>Ghi chú</L>
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <button
            onClick={add}
            className="mt-3 rounded-md bg-accent-primary/20 px-3 py-1.5 text-[12px] font-medium text-accent-primary"
          >
            Lưu lệnh
          </button>
        </Panel>
      )}

      <Panel pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pl-3.5 font-medium">Mã</th>
                <th className="py-2 font-medium">Phía</th>
                <th className="py-2 text-right font-medium">Entry</th>
                <th className="py-2 text-right font-medium">Exit</th>
                <th className="py-2 text-right font-medium">SL / TP</th>
                <th className="py-2 text-right font-medium">PnL</th>
                <th className="py-2 text-right font-medium">R</th>
                <th className="py-2 font-medium">Ghi chú</th>
                <th className="py-2 pr-3.5" />
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const pnl = pnlOf(t);
                const r = rOf(t);
                return (
                  <tr key={t.id} className="border-b border-line/60">
                    <td className="py-2 pl-3.5">
                      <span className="font-semibold">{t.symbol}</span>
                      <span className="ml-1 text-[10px] font-normal text-ink-3">{t.assetType}</span>
                    </td>
                    <td className="py-2">
                      <Badge tone={t.side === "long" ? "up" : "down"}>{t.side}</Badge>
                    </td>
                    <td className="num py-2 text-right">{fmtNum(t.entry, 4)}</td>
                    <td className="num py-2 text-right">
                      {t.exit != null ? fmtNum(t.exit, 4) : <Badge tone="accent">đang mở</Badge>}
                    </td>
                    <td className="num py-2 text-right text-ink-3">
                      {t.stopLoss ?? "—"} / {t.takeProfit ?? "—"}
                    </td>
                    <td
                      className={`num py-2 text-right ${
                        pnl == null ? "text-ink-3" : pnl >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {pnl != null ? fmtNum(pnl, 2) : "—"}
                    </td>
                    <td className="num py-2 text-right">{r != null ? r.toFixed(2) : "—"}</td>
                    <td className="max-w-40 truncate py-2 text-ink-3" title={t.notes}>
                      {t.strategy || "—"}
                      {t.emotion ? ` · ${t.emotion}` : ""}
                    </td>
                    <td className="py-2 pr-3.5 text-right">
                      <button
                        onClick={() => persist(trades.filter((x) => x.id !== t.id))}
                        className="text-ink-3 hover:text-down"
                        aria-label="Xóa"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!trades.length && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-ink-3">
                    Chưa có lệnh — bấm Thêm lệnh để ghi nhật ký.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-line/70 bg-bg-2/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div
        className={`mt-0.5 text-[16px] font-semibold tabular-nums ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">{children}</span>;
}

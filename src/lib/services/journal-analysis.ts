import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";
import { buildMeta } from "../freshness";
import { getVnQuotes } from "./stocks";
import { getCryptoDetail } from "./crypto";
import type { Meta } from "../types";

export type JournalTradeInput = {
  assetType: string;
  symbol: string;
  side: "long" | "short" | string;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  size: number | null;
  leverage: number | null;
  strategy: string;
  emotion: string;
  notes: string;
  openedAt?: number;
  closedAt?: number | null;
};

export type OpenMark = {
  symbol: string;
  assetType: string;
  side: string;
  entry: number;
  mark: number | null;
  unrealizedPnl: number | null;
  distToSlPct: number | null;
  distToTpPct: number | null;
  strategy: string;
  notes: string;
};

export type JournalAnalysisResult = {
  stats: {
    total: number;
    closed: number;
    open: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    avgR: number | null;
    totalPnl: number | null;
    unrealizedPnl: number | null;
    maxWin: number | null;
    maxLoss: number | null;
    maxConsecLosses: number;
    byAsset: { asset: string; n: number; pnl: number; winRate: number | null }[];
    byStrategy: { strategy: string; n: number; pnl: number }[];
  };
  openMarks: OpenMark[];
  narrative: string;
  mode: "deterministic" | "llm";
  model: string | null;
};

function pnlOf(t: JournalTradeInput, mark?: number | null): number | null {
  const px = mark != null ? mark : t.exit;
  if (px == null || !Number.isFinite(t.entry) || !Number.isFinite(px)) return null;
  const dir = t.side === "short" ? -1 : 1;
  return (px - t.entry) * dir * (t.size ?? 1) * (t.leverage ?? 1);
}

function rOf(t: JournalTradeInput, mark?: number | null): number | null {
  const px = mark != null ? mark : t.exit;
  if (px == null || t.stopLoss == null || t.stopLoss === t.entry) return null;
  const dir = t.side === "short" ? -1 : 1;
  const risk = (t.entry - t.stopLoss) * dir;
  if (risk <= 0) return null;
  return ((px - t.entry) * dir) / risk;
}

function computeStats(trades: JournalTradeInput[]): JournalAnalysisResult["stats"] {
  const closed = trades.filter((t) => t.exit != null);
  const open = trades.length - closed.length;
  const pnls = closed.map((t) => pnlOf(t)).filter((x): x is number => x != null);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const sumWin = wins.reduce((a, b) => a + b, 0);
  const sumLossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  const totalPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null;
  const winRate = closed.length ? wins.length / closed.length : null;
  const profitFactor = sumLossAbs > 1e-12 ? sumWin / sumLossAbs : null;
  const expectancy = pnls.length && totalPnl != null ? totalPnl / pnls.length : null;
  const avgWin = wins.length ? sumWin / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;

  const rs = closed.map((t) => rOf(t)).filter((x): x is number => x != null);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;

  let maxConsecLosses = 0;
  let streak = 0;
  for (const p of pnls) {
    if (p < 0) {
      streak++;
      maxConsecLosses = Math.max(maxConsecLosses, streak);
    } else streak = 0;
  }

  const byAssetMap = new Map<string, { n: number; pnl: number; wins: number; closed: number }>();
  for (const t of closed) {
    const p = pnlOf(t);
    if (p == null) continue;
    const k = t.assetType || "other";
    const cur = byAssetMap.get(k) ?? { n: 0, pnl: 0, wins: 0, closed: 0 };
    cur.n++;
    cur.closed++;
    cur.pnl += p;
    if (p > 0) cur.wins++;
    byAssetMap.set(k, cur);
  }

  const byStratMap = new Map<string, { n: number; pnl: number }>();
  for (const t of closed) {
    const p = pnlOf(t);
    if (p == null) continue;
    const k = (t.strategy || "Không ghi").slice(0, 40);
    const cur = byStratMap.get(k) ?? { n: 0, pnl: 0 };
    cur.n++;
    cur.pnl += p;
    byStratMap.set(k, cur);
  }

  return {
    total: trades.length,
    closed: closed.length,
    open,
    winRate,
    profitFactor: profitFactor != null && Number.isFinite(profitFactor) ? profitFactor : null,
    expectancy,
    avgWin,
    avgLoss,
    avgR,
    totalPnl,
    unrealizedPnl: null,
    maxWin: wins.length ? Math.max(...wins) : null,
    maxLoss: losses.length ? Math.min(...losses) : null,
    maxConsecLosses,
    byAsset: [...byAssetMap.entries()].map(([asset, v]) => ({
      asset,
      n: v.n,
      pnl: v.pnl,
      winRate: v.closed ? v.wins / v.closed : null,
    })),
    byStrategy: [...byStratMap.entries()]
      .map(([strategy, v]) => ({ strategy, n: v.n, pnl: v.pnl }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 8),
  };
}

async function markOpenTrades(trades: JournalTradeInput[]): Promise<OpenMark[]> {
  const open = trades.filter((t) => t.exit == null);
  if (!open.length) return [];

  const stockSyms = [
    ...new Set(
      open
        .filter((t) => t.assetType === "stock" || /^[A-Z]{3}$/.test(t.symbol))
        .map((t) => t.symbol.toUpperCase()),
    ),
  ].slice(0, 30);

  const quoteMap = new Map<string, number>();
  if (stockSyms.length) {
    try {
      const q = await getVnQuotes(stockSyms);
      for (const row of q?.quotes ?? []) {
        if (row.price != null && Number.isFinite(row.price)) quoteMap.set(row.symbol.toUpperCase(), row.price);
      }
    } catch {
      /* */
    }
  }

  // crypto marks (tối đa 5 mã để không timeout)
  const cryptoOpen = open.filter((t) => t.assetType === "crypto").slice(0, 5);
  for (const t of cryptoOpen) {
    try {
      const sym = t.symbol.toUpperCase().endsWith("USDT") ? t.symbol.toUpperCase() : `${t.symbol.toUpperCase()}USDT`;
      const d = await getCryptoDetail(sym);
      const px = d?.detail?.ticker?.price;
      if (px != null && Number.isFinite(px)) quoteMap.set(t.symbol.toUpperCase(), px);
    } catch {
      /* */
    }
  }

  return open.map((t) => {
    const mark = quoteMap.get(t.symbol.toUpperCase()) ?? null;
    const u = pnlOf(t, mark);
    const dir = t.side === "short" ? -1 : 1;
    let distToSlPct: number | null = null;
    let distToTpPct: number | null = null;
    if (mark != null && t.entry > 0) {
      if (t.stopLoss != null) {
        distToSlPct = ((t.stopLoss - mark) / mark) * 100 * dir * -1;
        // khoảng cách % tới SL theo hướng có lợi của giá hiện tại → SL
        distToSlPct = ((mark - t.stopLoss) / t.entry) * 100 * dir;
      }
      if (t.takeProfit != null) {
        distToTpPct = ((t.takeProfit - mark) / t.entry) * 100 * dir;
      }
    }
    return {
      symbol: t.symbol,
      assetType: t.assetType,
      side: t.side,
      entry: t.entry,
      mark,
      unrealizedPnl: u,
      distToSlPct,
      distToTpPct,
      strategy: t.strategy,
      notes: t.notes,
    };
  });
}

function deterministicNarrative(
  stats: JournalAnalysisResult["stats"],
  openMarks: OpenMark[],
): string {
  const parts: string[] = ["## Đánh giá nhật ký giao dịch"];

  if (stats.closed < 1 && openMarks.length === 0) {
    return "Chưa có lệnh — ghi entry/exit để hệ thống đánh giá.";
  }

  if (stats.closed >= 1) {
    parts.push(
      `Đã đóng **${stats.closed}**/${stats.total} lệnh · Win rate **${stats.winRate != null ? (stats.winRate * 100).toFixed(0) + "%" : "—"}** · PnL thực hiện **${stats.totalPnl != null ? stats.totalPnl.toFixed(2) : "—"}**.`,
    );
    if (stats.profitFactor != null) parts.push(`Profit factor: **${stats.profitFactor.toFixed(2)}**.`);
    if (stats.avgR != null) parts.push(`R-multiple TB: **${stats.avgR.toFixed(2)}R**.`);
  } else {
    parts.push(`Chưa có lệnh đóng · đang theo dõi **${stats.open}** vị thế mở.`);
  }

  if (openMarks.length) {
    parts.push("### Vị thế đang mở (mark-to-market)");
    for (const o of openMarks) {
      const markStr = o.mark != null ? o.mark.toFixed(2) : "chưa có giá";
      const uStr = o.unrealizedPnl != null ? o.unrealizedPnl.toFixed(2) : "—";
      const sl =
        o.distToSlPct != null ? ` · tới SL ~${o.distToSlPct.toFixed(1)}% entry` : "";
      const tp =
        o.distToTpPct != null ? ` · tới TP ~${o.distToTpPct.toFixed(1)}% entry` : "";
      parts.push(
        `- **${o.symbol}** (${o.side}) entry ${o.entry} → mark ${markStr} · uPnL **${uStr}**${sl}${tp}` +
          (o.strategy || o.notes ? ` · ${[o.strategy, o.notes].filter(Boolean).join(" — ")}` : ""),
      );
    }
    if (stats.unrealizedPnl != null) {
      parts.push(`Tổng lãi/lỗ chưa thực hiện: **${stats.unrealizedPnl.toFixed(2)}**.`);
    }
  }

  parts.push(
    "### Gợi ý kỷ luật",
  );
  parts.push(
    "- Giữ SL/TP đã ghi; tránh dời SL xa hơn khi lệnh ngược.\n- Đánh giá theo R-multiple, không chỉ PnL tuyệt đối.\n- Ghi exit khi đóng lệnh để win rate / profit factor có ý nghĩa thống kê.",
  );

  return parts.join("\n\n");
}

export async function analyzeJournalPortfolio(
  trades: JournalTradeInput[],
): Promise<{ result: JournalAnalysisResult; meta: Meta }> {
  const slice = trades.slice(0, 200);
  const stats = computeStats(slice);
  const openMarks = await markOpenTrades(slice);
  const uSum = openMarks
    .map((o) => o.unrealizedPnl)
    .filter((x): x is number => x != null)
    .reduce((a, b) => a + b, 0);
  stats.unrealizedPnl = openMarks.some((o) => o.unrealizedPnl != null) ? uSum : null;

  let narrative = deterministicNarrative(stats, openMarks);
  let mode: "deterministic" | "llm" = "deterministic";
  let model: string | null = null;

  if (llmConfigured() && (stats.closed >= 1 || openMarks.length >= 1)) {
    try {
      const sampleClosed = slice
        .filter((t) => t.exit != null)
        .slice(0, 30)
        .map((t) => ({
          symbol: t.symbol,
          assetType: t.assetType,
          side: t.side,
          entry: t.entry,
          exit: t.exit,
          pnl: pnlOf(t),
          r: rOf(t),
          strategy: t.strategy || null,
          emotion: t.emotion || null,
          notes: t.notes || null,
        }));

      const r = await llmChat("analysis", {
        system: `Bạn là coach giao dịch ORCA trên trang Nhật ký lệnh.
Chỉ dùng STATS + OPEN_MARKS + SAMPLE — không bịa giá hay sự kiện.
Tiếng Việt, cấu trúc ## / gạch đầu dòng.
Với lệnh đang mở: nhận xét khoảng entry–SL–TP, uPnL, kỷ luật quản trị rủi ro.
Với lệnh đã đóng: win rate, R-multiple, hành vi.
Kết thúc bằng 3 hành động cụ thể. Không khuyến nghị all-in.`,
        user: `STATS:\n${JSON.stringify(stats)}\n\nOPEN_MARKS (giá realtime hệ thống):\n${JSON.stringify(openMarks)}\n\nSAMPLE_CLOSED:\n${JSON.stringify(sampleClosed)}\n\nViết đánh giá nhật ký giao dịch này.`,
        temperature: 0.3,
        maxTokens: 1000,
      });
      if (r?.text?.trim()) {
        narrative = r.text.trim();
        mode = "llm";
        model = r.model;
      }
    } catch {
      /* giữ deterministic */
    }
  }

  const meta = buildMeta({
    source: mode === "llm" ? "journal+llm+marks" : "journal-stats+marks",
    sourceTimestampMs: Date.now(),
    note: `${stats.closed} đóng · ${stats.open} mở · marks ${openMarks.filter((o) => o.mark != null).length}`,
  });

  return {
    result: { stats, openMarks, narrative, mode, model },
    meta,
  };
}

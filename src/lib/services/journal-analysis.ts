import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";
import { buildMeta } from "../freshness";
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
    maxWin: number | null;
    maxLoss: number | null;
    maxConsecLosses: number;
    byAsset: { asset: string; n: number; pnl: number; winRate: number | null }[];
    byStrategy: { strategy: string; n: number; pnl: number }[];
  };
  narrative: string;
  mode: "deterministic" | "llm";
  model: string | null;
};

function pnlOf(t: JournalTradeInput): number | null {
  if (t.exit == null || !Number.isFinite(t.entry) || !Number.isFinite(t.exit)) return null;
  const dir = t.side === "short" ? -1 : 1;
  return (t.exit - t.entry) * dir * (t.size ?? 1) * (t.leverage ?? 1);
}

function rOf(t: JournalTradeInput): number | null {
  if (t.exit == null || t.stopLoss == null || t.stopLoss === t.entry) return null;
  const dir = t.side === "short" ? -1 : 1;
  const risk = (t.entry - t.stopLoss) * dir;
  if (risk <= 0) return null;
  return ((t.exit - t.entry) * dir) / risk;
}

function computeStats(trades: JournalTradeInput[]): JournalAnalysisResult["stats"] {
  const closed = trades.filter((t) => t.exit != null);
  const open = trades.length - closed.length;
  const pnls = closed.map(pnlOf).filter((x): x is number => x != null);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const sumWin = wins.reduce((a, b) => a + b, 0);
  const sumLossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  const totalPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null;
  const winRate = closed.length ? wins.length / closed.length : null;
  const profitFactor =
    sumLossAbs > 1e-12 ? sumWin / sumLossAbs : wins.length ? null : null;
  const expectancy = pnls.length ? totalPnl! / pnls.length : null;
  const avgWin = wins.length ? sumWin / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;

  const rs = closed.map(rOf).filter((x): x is number => x != null);
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

function deterministicNarrative(stats: JournalAnalysisResult["stats"]): string {
  if (stats.closed < 1) {
    return "Chưa có lệnh đã đóng — ghi thêm kết quả exit để hệ thống đánh giá danh mục.";
  }
  const parts: string[] = ["## Đánh giá danh mục (số liệu nhật ký)"];
  parts.push(
    `Đã đóng **${stats.closed}**/${stats.total} lệnh · Win rate **${stats.winRate != null ? (stats.winRate * 100).toFixed(0) + "%" : "—"}** · PnL tổng **${stats.totalPnl != null ? stats.totalPnl.toFixed(2) : "—"}**.`,
  );
  if (stats.profitFactor != null) parts.push(`Profit factor: **${stats.profitFactor.toFixed(2)}**.`);
  if (stats.expectancy != null) parts.push(`Kỳ vọng mỗi lệnh: **${stats.expectancy.toFixed(2)}**.`);
  if (stats.avgR != null) parts.push(`R-multiple trung bình: **${stats.avgR.toFixed(2)}R**.`);
  if (stats.maxConsecLosses >= 3)
    parts.push(`Chuỗi thua liên tiếp tối đa: **${stats.maxConsecLosses}** — cần kiểm soát rủi ro / kích thước lệnh.`);
  if (stats.byAsset.length) {
    parts.push(
      "Theo tài sản: " +
        stats.byAsset
          .map(
            (a) =>
              `${a.asset} (${a.n} lệnh, PnL ${a.pnl.toFixed(1)}, WR ${a.winRate != null ? (a.winRate * 100).toFixed(0) + "%" : "—"})`,
          )
          .join("; ") +
        ".",
    );
  }
  if (stats.byStrategy.length) {
    parts.push(
      "Chiến lược nổi bật: " +
        stats.byStrategy
          .slice(0, 3)
          .map((s) => `${s.strategy} (${s.n}, PnL ${s.pnl.toFixed(1)})`)
          .join("; ") +
        ".",
    );
  }
  parts.push(
    "Gợi ý khung: giữ journal đầy đủ SL/TP · đánh giá theo R chứ không chỉ PnL tuyệt đối · tránh tăng size sau chuỗi thắng.",
  );
  return parts.join("\n\n");
}

export async function analyzeJournalPortfolio(
  trades: JournalTradeInput[],
): Promise<{ result: JournalAnalysisResult; meta: Meta }> {
  const stats = computeStats(trades.slice(0, 200));
  let narrative = deterministicNarrative(stats);
  let mode: "deterministic" | "llm" = "deterministic";
  let model: string | null = null;

  if (llmConfigured() && stats.closed >= 1) {
    try {
      const sample = trades
        .filter((t) => t.exit != null)
        .slice(0, 40)
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
        }));

      const r = await llmChat("analysis", {
        system: `Bạn là coach giao dịch ORCA. Chỉ dùng STATS + SAMPLE JSON — không bịa số.
Viết tiếng Việt, ngắn gọn (## tiêu đề, gạch đầu dòng).
Đánh giá: điểm mạnh, điểm yếu, rủi ro hành vi, 3 hành động cải thiện.
Không khuyến nghị mã cụ thể để "all-in".`,
        user: `STATS:\n${JSON.stringify(stats)}\n\nSAMPLE_TRADES:\n${JSON.stringify(sample)}\n\nViết đánh giá danh mục nhật ký lệnh.`,
        temperature: 0.3,
        maxTokens: 900,
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
    source: mode === "llm" ? "journal+llm" : "journal-stats",
    sourceTimestampMs: Date.now(),
    note: `${stats.closed} lệnh đóng · ${mode}`,
  });

  return {
    result: { stats, narrative, mode, model },
    meta,
  };
}

import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";
import { buildMeta } from "../freshness";
import { hubVnQuotes, hubCryptoDetail, hubPrefetch, runInDataHub } from "../data-engine/hub";
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

type OpenMark = {
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
    avgR: number | null;
    totalPnl: number | null;
    unrealizedPnl: number | null;
    maxConsecLosses: number;
    avgWin: number | null;
    avgLoss: number | null;
    byAsset: { assetType: string; closed: number; pnl: number; winRate: number | null }[];
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
    const k = t.strategy || "(không ghi)";
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
    profitFactor,
    expectancy,
    avgR,
    totalPnl,
    unrealizedPnl: null,
    maxConsecLosses,
    avgWin,
    avgLoss,
    byAsset: [...byAssetMap.entries()].map(([assetType, v]) => ({
      assetType,
      closed: v.closed,
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
      const q = await hubVnQuotes(stockSyms);
      for (const row of q?.quotes ?? []) {
        const sym = String(row.symbol ?? "").toUpperCase();
        const px = row.price != null ? Number(row.price) : NaN;
        if (sym && Number.isFinite(px)) quoteMap.set(sym, px);
      }
    } catch {
      /* */
    }
  }
  const cryptoOpen = open.filter((t) => t.assetType === "crypto").slice(0, 5);
  for (const t of cryptoOpen) {
    try {
      const d = (await hubCryptoDetail(t.symbol)) as {
        lastPrice?: string | number;
        price?: number;
      } | null;
      const raw = d?.lastPrice ?? d?.price;
      const px = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(px) && px > 0) quoteMap.set(t.symbol.toUpperCase(), px);
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
      if (t.stopLoss != null) distToSlPct = ((mark - t.stopLoss) / t.entry) * 100 * dir;
      if (t.takeProfit != null) distToTpPct = ((t.takeProfit - mark) / t.entry) * 100 * dir;
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
  if (stats.closed < 1 && openMarks.length === 0) {
    return "Bạn chưa ghi lệnh nào trong nhật ký. Thêm entry/exit vài lệnh để ORCA có cơ sở nhận xét.";
  }
  const lines: string[] = [];
  lines.push("## Nhìn nhanh danh mục");
  if (stats.closed >= 1) {
    const wr = stats.winRate != null ? `${(stats.winRate * 100).toFixed(0)}%` : "chưa đủ";
    const pnl = stats.totalPnl != null ? stats.totalPnl.toFixed(2) : "—";
    const tone =
      stats.totalPnl != null && stats.totalPnl > 0
        ? "đang dương"
        : stats.totalPnl != null && stats.totalPnl < 0
          ? "đang âm"
          : "hòa vốn";
    lines.push(
      `Trong ${stats.closed} lệnh đã đóng (trên tổng ${stats.total}), tỷ lệ thắng khoảng **${wr}**, PnL thực hiện **${pnl}** (${tone}).`,
    );
    if (stats.profitFactor != null) {
      const pf = stats.profitFactor;
      lines.push(
        pf >= 1.2
          ? `Profit factor **${pf.toFixed(2)}** — lãi trung bình đang bù được lỗ khá ổn.`
          : pf >= 1
            ? `Profit factor **${pf.toFixed(2)}** — tạm cân bằng; cần siết thêm chất lượng lệnh thắng.`
            : `Profit factor **${pf.toFixed(2)}** — lỗ đang nặng hơn lãi; nên giảm size hoặc chờ setup rõ hơn.`,
      );
    }
    if (stats.avgR != null) {
      lines.push(`Trung bình mỗi lệnh khoảng **${stats.avgR.toFixed(2)}R** nếu tính theo khoảng entry–SL đã ghi.`);
    }
    if (stats.maxConsecLosses >= 3) {
      lines.push(`Chuỗi thua dài nhất **${stats.maxConsecLosses}** lệnh — nên hạ size tạm thời sau chuỗi này.`);
    }
  } else {
    lines.push(`Chưa có lệnh đóng. Hiện đang mở **${stats.open}** vị thế — phần dưới tập trung vào quản trị lệnh đang chạy.`);
  }
  if (openMarks.length) {
    lines.push("## Vị thế đang mở");
    for (const o of openMarks) {
      const markStr = o.mark != null ? o.mark.toFixed(2) : "chưa có giá mới";
      const u =
        o.unrealizedPnl != null
          ? o.unrealizedPnl >= 0
            ? `lãi tạm **+${o.unrealizedPnl.toFixed(2)}**`
            : `lỗ tạm **${o.unrealizedPnl.toFixed(2)}**`
          : "chưa tính được uPnL";
      let dist = "";
      if (o.distToSlPct != null) dist += ` còn khoảng **${o.distToSlPct.toFixed(1)}%** tới SL`;
      if (o.distToTpPct != null) dist += (dist ? "," : "") + ` **${o.distToTpPct.toFixed(1)}%** tới TP`;
      lines.push(
        `- **${o.symbol}** (${o.side}): vào **${o.entry}**, mark ${markStr} → ${u}.` +
          (dist ? dist + "." : "") +
          (o.strategy || o.notes ? ` Ghi chú: ${(o.strategy || o.notes).slice(0, 80)}.` : ""),
      );
    }
  }
  lines.push("## Gợi ý thực tế");
  lines.push(
    "- Giữ nguyên SL/TP đã viết lúc vào lệnh; tránh kéo SL xa hơn khi giá đi ngược.\n- Ưu tiên đánh giá theo **R-multiple**, không chỉ số tiền tuyệt đối.\n- Đóng lệnh thì ghi exit ngay để win rate và profit factor phản ánh đúng thực tế.",
  );
  return lines.join("\n\n");
}

async function fetchMarketHubContext(symbols: string[]): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = { via: "data-engine-hub" };
  try {
    await hubPrefetch({ symbols: symbols.slice(0, 20), commodity: false });
  } catch {
    /* */
  }
  try {
    const { buildMarketIntel } = await import("./market-intel");
    const { intel } = await buildMarketIntel();
    ctx.session = intel.session
      ? { state: intel.session.state, labelVi: intel.session.labelVi, trading: intel.session.trading }
      : null;
    ctx.condition = intel.condition
      ? {
          score: intel.condition.score,
          rating: intel.condition.rating,
          confidence: intel.condition.confidence,
          crossAssetState: intel.condition.crossAssetState,
          drivers: intel.condition.drivers?.slice(0, 4),
          risks: intel.condition.risks?.slice(0, 4),
        }
      : null;
    ctx.breadth = intel.breadth
      ? {
          advancers: intel.breadth.advancers,
          decliners: intel.breadth.decliners,
          regimeVi: intel.breadth.regimeVi,
        }
      : null;
    ctx.flow = intel.flow
      ? { foreignNet: intel.flow.foreignNet, propNet: intel.flow.propNet, available: intel.flow.available }
      : null;
    ctx.indices = (intel.indices ?? []).slice(0, 6).map((i) => ({
      code: i.code,
      value: i.value,
      changePercent: i.changePercent,
    }));
  } catch (e) {
    ctx.marketError = e instanceof Error ? e.message : "market_intel_unavailable";
  }
  return ctx;
}

export async function analyzeJournalPortfolio(
  trades: JournalTradeInput[],
  portfolioContext?: Record<string, unknown>,
): Promise<{ result: JournalAnalysisResult; meta: Meta }> {
  return runInDataHub(async () => {
    const slice = trades.slice(0, 200);
    const stats = computeStats(slice);
    const openSyms = [
      ...new Set(
        slice
          .filter((t) => t.exit == null && (t.assetType === "stock" || /^[A-Z]{3}$/.test(t.symbol)))
          .map((t) => t.symbol.toUpperCase()),
      ),
    ];
    const marketHub = await fetchMarketHubContext(openSyms);
    const openMarks = await markOpenTrades(slice);
    const uSum = openMarks
      .map((o) => o.unrealizedPnl)
      .filter((x): x is number => x != null)
      .reduce((a, b) => a + b, 0);
    stats.unrealizedPnl = openMarks.some((o) => o.unrealizedPnl != null) ? uSum : null;

    let narrative = deterministicNarrative(stats, openMarks);
    if (marketHub.condition || marketHub.session) {
      const cond = marketHub.condition as {
        rating?: string;
        score?: number;
        confidence?: string;
        crossAssetState?: string;
      } | undefined;
      const sess = marketHub.session as { labelVi?: string } | undefined;
      const br = marketHub.breadth as {
        regimeVi?: string;
        advancers?: number;
        decliners?: number;
      } | undefined;
      const hubLines = [
        "## Ngữ cảnh thị trường",
        sess?.labelVi ? `- Phiên hiện tại: **${sess.labelVi}**.` : null,
        cond?.rating != null
          ? `- Thị trường đang **${cond.rating}** (score ${cond.score != null ? Math.round(cond.score) : "—"}${cond.confidence ? `, độ tin ${cond.confidence}` : ""}).`
          : null,
        br
          ? `- Breadth: **${br.regimeVi ?? "—"}** (${br.advancers ?? "—"} tăng / ${br.decliners ?? "—"} giảm).`
          : null,
      ].filter(Boolean);
      if (hubLines.length > 1) narrative = narrative + "\n\n" + hubLines.join("\n");
    }

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
          system: `Bạn là coach giao dịch của ORCA — nói như mentor thực tế, không phải báo cáo máy.
Chỉ dựa STATS, OPEN_MARKS, MARKET_HUB, SAMPLE, PORTFOLIO_CONTEXT. Không bịa giá hay sự kiện.
Tiếng Việt tự nhiên, mạch lạc; tiêu đề ## ngắn được, tránh liệt kê khô.
Giọng gần gũi, thẳng thắn — như ngồi cạnh trader.
Vị thế mở: nói lãi/lỗ tạm, khoảng SL/TP, rủi ro nếu phiên xấu (MARKET_HUB).
Lệnh đóng: win rate, R-multiple, thói quen nếu có.
Thiếu dữ liệu thì nói rõ. Không all-in, không đoán chắc. Kết thúc 2–3 việc làm ngay.`,
          user:
            "STATS:\n" +
            JSON.stringify(stats) +
            "\n\nPORTFOLIO_CONTEXT:\n" +
            JSON.stringify(portfolioContext ?? {}) +
            "\n\nMARKET_HUB:\n" +
            JSON.stringify(marketHub) +
            "\n\nOPEN_MARKS:\n" +
            JSON.stringify(openMarks) +
            "\n\nSAMPLE_CLOSED:\n" +
            JSON.stringify(sampleClosed) +
            "\n\nViết nhận xét danh mục theo giọng mentor, gắn thị trường hiện tại.",
          temperature: 0.45,
          maxTokens: 1200,
        });
        if (r?.text?.trim()) {
          narrative = r.text.trim();
          mode = "llm";
          model = r.model;
        }
      } catch {
        /* deterministic */
      }
    }

    const meta = buildMeta({
      source: mode === "llm" ? "hub+journal+llm" : "hub+journal-stats",
      sourceTimestampMs: Date.now(),
      note: `${stats.closed} đóng · ${stats.open} mở · marks ${openMarks.filter((o) => o.mark != null).length} · hub`,
    });

    return {
      result: { stats, openMarks, narrative, mode, model },
      meta,
    };
  });
}

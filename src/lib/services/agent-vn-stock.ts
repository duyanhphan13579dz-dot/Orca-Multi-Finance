import "server-only";
import { vnstockConfigured } from "./stocks";
import { getNews } from "./news";
import { buildStockAnalysis } from "./intelligence";
import type { FreshnessStatus } from "../types";

type Persona = "stock_analyst" | "personal_finance" | "wealth";

interface Built {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
  persona: Persona;
}

async function buildVn(symbol: string, deep: boolean): Promise<Built> {
  if (!vnstockConfigured()) {
    const news = await getNews({ symbol, limit: 3 });
    const ctx: Record<string, unknown> = { asset: { symbol, asset_type: "stock" }, status: "vnstock_not_configured" };
    if (news?.articles.length) ctx.news_context = news.articles.map((a) => ({ title: a.title, source: a.source }));
    return { narrative: `${symbol}: chưa có VNSTOCK_API_KEY.` + (news?.articles.length ? `\n\nTin: ${news.articles.map((a) => a.title).join("; ")}.` : ""), contract: ctx, sectionsUsed: news?.articles.length ? ["news"] : [], symbols: [symbol], freshnesses: news ? [news.meta.freshness] : [], unavailable: true, persona: "stock_analyst" };
  }
  const analysis = await buildStockAnalysis(symbol);
  if (!analysis) return { narrative: `Không lấy được dữ liệu ${symbol}.`, contract: { asset: { symbol, asset_type: "stock" }, error: "provider_unavailable" }, sectionsUsed: [], symbols: [symbol], freshnesses: [], unavailable: true, persona: "stock_analyst" };

  const c = analysis.contract;
  const detail = analysis.detail;
  const md = c.market_data;
  const tech = c.technical_state as {
    rsi14?: number | null;
    macd_histogram?: number | null;
    trend?: { score?: number; label?: string } | null;
    sma?: { sma20?: number | null; sma50?: number | null; sma200?: number | null } | null;
    support?: number[];
    resistance?: number[];
    signals?: string[];
  } | null;
  const ms = c.market_state as { labelVi?: string; strength?: number; state?: string } | null;
  const fh = c.fundamental_state?.financial_health as {
    scores?: { overall?: number | null; profitability?: number | null; leverage?: number | null; cashflow?: number | null; liquidity?: number | null; efficiency?: number | null };
    coverage?: number;
  } | null;
  const v = c.fundamental_state?.valuation as {
    multiples?: { pe?: number | null; pb?: number | null; evEbitda?: number | null };
    confidence?: string;
  } | null;
  const risk = c.risk_metrics as { atr14?: number | null; volatility_30d?: number | null; max_drawdown_52w?: number | null } | null;
  const patterns = (detail?.patterns ?? []) as { nameVi?: string; name?: string; type?: string; reliability?: string; description?: string }[];

  const fmt = (n: number | null | undefined, d = 2) =>
    n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const pct = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  const bars = detail?.bars ?? [];
  const recentBars = bars.slice(-20);
  const avgVol =
    recentBars.length >= 5
      ? Math.round(recentBars.reduce((s, b) => s + (b.volume ?? 0), 0) / recentBars.length)
      : null;
  const sessionVol = md?.volume != null ? Number(md.volume) : null;

  const trendLabelMap: Record<string, string> = {
    "strong-up": "Tăng mạnh",
    up: "Tăng",
    sideways: "Đi ngang",
    down: "Giảm",
    "strong-down": "Giảm mạnh",
  };
  const trendLabel = tech?.trend?.label ? trendLabelMap[tech.trend.label] ?? tech.trend.label : "—";

  const sections: string[] = [];

  {
    const parts: string[] = [];
    if (md?.price != null) {
      parts.push(`## Giá & khối lượng`);
      parts.push(
        `**${symbol}**: giá **${fmt(md.price as number)}** (${pct(md.change_percent as number | null)})` +
          (md.low != null && md.high != null ? ` · biên phiên ${fmt(md.low as number)}–${fmt(md.high as number)}` : "") +
          ".",
      );
      if (sessionVol != null) parts.push(`Khối lượng phiên: **${sessionVol.toLocaleString("vi-VN")}**.`);
      if (avgVol != null) parts.push(`Khối lượng TB 20 phiên: **${avgVol.toLocaleString("vi-VN")}**.`);
      if (sessionVol != null && avgVol != null && avgVol > 0) {
        const ratio = sessionVol / avgVol;
        parts.push(
          ratio >= 1.5
            ? `Khối lượng phiên cao hơn TB (~${ratio.toFixed(1)}×) — dòng tiền tích cực.`
            : ratio <= 0.6
              ? `Khối lượng phiên thấp hơn TB (~${ratio.toFixed(1)}×) — thanh khoản yếu.`
              : `Khối lượng phiên quanh mức trung bình (~${ratio.toFixed(1)}×).`,
        );
      }
      sections.push(parts.join("\n"));
    } else {
      sections.push(`## Giá & khối lượng\n${symbol}: chưa có quote realtime.`);
    }
  }

  {
    const parts: string[] = ["## Tín hiệu kỹ thuật"];
    if (tech) {
      parts.push(`Xu hướng: **${trendLabel}**${tech.trend?.score != null ? ` (score ${tech.trend.score})` : ""}.`);
      if (tech.rsi14 != null) {
        const r = tech.rsi14;
        const zone = r >= 70 ? "quá mua — dễ rung lắc ngắn hạn" : r <= 30 ? "quá bán — khả năng hồi kỹ thuật" : "vùng cân bằng";
        parts.push(`RSI(14): **${r.toFixed(1)}** — ${zone}.`);
      }
      if (tech.macd_histogram != null) {
        parts.push(
          `MACD histogram: **${tech.macd_histogram >= 0 ? "+" : ""}${tech.macd_histogram.toFixed(3)}** — ${
            tech.macd_histogram > 0 ? "ủng hộ xu hướng tăng" : "nghiêng về áp lực bán"
          }.`,
        );
      }
      if (tech.sma) {
        const s = tech.sma;
        const maBits: string[] = [];
        if (s.sma20 != null) maBits.push(`SMA20 ${fmt(s.sma20)}`);
        if (s.sma50 != null) maBits.push(`SMA50 ${fmt(s.sma50)}`);
        if (s.sma200 != null) maBits.push(`SMA200 ${fmt(s.sma200)}`);
        if (maBits.length) parts.push(`Đường MA: ${maBits.join(" · ")}.`);
        if (md?.price != null && s.sma50 != null) {
          parts.push(
            Number(md.price) > s.sma50
              ? "Giá đang **trên SMA50** — xu hướng trung hạn còn nguyên."
              : "Giá đang **dưới SMA50** — xu hướng trung hạn suy yếu.",
          );
        }
      }
      if (tech.support?.length || tech.resistance?.length) {
        const sup = (tech.support ?? []).slice(0, 2).map((x) => fmt(x)).join(", ");
        const res = (tech.resistance ?? []).slice(0, 2).map((x) => fmt(x)).join(", ");
        if (sup) parts.push(`Hỗ trợ gần: ${sup}.`);
        if (res) parts.push(`Kháng cự gần: ${res}.`);
      }
      if (tech.signals?.length) {
        parts.push("Tín hiệu: " + tech.signals.slice(0, 4).join("; ") + ".");
      }
    } else {
      parts.push("Chưa đủ chuỗi OHLCV để tính chỉ báo kỹ thuật.");
    }

    if (patterns.length) {
      const recent = patterns.slice(-4);
      const patternLines = recent.map((p) => {
        const tone =
          p.type === "bullish" ? "đảo chiều / tiếp diễn tăng (bullish)" : p.type === "bearish" ? "đảo chiều / tiếp diễn giảm (bearish)" : "trung tính";
        return `- **${p.nameVi ?? p.name}** (${tone}, độ tin cậy ${p.reliability ?? "—"})${p.description ? `: ${p.description}` : ""}`;
      });
      parts.push("Mẫu hình nến gần đây:\n" + patternLines.join("\n"));
    } else if (deep) {
      parts.push("Chưa phát hiện mẫu hình nến đáng chú ý trên khung hiện tại.");
    }
    sections.push(parts.join("\n"));
  }

  if (ms?.labelVi) {
    sections.push(
      `## Trạng thái thị trường (Market State)\n**${ms.labelVi}** — strength **${ms.strength ?? "—"}/100**${ms.state ? ` (${ms.state})` : ""}.`,
    );
  }

  {
    const parts: string[] = ["## Sức khỏe tài chính"];
    if (fh?.scores?.overall != null) {
      const s = fh.scores;
      parts.push(
        `Financial Health: **${s.overall}/100**` +
          (fh.coverage != null ? ` (coverage ${(fh.coverage * 100).toFixed(0)}%)` : "") +
          ".",
      );
      parts.push(
        `Chi tiết: Profitability ${s.profitability ?? "—"} · Liquidity ${s.liquidity ?? "—"} · Leverage ${s.leverage ?? "—"} · Cashflow ${s.cashflow ?? "—"} · Efficiency ${s.efficiency ?? "—"}.`,
      );
      const overall = s.overall;
      if (overall >= 70) parts.push("Doanh nghiệp có nền tảng tài chính **vững** theo engine định lượng.");
      else if (overall >= 45) parts.push("Sức khỏe tài chính **trung bình** — cần theo dõi thêm đòn bẩy và dòng tiền.");
      else parts.push("Sức khỏe tài chính **yếu** theo engine — rủi ro cơ bản cao hơn.");
    } else {
      parts.push("Chưa đủ BCTC chuẩn hóa để chấm điểm sức khỏe tài chính.");
    }
    sections.push(parts.join("\n"));
  }

  {
    const parts: string[] = ["## Định giá"];
    if (v?.multiples) {
      const m = v.multiples;
      parts.push(
        `P/E **${m.pe != null ? fmt(m.pe, 1) : "—"}x** · P/B **${m.pb != null ? fmt(m.pb, 1) : "—"}x**` +
          (m.evEbitda != null ? ` · EV/EBITDA **${fmt(m.evEbitda, 1)}x**` : "") +
          (v.confidence ? ` · confidence định giá: ${v.confidence}` : "") +
          ".",
      );
    } else {
      parts.push("Chưa đủ dữ liệu để tính multiples định giá (P/E, P/B…)." );
    }
    sections.push(parts.join("\n"));
  }

  if (risk && (risk.atr14 != null || risk.volatility_30d != null || risk.max_drawdown_52w != null)) {
    const bits: string[] = [];
    if (risk.atr14 != null) bits.push(`ATR14 ${fmt(risk.atr14)}`);
    if (risk.volatility_30d != null) bits.push(`Biến động 30d ${(risk.volatility_30d * 100).toFixed(1)}%`);
    if (risk.max_drawdown_52w != null) bits.push(`Max DD 52w ${(risk.max_drawdown_52w * 100).toFixed(1)}%`);
    sections.push(`## Rủi ro kỹ thuật\n${bits.join(" · ")}.`);
  }

  {
    const parts: string[] = ["## Tổng kết & góc nhìn ORCA"];
    let score = 50;
    let factors = 0;
    if (tech?.trend?.score != null) {
      score += Math.max(-20, Math.min(20, tech.trend.score * 8));
      factors++;
    }
    if (tech?.rsi14 != null) {
      if (tech.rsi14 >= 70) score -= 8;
      else if (tech.rsi14 <= 30) score += 6;
      else if (tech.rsi14 >= 55) score += 4;
      else if (tech.rsi14 <= 45) score -= 4;
      factors++;
    }
    if (tech?.macd_histogram != null) {
      score += tech.macd_histogram > 0 ? 6 : -6;
      factors++;
    }
    if (fh?.scores?.overall != null) {
      score += (fh.scores.overall - 50) * 0.25;
      factors++;
    }
    if (ms?.strength != null) {
      score += (ms.strength - 50) * 0.15;
      factors++;
    }
    score = Math.round(Math.max(5, Math.min(95, score)));

    let stance: string;
    if (score >= 68) stance = "Nghiêng **TÍCH CỰC / theo dõi mua** (research stance)";
    else if (score >= 55) stance = "Nghiêng **TRUNG LẬP — hơi tích cực**";
    else if (score >= 45) stance = "Nghiêng **TRUNG LẬP**";
    else if (score >= 32) stance = "Nghiêng **TRUNG LẬP — hơi thận trọng**";
    else stance = "Nghiêng **THẬN TRỌNG / giảm tỷ trọng** (research stance)";

    parts.push(`${stance}.`);
    parts.push(`Độ tin cậy tổng hợp (quant blend): **${score}%**${factors ? ` · dựa trên ${factors} nhóm tín hiệu` : ""}.`);
    parts.push(
      "Lưu ý: đây là góc nhìn định lượng từ dữ liệu tại thời điểm trả lời, phục vụ **nghiên cứu** — **không phải khuyến nghị mua/bán**.",
    );
    if (deep && (c.news_context as unknown[])?.length) {
      const news = c.news_context as { title?: string; source?: string }[];
      parts.push("Tin liên quan: " + news.slice(0, 3).map((n) => n.title).filter(Boolean).join("; ") + ".");
    }
    sections.push(parts.join("\n"));
  }

  return {
    narrative: sections.join("\n\n"),
    contract: c as unknown as Record<string, unknown>,
    sectionsUsed: ["vn-stock", "market-state-engine", "technical", "financial-health", "valuation"],
    symbols: [symbol],
    freshnesses: [analysis.meta.freshness],
    persona: "stock_analyst",
  };
}

export { buildVn };

import "server-only";
import { buildStockAnalysis } from "./intelligence";
import { getVnOhlcv } from "./stocks";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { periodsToLegacyRows } from "../financial/vndirect-fs";
import { hubFinancialPackage, hubVnQuotes, hubNews } from "../data-engine";
import { getVndValuationRatios, getVndEquitySnapshot, getVndCompanyProfile } from "../providers/vndirect-company";
import { computeFinancialHealth } from "../engines/fundamental";
import { analyzeSeries, detectPatterns } from "../technical";
import { computeInvestmentPerformance } from "../financial/investment-performance";
import { buildMarketIntel } from "./market-intel";
import { getSectorTrendForSymbol } from "./sector-trend";
import type { FreshnessStatus, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

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

function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: d });
}

function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function fmtTy(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v / 1e9).toFixed(1)} tỷ`;
}

async function loadBars(symbol: string): Promise<OhlcvBar[]> {
  try {
    const o = await getVnOhlcv(symbol, 260);
    if (o?.bars?.length) return o.bars;
  } catch {
    /* */
  }
  try {
    const d = await fetchVndDchartHistory(symbol, "D", 280);
    if (d?.length) return d;
  } catch {
    /* */
  }
  return [];
}

/**
 * Phân tích cổ phiếu VN — multi-source via Data Engine Hub (shared request scope).
 */
async function buildVn(symbol: string, deep: boolean): Promise<Built> {
  const sym = symbol.trim().toUpperCase();
  const sectionsUsed: string[] = [];
  const freshnesses: FreshnessStatus[] = [];
  const contract: Record<string, unknown> = {
    asset: { symbol: sym, asset_type: "stock" },
  };

  const analysis = await buildStockAnalysis(sym).catch(() => null);

  const [quotePack, bars, fs, ratios, equity, profile, idxBars, news, marketPack, sectorPack] = await Promise.all([
    hubVnQuotes([sym]).catch(() => null),
    loadBars(sym),
    hubFinancialPackage(sym)
      .then((r) => (r?.pkg?.periods?.length ? { periods: r.pkg.periods } : null))
      .catch(() => null),
    getVndValuationRatios(sym).catch(() => null),
    getVndEquitySnapshot(sym).catch(() => null),
    getVndCompanyProfile(sym).catch(() => null),
    fetchVndDchartHistory("VNINDEX", "D", 280).catch(() => [] as OhlcvBar[]),
    hubNews({ symbol: sym, limit: deep ? 5 : 3 }).catch(() => null),
    buildMarketIntel().catch(() => null),
    getSectorTrendForSymbol(sym).catch(() => null),
  ]);

  let quote: Quote | null =
    analysis?.detail?.quote ??
    ((quotePack?.quotes?.[0] as unknown as Quote | undefined) ?? null);
  const qMeta = quotePack?.meta as { freshness?: FreshnessStatus } | undefined | null;
  if (qMeta?.freshness) freshnesses.push(qMeta.freshness);
  if (analysis?.meta?.freshness) freshnesses.push(analysis.meta.freshness);

  const name =
    profile?.vnName ??
    profile?.enName ??
    analysis?.detail?.name ??
    quote?.name ??
    null;

  let technical: TechnicalSnapshot | null =
    analysis?.detail?.technical ?? null;
  let patterns = analysis?.detail?.patterns ?? [];
  if ((!technical || bars.length > (analysis?.detail?.bars?.length ?? 0)) && bars.length >= 20) {
    try {
      technical = analyzeSeries(bars);
      patterns = detectPatterns(bars);
    } catch {
      /* */
    }
  }
  if (bars.length) sectionsUsed.push("ohlcv");
  if (technical) sectionsUsed.push("technical");

  let health = analysis?.detail?.financialHealth ?? null;
  let income0: Record<string, unknown> = {};
  if (fs?.periods?.length) {
    sectionsUsed.push("bctc");
    const rows = periodsToLegacyRows(fs.periods, sym);
    income0 = (rows.income[0] ?? {}) as Record<string, unknown>;
    if (!health) {
      try {
        health = computeFinancialHealth(
          {
            income: rows.income as Record<string, unknown>[],
            balance: rows.balance as Record<string, unknown>[],
            cashflow: rows.cashflow as Record<string, unknown>[],
          },
          { symbol: sym },
        );
      } catch {
        /* */
      }
    }
  } else if (analysis?.contract?.fundamental_state?.financial_health) {
    health = analysis.contract.fundamental_state.financial_health as typeof health;
  }
  if (health) sectionsUsed.push("financial-health");

  const pe = ratios?.pe ?? null;
  const pb = ratios?.pb ?? null;
  const ps = ratios?.ps ?? null;
  const eps = ratios?.eps ?? null;
  const dy = ratios?.dividendYield ?? null;
  if (ratios) sectionsUsed.push("valuation-ratios");

  const closes = bars.map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);
  const indexCloses = (idxBars ?? [])
    .map((b) => Number(b.close))
    .filter((c) => Number.isFinite(c) && c > 0);
  const ni =
    typeof income0.netIncome === "number"
      ? income0.netIncome
      : typeof income0.netProfit === "number"
        ? income0.netProfit
        : null;
  const price = quote?.price ?? closes[closes.length - 1] ?? null;
  const shares = equity?.sharesOutstanding ?? health?.anchors?.shares ?? null;
  let annualDividendCash: number | null = null;
  if (dy != null && dy > 0 && price != null && shares != null && shares > 0) {
    const priceVnd = price < 500 ? price * 1000 : price;
    annualDividendCash = dy * priceVnd * shares;
  }
  const perf = computeInvestmentPerformance({
    closes,
    indexCloses,
    dividendYield: dy,
    netIncome: typeof ni === "number" ? ni : null,
    annualDividendCash,
  });
  if (perf.sampleDays >= 5) sectionsUsed.push("performance");

  const sections: string[] = [];
  sections.push(`## ${sym}${name ? ` — ${name}` : ""}`);

  if (marketPack?.intel) {
    sectionsUsed.push("market-context");
    freshnesses.push(marketPack.meta.freshness);
    const m = marketPack.intel;
    const idx = m.indices?.slice(0, 3).map((x) => `${x.code} ${fmtPct(x.changePercent)}`).join(", ") || "chưa có";
    sections.push(`## Bối cảnh thị trường\nChỉ số: ${idx}. Regime/điều kiện thị trường: **${m.condition.rating}**${m.condition.confidence ? ` (độ tin cậy ${m.condition.confidence})` : ""}. Breadth: ${m.breadth.available ? `${m.breadth.advancers} tăng / ${m.breadth.decliners} giảm` : "chưa có"}; thanh khoản: ${m.liquidity.available ? fmtTy(m.liquidity.valueTraded) : "chưa có"}.`);
  }

  if (sectorPack?.row) {
    sectionsUsed.push("industry-context");
    freshnesses.push(sectorPack.meta.freshness);
    const row = sectorPack.row;
    const leaders = row.topGainers.slice(0, 3).map((x) => x.symbol).join(", ") || "chưa có";
    sections.push(`## Bối cảnh ngành — ${sectorPack.sector}\nXu hướng ngành: **${row.trendLabelVi}** · trend score ${row.trendScore ?? "—"} · thay đổi TB ${fmtPct(row.avgChangePercent)} · breadth ${row.advances} tăng / ${row.declines} giảm. Mã dẫn dắt trong nhóm: ${leaders}.`);
  }

  if (quote?.price != null) {
    sectionsUsed.push("quote");
    const bits = [
      `**Giá**: ${fmt(quote.price)}` +
        (quote.changePercent != null ? ` (${fmtPct(quote.changePercent)})` : ""),
    ];
    if (quote.volume != null) bits.push(`**KL**: ${fmt(quote.volume, 0)}`);
    if (quote.high != null || quote.low != null) {
      bits.push(`**Cao/Thấp**: ${fmt(quote.high)} / ${fmt(quote.low)}`);
    }
    if (quote.referencePrice != null) bits.push(`**TC**: ${fmt(quote.referencePrice)}`);
    sections.push(`## Giá & khối lượng\n${bits.join(" · ")}.`);
  } else if (closes.length) {
    sectionsUsed.push("quote");
    sections.push(
      `## Giá & khối lượng\n**Giá đóng gần nhất (dchart)**: ${fmt(closes[closes.length - 1])} · ${closes.length} phiên lịch sử.`,
    );
  } else {
    sections.push(`## Giá & khối lượng\n${sym}: chưa lấy được quote realtime — đang thử lại từ multi-source.`);
  }

  if (technical) {
    const parts: string[] = ["## Tín hiệu kỹ thuật"];
    if (technical.trend?.label) {
      parts.push(
        `Xu hướng: **${technical.trend.label}**` +
          (technical.trend.score != null ? ` (score ${technical.trend.score.toFixed(1)})` : "") +
          ".",
      );
    }
    if (technical.rsi14 != null) {
      const zone =
        technical.rsi14 >= 70 ? "quá mua" : technical.rsi14 <= 30 ? "quá bán" : "trung tính";
      parts.push(`RSI14: **${technical.rsi14.toFixed(1)}** (${zone}).`);
    }
    if (technical.macd?.histogram != null) {
      parts.push(
        `MACD histogram: **${technical.macd.histogram >= 0 ? "+" : ""}${technical.macd.histogram.toFixed(3)}**.`,
      );
    }
    if (technical.sma) {
      const s = technical.sma;
      const ma: string[] = [];
      if (s.sma20 != null) ma.push(`SMA20 ${fmt(s.sma20)}`);
      if (s.sma50 != null) ma.push(`SMA50 ${fmt(s.sma50)}`);
      if (s.sma200 != null) ma.push(`SMA200 ${fmt(s.sma200)}`);
      if (ma.length) parts.push(`MA: ${ma.join(" · ")}.`);
    }
    if (technical.support?.length) {
      parts.push(`Hỗ trợ: ${technical.support.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
    }
    if (technical.resistance?.length) {
      parts.push(`Kháng cự: ${technical.resistance.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
    }
    if (patterns.length) {
      parts.push(
        "Mẫu nến gần: " +
          patterns
            .slice(-3)
            .map((p) => ("name" in p ? String((p as { name?: string }).name ?? p) : String(p)))
            .join("; ") +
          ".",
      );
    }
    sections.push(parts.join("\n"));
  } else {
    sections.push(
      `## Tín hiệu kỹ thuật\n${bars.length ? `Có ${bars.length} nến nhưng chưa đủ ≥20 phiên ổn định để tính chỉ báo.` : "Chưa đủ chuỗi OHLCV để tính chỉ báo kỹ thuật."}`,
    );
  }

  if (health?.scores) {
    const sc = health.scores;
    const parts = ["## Sức khỏe tài chính"];
    if (sc.overall != null) parts.push(`Điểm tổng: **${Math.round(sc.overall)}/100**.`);
    const sub: string[] = [];
    if (sc.profitability != null) sub.push(`Sinh lời ${Math.round(sc.profitability)}`);
    if (sc.leverage != null) sub.push(`Đòn bẩy ${Math.round(sc.leverage)}`);
    if (sc.cashflow != null) sub.push(`Dòng tiền ${Math.round(sc.cashflow)}`);
    if (sc.liquidity != null) sub.push(`Thanh khoản ${Math.round(sc.liquidity)}`);
    if (sub.length) parts.push(sub.join(" · ") + ".");
    if (typeof ni === "number") parts.push(`LNST kỳ gần (BCTC): **${fmtTy(ni)}**.`);
    const rev =
      typeof income0.netRevenue === "number"
        ? income0.netRevenue
        : typeof income0.revenue === "number"
          ? income0.revenue
          : null;
    if (typeof rev === "number") parts.push(`Doanh thu kỳ gần: **${fmtTy(rev)}**.`);
    sections.push(parts.join("\n"));
  } else {
    sections.push(
      "## Sức khỏe tài chính\nChưa đủ BCTC chuẩn hóa để chấm điểm — đã thử qua Data Engine Hub / VNDirect.",
    );
  }

  {
    const parts = ["## Định giá"];
    const has = pe != null || pb != null || ps != null || eps != null;
    if (has) {
      const bits: string[] = [];
      if (pe != null) bits.push(`P/E **${pe.toFixed(1)}x**`);
      if (pb != null) bits.push(`P/B **${pb.toFixed(2)}x**`);
      if (ps != null) bits.push(`P/S **${ps.toFixed(2)}x**`);
      if (eps != null) bits.push(`EPS **${fmt(eps)}**`);
      if (dy != null) bits.push(`Tỷ suất cổ tức **${(dy * 100).toFixed(2)}%**`);
      parts.push(bits.join(" · ") + ".");
    } else {
      parts.push("Chưa đủ dữ liệu ratios (P/E, P/B…) từ VNDirect finfo.");
    }
    if (shares != null) parts.push(`SLCP lưu hành: **${fmt(shares, 0)}**.`);
    if (price != null && shares != null) {
      const mcap = price * shares * (price < 500 ? 1000 : 1);
      parts.push(`Vốn hóa ước tính: **${fmtTy(mcap)}**.`);
    }
    sections.push(parts.join("\n"));
  }

  if (perf.sampleDays >= 5) {
    const parts = ["## Hiệu suất đầu tư"];
    if (perf.tsr1y != null) parts.push(`TSR ~12 tháng: **${(perf.tsr1y * 100).toFixed(1)}%**.`);
    if (perf.beta != null) parts.push(`Beta vs VNINDEX: **${perf.beta.toFixed(2)}**.`);
    if (perf.sharpe != null) parts.push(`Sharpe: **${perf.sharpe.toFixed(2)}**.`);
    if (perf.alpha != null) parts.push(`Alpha (Jensen): **${(perf.alpha * 100).toFixed(1)}%**.`);
    sections.push(parts.join("\n"));
  }

  {
    const evidence: string[] = ["## Tổng hợp bằng chứng"];
    if (technical?.trend?.label) evidence.push(`**Technical trend engine:** ${technical.trend.label}${technical.trend.score != null ? ` (score ${technical.trend.score.toFixed(1)})` : ""}.`);
    if (health?.scores?.overall != null) evidence.push(`**Financial health engine:** ${Math.round(health.scores.overall)}/100.`);
    if (perf.sampleDays >= 5 && perf.alpha != null) evidence.push(`**Relative performance:** Alpha Jensen ${(perf.alpha * 100).toFixed(1)}% trên mẫu ${perf.sampleDays} phiên.`);
    if (evidence.length <= 1) evidence.push("Chưa có đủ tín hiệu engine để tổng hợp.");
    evidence.push("Đây là tổng hợp dữ liệu kỹ thuật, tài chính và hiệu suất đã tính; không phải điểm khuyến nghị mới.");
    sections.push(evidence.join("\n"));
  }

  if (news?.articles?.length) {
    sectionsUsed.push("news");
    sections.push(
      "## Tin liên quan\n" +
        news.articles
          .slice(0, 3)
          .map((a: { title: string }) => `- ${a.title}`)
          .join("\n"),
    );
  }

  contract.market_data = quote
    ? {
        price: quote.price,
        change_percent: quote.changePercent,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
      }
    : closes.length
      ? { price: closes[closes.length - 1], source: "dchart-close" }
      : null;
  contract.technical_state = technical;
  contract.fundamental_state = {
    financial_health: health,
    valuation: { pe, pb, ps, eps, dividendYield: dy },
  };
  contract.performance = perf;
  contract.market_context = marketPack?.intel
    ? { indices: marketPack.intel.indices, condition: marketPack.intel.condition, breadth: marketPack.intel.breadth, liquidity: marketPack.intel.liquidity, crossAsset: marketPack.intel.crossAsset, timestamp: marketPack.meta.sourceTimestamp }
    : null;
  contract.industry_context = sectorPack?.row
    ? { sector: sectorPack.sector, trend: sectorPack.row.trendLabelVi, trendScore: sectorPack.row.trendScore, avgChangePercent: sectorPack.row.avgChangePercent, medianChangePercent: sectorPack.row.medianChangePercent, breadth: { advances: sectorPack.row.advances, declines: sectorPack.row.declines, unchanged: sectorPack.row.unchanged }, leaders: sectorPack.row.topGainers, laggards: sectorPack.row.topLosers, sessionDate: sectorPack.snapshot.sessionDate }
    : null;
  contract.news = news?.articles?.slice(0, deep ? 5 : 3).map((a: { title: string; publishedAt?: string; source?: string }) => ({ title: a.title, publishedAt: a.publishedAt, source: a.source })) ?? [];
  contract.risks = health?.riskFlags ?? [];
  contract.catalysts = [];
  contract.data_quality = {
    financialPeriods:
      fs?.periods?.map((p) => ({
        year: p.year ?? undefined,
        quarter: p.quarter ?? undefined,
      })) ?? [],
    missing: [!health && "financial-health", !(pe != null || pb != null || ps != null || eps != null) && "valuation-ratios", !technical && "technical", !marketPack && "market-context", !sectorPack?.row && "industry-context"].filter(Boolean),
  };
  contract.profile = profile
    ? { vnName: profile.vnName, floor: profile.floor }
    : null;
  contract.bars_count = bars.length;

  const hasAny =
    quote?.price != null ||
    closes.length > 0 ||
    !!health ||
    pe != null ||
    pb != null ||
    !!technical;

  return {
    narrative: sections.join("\n\n"),
    contract,
    sectionsUsed: [...new Set(sectionsUsed)],
    symbols: [sym],
    freshnesses,
    unavailable: !hasAny,
    persona: "stock_analyst",
  };
}

export { buildVn };

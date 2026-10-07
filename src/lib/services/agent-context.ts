import "server-only";
import { buildMarketSnapshot } from "./market";
import { getCryptoMarkets } from "./crypto";
import { getForexMarkets } from "./forex";
import { getEconomicData } from "./economy";
import { getVnIndices } from "./stocks";
import { periodsToLegacyRows } from "../financial/vndirect-fs";
import {
  hubFinancialPackage,
  hubVnQuotes,
  hubCryptoDetail,
  hubForexDetail,
  hubCommodityMarket,
} from "../data-engine";
import { computeInvestmentPerformance } from "../financial/investment-performance";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { getVndValuationRatios, getVndEquitySnapshot } from "../providers/vndirect-company";
import { buildVn } from "./agent-vn-stock";
import { getSectorTrendSnapshot } from "./sector-trend";
import type { EconomicSnapshot } from "../economic-data";
import type { FreshnessStatus } from "../types";

export type AgentBuilt = {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
};

function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function fmtNum(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}

function economicRows(snap: EconomicSnapshot | null | undefined) {
  return (snap?.rows ?? []).filter((r) => r.current?.value != null);
}

/** Tổng quan đa tài sản — dùng cho câu hỏi thị trường / general */
export async function buildUniverseOverview(): Promise<AgentBuilt> {
  const [mkt, crypto, fx, cmd, rates, macro, indices] = await Promise.all([
    buildMarketSnapshot().catch(() => null),
    getCryptoMarkets().catch(() => null),
    getForexMarkets().catch(() => null),
    hubCommodityMarket().catch(() => null),
    getEconomicData("currency-interest-rate").catch(() => null),
    getEconomicData("macro-economic").catch(() => null),
    getVnIndices().catch(() => null),
  ]);

  const sections: string[] = ["## Tổng quan đa tài sản (ORCA)"];
  const sectionsUsed: string[] = [];
  const freshnesses: FreshnessStatus[] = [];
  const contract: Record<string, unknown> = { scope: "universe" };

  if (mkt) {
    const p = mkt.snapshot.pulse;
    sections.push(`### Thị trường Việt Nam\n**${p.headline}**\n\n${p.body.slice(0, 3).join("\n\n")}`);
    sectionsUsed.push("market-snapshot");
    freshnesses.push(...Object.values(mkt.meta.sections ?? {}), mkt.meta.freshness);
    contract.vn_pulse = p;
  }

  if (indices?.items?.length) {
    const lines = indices.items.slice(0, 6).map((i) => {
      const chg = i.changePercent != null ? fmtPct(i.changePercent) : "—";
      return `- **${i.code}**: ${fmtNum(i.value, 2)} (${chg})`;
    });
    sections.push(`### Chỉ số VN\n${lines.join("\n")}`);
    sectionsUsed.push("vn-indices");
    if (indices.meta?.freshness) freshnesses.push(indices.meta.freshness);
    contract.indices = indices.items.slice(0, 8);
  }

  if (crypto?.rows?.length) {
    const top = crypto.rows.slice(0, 6);
    const lines = top.map((r) => {
      const sym = (r.symbol ?? "").replace(/USDT$/, "");
      return `- **${sym}**: ${fmtNum(r.price, 4)} (${fmtPct(r.changePercent)})`;
    });
    const sum = crypto.summary;
    sections.push(
      `### Crypto\n${sum ? `Breadth: ${sum.advancers ?? "?"} tăng / ${sum.decliners ?? "?"} giảm. ` : ""}\n${lines.join("\n")}`,
    );
    sectionsUsed.push("crypto-markets");
    if (crypto.meta?.freshness) freshnesses.push(crypto.meta.freshness);
    contract.crypto_top = top.map((r) => ({
      symbol: r.symbol,
      price: r.price,
      changePercent: r.changePercent,
    }));
  }

  if (fx?.data?.rows?.length) {
    const majors = fx.data.rows
      .filter((r) => r.group === "major" || /USD|EUR|JPY|GBP/.test(r.pair))
      .slice(0, 8);
    const lines = majors.map((r) => `- **${r.pair}**: ${fmtNum(r.price, 5)} (${fmtPct(r.changePercent)})`);
    sections.push(`### Forex\n${lines.join("\n")}`);
    sectionsUsed.push("forex");
    if (fx.meta?.freshness) freshnesses.push(fx.meta.freshness);
    contract.forex_majors = majors.map((r) => ({
      pair: r.pair,
      price: r.price,
      changePercent: r.changePercent,
    }));
  }

  // hubCommodityMarket → VnbGoodsSnapshot { items: { def, quote }[] }
  if (cmd?.items?.length) {
    const items = cmd.items;
    const lines = items.slice(0, 8).map((r) => {
      const name = r.def?.name ?? r.def?.symbol ?? "?";
      return `- **${name}**: ${fmtNum(r.quote?.price, 2)} (${fmtPct(r.quote?.changePercent ?? null)})`;
    });
    sections.push(`### Hàng hóa\n${lines.join("\n")}`);
    sectionsUsed.push("commodities");
    contract.commodities = items.slice(0, 8).map((r) => ({
      symbol: r.def?.symbol,
      name: r.def?.name,
      price: r.quote?.price,
      changePercent: r.quote?.changePercent,
    }));
  }

  const rateRows = economicRows(rates?.data);
  if (rateRows.length) {
    const lines = rateRows
      .slice(0, 10)
      .map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
    sections.push(`### Lãi suất & tỷ giá (VietnamBiz)\n${lines.join("\n")}`);
    sectionsUsed.push("currency-interest-rate");
    if (rates?.meta?.freshness) freshnesses.push(rates.meta.freshness);
    contract.rates = rateRows.slice(0, 10).map((r) => ({
      name: r.name,
      value: r.current.value,
      period: r.period,
    }));
  }

  const macroRows = economicRows(macro?.data);
  if (macroRows.length) {
    const lines = macroRows
      .slice(0, 10)
      .map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
    sections.push(`### Kinh tế vĩ mô VN\n${lines.join("\n")}`);
    sectionsUsed.push("macro-economic");
    if (macro?.meta?.freshness) freshnesses.push(macro.meta.freshness);
    contract.macro = macroRows.slice(0, 10).map((r) => ({
      name: r.name,
      value: r.current.value,
      period: r.period,
    }));
  }

  if (sections.length <= 1) {
    return {
      narrative: "Chưa lấy được snapshot đa tài sản từ các nguồn hệ thống. Thử lại sau ít phút.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: [],
      unavailable: true,
    };
  }

  sections.push(
    "\n*Số liệu lấy trực tiếp từ pipeline ORCA (VNDirect / Binance / FX / VietnamBiz) tại thời điểm trả lời — không phải khuyến nghị đầu tư.*",
  );

  return {
    narrative: sections.join("\n\n"),
    contract,
    sectionsUsed,
    symbols: [],
    freshnesses,
  };
}

export async function buildForexContext(pair: string): Promise<AgentBuilt> {
  // hubForexDetail → { pair, rate, ts, rates }
  const r = await hubForexDetail(pair).catch(() => null);
  if (!r || r.rate == null) {
    return {
      narrative: `${pair}: chưa lấy được dữ liệu forex.`,
      contract: { pair, error: "unavailable" },
      sectionsUsed: [],
      symbols: [pair],
      freshnesses: [],
      unavailable: true,
    };
  }
  const price = typeof r.rate === "number" ? r.rate : null;
  const narrative = [
    `## ${r.pair ?? pair}`,
    `Giá: **${fmtNum(price, 5)}**`,
    r.ts != null ? `Cập nhật: ${new Date(r.ts).toISOString()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    narrative,
    contract: {
      pair: r.pair ?? pair,
      price,
      rates: r.rates,
      ts: r.ts,
    },
    sectionsUsed: ["forex-detail"],
    symbols: [pair],
    freshnesses: [],
  };
}

export async function buildCommodityContext(query: string): Promise<AgentBuilt> {
  const snap = await hubCommodityMarket().catch(() => null);
  // VnbGoodsSnapshot: { items: { def, quote }[], fetchedAt }
  if (!snap?.items?.length) {
    return {
      narrative: "Chưa lấy được bảng hàng hóa.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: [],
      unavailable: true,
    };
  }
  type Row = {
    name: string | null;
    symbol: string | null;
    group: string | null;
    price: number | null;
    changePercent: number | null;
    currency: string | null;
    unit: string | null;
    updatedAt: string | null;
    source: string | null;
  };
  const items: Row[] = snap.items.map((it) => ({
    name: it.def?.name ?? it.def?.nameVi ?? null,
    symbol: it.def?.symbol ?? null,
    group: it.def?.group ?? null,
    price: it.quote?.price ?? null,
    changePercent: it.quote?.changePercent ?? null,
    currency: it.quote?.currency ?? it.def?.currency ?? null,
    unit: it.quote?.unit ?? it.def?.unit ?? null,
    updatedAt: it.quote?.timestamp != null ? new Date(it.quote.timestamp).toISOString() : null,
    source: it.quote?.source ?? null,
  }));
  const q = query.toLowerCase();
  const focused =
    items.find((i) => {
      const hay = `${i.name ?? ""} ${i.symbol ?? ""} ${i.group ?? ""}`.toLowerCase();
      if (/vàng|gold|xau|sjc/.test(q)) return /gold|vàng|xau|sjc/i.test(hay);
      if (/bạc|silver|xag/.test(q)) return /silver|bạc|xag/i.test(hay);
      if (/dầu|oil|wti|brent/.test(q)) return /oil|wti|brent|dầu|nang_luong/i.test(hay);
      if (/hrc|quặng sắt|iron|thép/.test(q)) return /hrc|quặng|iron|thép|vat_lieu/i.test(hay);
      if (/robusta|arabica|cà phê|coffee/.test(q)) return /robusta|arabica|cà phê|coffee/i.test(hay);
      if (/đồng|copper/.test(q)) return /đồng|copper/i.test(hay);
      return false;
    }) ?? items[0];

  const hay = `${focused?.name ?? ""} ${focused?.symbol ?? ""} ${focused?.group ?? ""}`.toLowerCase();
  const transmission = /dầu|oil|wti|brent|nang_luong/.test(hay)
    ? { industries: ["Dầu khí"], symbols: ["GAS", "PVD", "PVS"], mechanism: "Giá dầu có thể truyền dẫn khác nhau qua upstream, midstream và downstream; cần dữ liệu cơ cấu doanh thu/độ nhạy từng doanh nghiệp trước khi kết luận lợi ích." }
    : /hrc|thép|quặng|iron|vat_lieu/.test(hay)
      ? { industries: ["Thép"], symbols: ["HPG", "HSG", "NKG"], mechanism: "HRC là đầu vào/giá tham chiếu quan trọng của một số phân khúc thép; tác động phụ thuộc giá bán, tồn kho, sản lượng và biên gộp." }
      : /robusta|arabica|cà phê|coffee/.test(hay)
        ? { industries: ["Nông nghiệp", "Thực phẩm & Đồ uống"], symbols: [], mechanism: "Giá cà phê tác động qua giá nguyên liệu, khả năng chuyển giá và tỷ trọng doanh thu liên quan; chưa khẳng định doanh nghiệp hưởng lợi nếu thiếu dữ liệu." }
        : { industries: [], symbols: [], mechanism: "Chưa có mapping truyền dẫn đủ cụ thể trong commodity context." };

  const direction =
    focused?.changePercent == null
      ? "chưa xác định hướng"
      : focused.changePercent > 0
        ? "tăng trong dữ liệu hiện tại"
        : focused.changePercent < 0
          ? "giảm trong dữ liệu hiện tại"
          : "đi ngang trong dữ liệu hiện tại";
  const currentLine = focused
    ? `Giá hiện tại: **${fmtNum(focused.price, 4)} ${focused.currency ?? ""}/${focused.unit ?? "đơn vị"}** · thay đổi phiên: **${fmtPct(focused.changePercent ?? null)}** · ${direction}.`
    : "Chưa có giá hiện tại.";

  const lines = items
    .slice(0, 10)
    .map(
      (i) =>
        `- **${i.name ?? i.symbol}**: ${fmtNum(i.price, 4)} ${i.currency ?? ""}/${i.unit ?? "đơn vị"} · ${fmtPct(i.changePercent ?? null)} · cập nhật ${i.updatedAt ?? "—"}`,
    );
  const narrative = [
    "## Hàng hóa",
    focused
      ? `Tiêu điểm: **${focused.name ?? focused.symbol}** (${focused.group ?? "chưa phân nhóm"}).\n${currentLine}`
      : null,
    focused
      ? `**Nguồn & thời điểm:** ${focused.source ?? "chưa có nguồn"} · ${focused.updatedAt ?? "chưa có timestamp"} · timeframe được hỗ trợ trong context: **current/session**; chưa tự tạo day/week/month nếu engine không cung cấp.`
      : null,
    focused
      ? `**Commodity → Industry → Stock:** ${transmission.mechanism}\nNgành có thể liên quan: ${transmission.industries.join(", ") || "chưa xác định"}. Mã cần kiểm chứng thêm: ${transmission.symbols.join(", ") || "chưa có mapping mã"}.`
      : null,
    focused
      ? "**Technical / cung cầu / tin tức:** chưa có các trường tương ứng trong commodity aggregator; không suy diễn thay thế."
      : null,
    lines.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    narrative,
    contract: {
      items: items.slice(0, 12),
      focus: focused,
      metadata: focused
        ? {
            price: focused.price,
            unit: focused.unit,
            currency: focused.currency,
            changePercent: focused.changePercent,
            updatedAt: focused.updatedAt,
            source: focused.source,
          }
        : null,
      transmission,
      timeframe: "current/session",
      missing: [
        "dayChangeHistory",
        "weekChangeHistory",
        "monthChangeHistory",
        "technical",
        "inventory",
        "supplyDemand",
        "news",
      ],
      drivers: focused ? [`Biến động hiện tại ${fmtPct(focused.changePercent ?? null)}`] : [],
      risks: [
        "Giá có thể khác thời điểm giữa các nguồn",
        "Tác động truyền dẫn có độ trễ và phụ thuộc phân khúc/doanh nghiệp",
      ],
      catalysts: [],
      sources: focused?.source ? [focused.source] : [],
    },
    sectionsUsed: ["commodities"],
    symbols: focused?.symbol ? [String(focused.symbol)] : [],
    freshnesses: [],
  };
}

/** Xu hướng ngành — dùng sector-trend engine, không tạo score mới bằng LLM. */
export async function buildIndustryContext(query: string): Promise<AgentBuilt> {
  const needle = query.match(/ngân hàng|banking|dầu khí|oil.?gas|thép|steel|công nghệ|technology|bất động sản|bán lẻ/i)?.[0];
  const r = await getSectorTrendSnapshot(needle ? { sector: needle } : undefined).catch(() => null);
  if (!r?.snapshot?.sectors?.length) {
    return { narrative: "Chưa lấy được bảng xu hướng ngành.", contract: {}, sectionsUsed: [], symbols: [], freshnesses: [], unavailable: true };
  }
  const rows = r.snapshot.sectors.slice(0, 8);
  const focus = rows[0];
  const lines = rows.map((x) => `- **${x.sector}**: ${x.trendLabelVi} · trend score ${x.trendScore ?? "—"} · thay đổi TB ${fmtPct(x.avgChangePercent)} · breadth ${x.advances} tăng / ${x.declines} giảm / ${x.unchanged} tham chiếu · thanh khoản ${fmtNum(x.totalValue, 0)}`);
  const leaders = focus?.topGainers?.slice(0, 5).map((x) => `${x.symbol} ${fmtPct(x.changePercent)}`).join(", ") || "chưa có";
  const laggards = focus?.topLosers?.slice(0, 5).map((x) => `${x.symbol} ${fmtPct(x.changePercent)}`).join(", ") || "chưa có";
  return {
    narrative: [`## Ngành${focus ? ` — ${focus.sector}` : ""}`, focus ? `**Tóm tắt xu hướng:** ${focus.trendLabelVi}; relative strength theo trend score engine **${focus.trendScore ?? "chưa có"}**.` : null, focus ? `**Breadth & thanh khoản:** ${focus.advances} tăng / ${focus.declines} giảm / ${focus.unchanged} tham chiếu; giá trị giao dịch cộng dồn ${fmtNum(focus.totalValue, 0)}.` : null, focus ? `**Cổ phiếu dẫn dắt:** ${leaders}.\n**Cổ phiếu yếu:** ${laggards}.` : null, lines.join("\n"), "**Kết quả kinh doanh, định giá, NIM/NPL/CASA, biên lợi nhuận và catalyst:** chưa có trong sector-trend context; không suy diễn thay thế.", "**Rủi ro:** trend score và breadth phản ánh dữ liệu bảng giá phiên, có thể đảo chiều; cần đối chiếu thêm dữ liệu cơ bản và hàng hóa/vĩ mô khi câu hỏi yêu cầu.", `**Timestamp phiên:** ${r.snapshot.sessionDate ?? "—"}.`].filter(Boolean).join("\n\n"),
    contract: {
      focus,
      sectors: rows,
      marketAvgChangePercent: r.snapshot.marketAvgChangePercent,
      sessionDate: r.snapshot.sessionDate,
      criteria: ["trendScore", "avgChangePercent", "breadth", "totalValue"],
      drivers: focus ? [`${focus.trendLabelVi} theo trend score engine`, `Breadth ${focus.advances} tăng / ${focus.declines} giảm`] : [],
      risks: ["Trend score và breadth chỉ phản ánh dữ liệu bảng giá phiên", "Chưa có earnings/valuation trong context ngành"],
      catalysts: [],
      missing: ["earnings", "valuation", "macro", "relatedCommodity", "news"],
    },
    sectionsUsed: ["sector-trend"],
    symbols: focus?.topGainers?.map((x) => x.symbol).slice(0, 5) ?? [],
    freshnesses: [r.meta.freshness],
  };
}

export async function buildRatesMacroContext(kind: "rates" | "macro" | "both"): Promise<AgentBuilt> {
  const jobs: Promise<Awaited<ReturnType<typeof getEconomicData>> | null>[] = [];
  if (kind === "rates" || kind === "both") {
    jobs.push(getEconomicData("currency-interest-rate").catch(() => null));
  } else jobs.push(Promise.resolve(null));
  if (kind === "macro" || kind === "both") {
    jobs.push(getEconomicData("macro-economic").catch(() => null));
  } else jobs.push(Promise.resolve(null));

  const [rates, macro] = await Promise.all(jobs);
  const sections: string[] = [];
  const sectionsUsed: string[] = [];
  const freshnesses: FreshnessStatus[] = [];
  const contract: Record<string, unknown> = {};

  const pack = (
    title: string,
    key: string,
    packRes: Awaited<ReturnType<typeof getEconomicData>> | null,
  ) => {
    const list = economicRows(packRes?.data);
    if (!list.length) return;
    const lines = list
      .slice(0, 12)
      .map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
    sections.push(`## ${title}\n${lines.join("\n")}`);
    sectionsUsed.push(key);
    if (packRes?.meta?.freshness) freshnesses.push(packRes.meta.freshness);
    contract[key] = list.slice(0, 12).map((r) => ({
      name: r.name,
      value: r.current.value,
      period: r.period,
    }));
  };

  pack("Lãi suất & tỷ giá", "currency-interest-rate", rates);
  pack("Kinh tế vĩ mô", "macro-economic", macro);

  if (!sections.length) {
    return {
      narrative: "Chưa lấy được bảng lãi suất / vĩ mô từ VietnamBiz.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: [],
      unavailable: true,
    };
  }

  return {
    narrative: sections.join("\n\n"),
    contract,
    sectionsUsed,
    symbols: [],
    freshnesses,
  };
}

/** Bổ sung hiệu suất đầu tư + BCTC tóm tắt vào phân tích mã CK */
export async function enrichVnStockPerformance(symbol: string): Promise<string> {
  try {
    const [bars, idxBars, ratios, equity, fs] = await Promise.all([
      fetchVndDchartHistory(symbol, "D", 260).catch(() => []),
      fetchVndDchartHistory("VNINDEX", "D", 260).catch(() => []),
      getVndValuationRatios(symbol).catch(() => null),
      getVndEquitySnapshot(symbol).catch(() => null),
      hubFinancialPackage(symbol)
        .then((r) => (r?.pkg?.periods?.length ? { periods: r.pkg.periods } : null))
        .catch(() => null),
    ]);

    const closes = (bars ?? []).map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);
    const indexCloses = (idxBars ?? [])
      .map((b) => Number(b.close))
      .filter((c) => Number.isFinite(c) && c > 0);

    let ni: number | null = null;
    let rev: number | null = null;
    if (fs?.periods?.length) {
      const rows = periodsToLegacyRows(fs.periods, symbol);
      const i0 = (rows.income[0] ?? {}) as Record<string, unknown>;
      ni =
        typeof i0.netIncome === "number"
          ? i0.netIncome
          : typeof i0.netProfit === "number"
            ? i0.netProfit
            : null;
      rev =
        typeof i0.netRevenue === "number"
          ? i0.netRevenue
          : typeof i0.revenue === "number"
            ? i0.revenue
            : null;
    }

    const quote = await hubVnQuotes([symbol]).catch(() => null);
    const price = quote?.quotes?.[0]?.price ?? null;
    const shares = equity?.sharesOutstanding ?? null;
    let annualDividendCash: number | null = null;
    const dy = ratios?.dividendYield ?? null;
    if (dy != null && dy > 0 && price != null && shares != null && shares > 0) {
      const priceVnd = price < 500 ? price * 1000 : price;
      annualDividendCash = dy * priceVnd * shares;
    }

    const perf = computeInvestmentPerformance({
      closes,
      indexCloses,
      dividendYield: dy,
      netIncome: ni,
      annualDividendCash,
    });

    const bits: string[] = ["## Hiệu suất & định giá (số liệu hệ thống)"];
    if (perf.tsr1y != null) bits.push(`TSR ~12 tháng: **${(perf.tsr1y * 100).toFixed(1)}%** (theo giá)`);
    if (perf.beta != null) bits.push(`Beta vs VNINDEX: **${perf.beta.toFixed(2)}**`);
    if (perf.sharpe != null) bits.push(`Sharpe: **${perf.sharpe.toFixed(2)}**`);
    if (perf.alpha != null) bits.push(`Alpha (Jensen, năm): **${(perf.alpha * 100).toFixed(1)}%**`);
    if (perf.dividendYield != null)
      bits.push(`Tỷ suất cổ tức: **${(perf.dividendYield * 100).toFixed(2)}%**`);
    if (perf.payoutRatio != null)
      bits.push(`Payout ước tính: **${(perf.payoutRatio * 100).toFixed(0)}%**`);
    if (ratios?.pe != null) bits.push(`P/E: **${ratios.pe.toFixed(1)}x**`);
    if (ratios?.pb != null) bits.push(`P/B: **${ratios.pb.toFixed(2)}x**`);
    if (rev != null) bits.push(`DT kỳ gần (BCTC): **${(rev / 1e9).toFixed(1)} tỷ**`);
    if (ni != null) bits.push(`LNST kỳ gần: **${(ni / 1e9).toFixed(1)} tỷ**`);
    if (bits.length === 1) return "";
    return bits.join("\n");
  } catch {
    return "";
  }
}

export async function buildVnStockFull(symbol: string, deep: boolean): Promise<AgentBuilt> {
  const base = await buildVn(symbol, deep);
  const extra = await enrichVnStockPerformance(symbol);
  if (extra) {
    return {
      ...base,
      narrative: `${base.narrative}\n\n${extra}`,
      sectionsUsed: [...base.sectionsUsed, "investment-performance", "bctc", "ratios"],
    };
  }
  return base;
}

export async function buildCryptoContext(symbol: string): Promise<AgentBuilt> {
  // hubCryptoDetail → BinanceTicker24h (lastPrice, priceChangePercent, …)
  const r = await hubCryptoDetail(symbol).catch(() => null);
  const sym = symbol.replace(/USDT$/, "");
  if (!r) {
    return {
      narrative: `${sym}: dữ liệu không khả dụng từ Binance.`,
      contract: { asset: { symbol: sym, asset_type: "crypto" }, error: "unavailable" },
      sectionsUsed: [],
      symbols: [symbol],
      freshnesses: [],
      unavailable: true,
    };
  }
  const price = Number(r.lastPrice);
  const chg = Number(r.priceChangePercent);
  const narrative = [
    `## ${sym}`,
    `Giá **${fmtNum(Number.isFinite(price) ? price : null, 4)} USDT** · 24h ${fmtPct(Number.isFinite(chg) ? chg : null)}`,
    `High/Low: ${fmtNum(Number(r.highPrice), 4)} / ${fmtNum(Number(r.lowPrice), 4)} · Vol: ${fmtNum(Number(r.volume), 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    narrative,
    contract: {
      asset: { symbol: sym },
      market_data: {
        price: Number.isFinite(price) ? price : null,
        changePercent: Number.isFinite(chg) ? chg : null,
        high: Number(r.highPrice),
        low: Number(r.lowPrice),
        volume: Number(r.volume),
        symbol: r.symbol,
      },
    },
    sectionsUsed: ["crypto"],
    symbols: [symbol],
    freshnesses: [],
  };
}

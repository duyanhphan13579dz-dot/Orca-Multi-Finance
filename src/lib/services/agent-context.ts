import "server-only";
import { buildMarketSnapshot } from "./market";
import { getCryptoDetail, getCryptoMarkets } from "./crypto";
import { getForexDetail, getForexMarkets } from "./forex";
import { getCommodityMarket } from "./commodities";
import { getEconomicData } from "./economy";
import { getVnQuotes, getVnIndices } from "./stocks";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import { computeInvestmentPerformance } from "../financial/investment-performance";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { getVndValuationRatios, getVndEquitySnapshot } from "../providers/vndirect-company";
import { buildVn } from "./agent-vn-stock";
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

/** Tổng quan đa tài sản — dùng cho câu hỏi thị trường / general */
export async function buildUniverseOverview(): Promise<AgentBuilt> {
  const [mkt, crypto, fx, cmd, rates, macro, indices] = await Promise.all([
    buildMarketSnapshot().catch(() => null),
    getCryptoMarkets().catch(() => null),
    getForexMarkets().catch(() => null),
    getCommodityMarket().catch(() => null),
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
      return `- **${i.code}**: ${fmtNum(i.price, 2)} (${chg})`;
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
    const majors = fx.data.rows.filter((r) => r.group === "major" || /USD|EUR|JPY|GBP/.test(r.pair)).slice(0, 8);
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

  if (cmd?.data) {
    const items = (cmd.data.items ?? cmd.data.rows ?? []) as {
      symbol?: string;
      name?: string;
      price?: number;
      changePercent?: number | null;
    }[];
    if (items.length) {
      const lines = items.slice(0, 8).map((r) => {
        const name = r.name ?? r.symbol ?? "?";
        return `- **${name}**: ${fmtNum(r.price, 2)} (${fmtPct(r.changePercent ?? null)})`;
      });
      sections.push(`### Hàng hóa\n${lines.join("\n")}`);
      sectionsUsed.push("commodities");
      if (cmd.meta?.freshness) freshnesses.push(cmd.meta.freshness);
      contract.commodities = items.slice(0, 8);
    }
  }

  if (rates?.data) {
    const rows = (rates.data as { indicators?: { name: string; period: string; current: { value: number | null } }[] })
      .indicators ??
      (Array.isArray(rates.data) ? rates.data : []);
    const list = Array.isArray(rows) ? rows : [];
    const pick = list
      .filter((r: { current?: { value?: number | null } }) => r?.current?.value != null)
      .slice(0, 10) as { name: string; period: string; current: { value: number | null } }[];
    if (pick.length) {
      const lines = pick.map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
      sections.push(`### Lãi suất & tỷ giá (VietnamBiz)\n${lines.join("\n")}`);
      sectionsUsed.push("currency-interest-rate");
      if (rates.meta?.freshness) freshnesses.push(rates.meta.freshness);
      contract.rates = pick.map((r) => ({ name: r.name, value: r.current.value, period: r.period }));
    }
  }

  if (macro?.data) {
    const rows =
      (macro.data as { indicators?: { name: string; period: string; current: { value: number | null } }[] })
        .indicators ??
      (Array.isArray(macro.data) ? macro.data : []);
    const list = Array.isArray(rows) ? rows : [];
    const pick = list
      .filter((r: { current?: { value?: number | null } }) => r?.current?.value != null)
      .slice(0, 10) as { name: string; period: string; current: { value: number | null } }[];
    if (pick.length) {
      const lines = pick.map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
      sections.push(`### Kinh tế vĩ mô VN\n${lines.join("\n")}`);
      sectionsUsed.push("macro-economic");
      if (macro.meta?.freshness) freshnesses.push(macro.meta.freshness);
      contract.macro = pick.map((r) => ({ name: r.name, value: r.current.value, period: r.period }));
    }
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
  const r = await getForexDetail(pair).catch(() => null);
  if (!r) {
    return {
      narrative: `${pair}: chưa lấy được dữ liệu forex.`,
      contract: { pair, error: "unavailable" },
      sectionsUsed: [],
      symbols: [pair],
      freshnesses: [],
      unavailable: true,
    };
  }
  const d = r.detail;
  const tech = d.technical;
  const narrative = [
    `## ${d.pair ?? pair}`,
    `Giá: **${fmtNum(d.price, 5)}** · Biến động: ${fmtPct(d.changePercent)}`,
    tech
      ? `Kỹ thuật: xu hướng ${tech.trend?.label ?? "—"} · RSI14 ${tech.rsi14 != null ? tech.rsi14.toFixed(1) : "—"}`
      : "Chưa đủ chuỗi chỉ báo.",
  ].join("\n\n");
  return {
    narrative,
    contract: { pair: d.pair, price: d.price, changePercent: d.changePercent, technical: tech },
    sectionsUsed: ["forex-detail"],
    symbols: [pair],
    freshnesses: [r.meta.freshness],
  };
}

export async function buildCommodityContext(query: string): Promise<AgentBuilt> {
  const r = await getCommodityMarket().catch(() => null);
  if (!r?.data) {
    return {
      narrative: "Chưa lấy được bảng hàng hóa.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: [],
      unavailable: true,
    };
  }
  const items = (r.data.items ?? r.data.rows ?? []) as {
    symbol?: string;
    name?: string;
    price?: number;
    changePercent?: number | null;
  }[];
  const q = query.toLowerCase();
  const focused =
    items.find((i) => {
      const hay = `${i.name ?? ""} ${i.symbol ?? ""}`.toLowerCase();
      if (/vàng|gold|xau/.test(q)) return /gold|vàng|xau/i.test(hay);
      if (/bạc|silver|xag/.test(q)) return /silver|bạc|xag/i.test(hay);
      if (/dầu|oil|wti|brent/.test(q)) return /oil|wti|brent|dầu/i.test(hay);
      return true;
    }) ?? items[0];

  const lines = items.slice(0, 10).map((i) => `- **${i.name ?? i.symbol}**: ${fmtNum(i.price, 2)} (${fmtPct(i.changePercent ?? null)})`);
  const narrative = [
    "## Hàng hóa",
    focused
      ? `Tiêu điểm: **${focused.name ?? focused.symbol}** — ${fmtNum(focused.price, 2)} (${fmtPct(focused.changePercent ?? null)})`
      : null,
    lines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    narrative,
    contract: { items: items.slice(0, 12), focus: focused },
    sectionsUsed: ["commodities"],
    symbols: focused?.symbol ? [focused.symbol] : [],
    freshnesses: r.meta?.freshness ? [r.meta.freshness] : [],
  };
}

export async function buildRatesMacroContext(kind: "rates" | "macro" | "both"): Promise<AgentBuilt> {
  const jobs: Promise<Awaited<ReturnType<typeof getEconomicData>> | null>[] = [];
  if (kind === "rates" || kind === "both") jobs.push(getEconomicData("currency-interest-rate").catch(() => null));
  else jobs.push(Promise.resolve(null));
  if (kind === "macro" || kind === "both") jobs.push(getEconomicData("macro-economic").catch(() => null));
  else jobs.push(Promise.resolve(null));

  const [rates, macro] = await Promise.all(jobs);
  const sections: string[] = [];
  const sectionsUsed: string[] = [];
  const freshnesses: FreshnessStatus[] = [];
  const contract: Record<string, unknown> = {};

  const pack = (
    title: string,
    key: string,
    pack: Awaited<ReturnType<typeof getEconomicData>> | null,
  ) => {
    if (!pack?.data) return;
    const rows =
      (pack.data as { indicators?: { name: string; period: string; current: { value: number | null } }[] })
        .indicators ?? (Array.isArray(pack.data) ? pack.data : []);
    const list = (Array.isArray(rows) ? rows : []).filter(
      (r: { current?: { value?: number | null } }) => r?.current?.value != null,
    ) as { name: string; period: string; current: { value: number | null } }[];
    if (!list.length) return;
    const lines = list.slice(0, 12).map((r) => `- **${r.name}**: ${fmtNum(r.current.value, 2)} (${r.period || "—"})`);
    sections.push(`## ${title}\n${lines.join("\n")}`);
    sectionsUsed.push(key);
    if (pack.meta?.freshness) freshnesses.push(pack.meta.freshness);
    contract[key] = list.slice(0, 12).map((r) => ({ name: r.name, value: r.current.value, period: r.period }));
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
      fetchVndirectFinancials(symbol, { limitPeriods: 4 }).catch(() => null),
    ]);

    const closes = (bars ?? []).map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);
    const indexCloses = (idxBars ?? []).map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);

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
      rev = typeof i0.netRevenue === "number" ? i0.netRevenue : typeof i0.revenue === "number" ? i0.revenue : null;
    }

    const quote = await getVnQuotes([symbol]).catch(() => null);
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
    if (perf.dividendYield != null) bits.push(`Tỷ suất cổ tức: **${(perf.dividendYield * 100).toFixed(2)}%**`);
    if (perf.payoutRatio != null) bits.push(`Payout ước tính: **${(perf.payoutRatio * 100).toFixed(0)}%**`);
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
  const r = await getCryptoDetail(symbol).catch(() => null);
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
  const ticker = r.detail.ticker;
  const tech = r.detail.technical;
  const funding = r.detail.funding;
  const narrative = [
    `## ${sym}`,
    `Giá **${fmtNum(ticker.price, 4)} USDT** · 24h ${fmtPct(ticker.changePercent)}`,
    tech
      ? `Kỹ thuật: xu hướng ${tech.trend?.label ?? "?"} · RSI14 ${tech.rsi14 != null ? tech.rsi14.toFixed(1) : "?"}`
      : "Chưa đủ chuỗi chỉ báo.",
    funding ? `Futures funding: ${(funding.fundingRate * 100).toFixed(4)}%` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    narrative,
    contract: { asset: { symbol: sym }, market_data: ticker, technical: tech, funding },
    sectionsUsed: ["crypto"],
    symbols: [symbol],
    freshnesses: [r.meta.freshness],
  };
}

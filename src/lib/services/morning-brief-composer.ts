import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { BreadthData, FlowData } from "./market-intel";
import type { ContributionRow } from "../engines/market-condition";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export interface MorningIntelSlice {
  breadth: BreadthData | null;
  flow: FlowData | null;
  liquidity: {
    valueTraded: number | null;
    baseline: number | null;
    available: boolean;
    note: string;
  } | null;
  contributors: {
    positive: ContributionRow[];
    negative: ContributionRow[];
    hasWeights: boolean;
    note: string;
  } | null;
  conditionScore: number | null;
  conditionRating: string | null;
}

interface MorningCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  /** sources LIVE count for dataConfidence */
  sourcesLive?: number;
  sourcesTotal?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: digits });
const bigVnd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} tỷ`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} triệu`;
  return num(v);
};
const bigUsd = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} tỷ`;
  return `$${(v / 1e6).toFixed(0)} triệu`;
};

const BANNED_PHRASES = [
  /có thể tăng hoặc giảm/i,
  /nên thận trọng(?!.*(khi|nếu|ngưỡng))/i,
  /cần quan sát thêm(?!.*(chỉ số|ngưỡng|vùng|độ rộng|thanh khoản))/i,
  /khá (tích cực|tiêu cực|mạnh|yếu)/i,
  /tương đối (mạnh|yếu|ổn định)/i,
  /tỷ trọng hợp lý/i,
];

function sanitizeParas(paras: string[]): string[] {
  return paras
    .map((p) => {
      let out = p;
      for (const re of BANNED_PHRASES) out = out.replace(re, "[đã lọc cụm mơ hồ]");
      out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
      return out;
    })
    .filter((p) => p.trim().length > 0);
}

const NEWS_NOISE =
  /HIV|lừa đảo|án tù|tử hình|ngập lụt|thoát nước|tai nạn|ngộ độc|bóng đá|cầu thủ|showbiz|ca sĩ|diễn viên|mỏ vàng.*biển|lặn xuống biển|giết người|hiếp dâm|cướp/i;

const NEWS_SIGNAL =
  /Fed|NHNN|SBV|lãi suất|tỷ giá|USD\/VND|BCTC|doanh thu|lợi nhuận|khối ngoại|ETF|niêm yết|HOSE|HNX|phát hành|trái phiếu|lạm phát|GDP|PMI|xuất khẩu|nhập khẩu|dầu|thép|ngân hàng|bất động sản|chứng khoán|margin|room ngoại|cổ tức|đại hội|GDKHQ|IPO|OMO|tín phiếu|KRX/i;

type NewsItem = NonNullable<MarketSnapshot["news"]>[number];

function newsRelevance(n: NewsItem): number {
  let s = 0;
  const title = n.title ?? "";
  if (NEWS_NOISE.test(title)) return -10;
  if (n.category === "macro" || n.category === "market") s += 3;
  if (n.category === "corporate") s += 2;
  if (n.relatedSymbols?.length) s += 4;
  if (n.relatedSector) s += 2;
  if (NEWS_SIGNAL.test(title)) s += 5;
  if (n.category === "crypto" && !n.relatedSymbols?.length) s -= 1;
  return s;
}

function pickActionableNews(items: NewsItem[], limit = 8): NewsItem[] {
  return [...items]
    .map((n) => ({ n, score: newsRelevance(n) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

function impactTagFromTitle(title: string): "Tích cực" | "Tiêu cực" | "Trung tính" {
  if (/tăng|phê duyệt|kỷ lục|vượt|mở rộng|nâng hạng|cấp phép|hợp đồng|thắng thầu/i.test(title))
    return "Tích cực";
  if (/giảm|phạt|kiện|vỡ nợ|thua lỗ|cắt giảm|rút vốn|đình chỉ|khủng hoảng/i.test(title))
    return "Tiêu cực";
  return "Trung tính";
}

const COMM_IMPACT: Record<string, { tickers: string; note: string }> = {
  XAUUSD: { tickers: "tâm lý phòng thủ toàn cầu", note: "kim loại quý" },
  SJC: { tickers: "tâm lý tích trữ trong nước", note: "vàng SJC" },
  CL: { tickers: "GAS, PLX, PVD, PVS, BSR, POW", note: "năng lượng" },
  BRENT: { tickers: "GAS, PLX, PVD, PVS, BSR", note: "năng lượng" },
  WTI: { tickers: "GAS, PLX, PVD, PVS, BSR", note: "năng lượng" },
  IRON: { tickers: "HPG, HSG, NKG", note: "thép / quặng" },
  HRC: { tickers: "HPG, HSG, NKG, VGS", note: "thép" },
  COPPER: { tickers: "HPG, PC1", note: "kim loại" },
  UREA: { tickers: "DPM, DCM, LAS, BFC", note: "phân bón" },
};

const COMM_NAME_MAP: { re: RegExp; tickers: string; note: string }[] = [
  { re: /dầu|xăng|brent|wti|crude|petroleum/i, tickers: "GAS, PLX, PVD, PVS, BSR", note: "năng lượng" },
  { re: /thép|quặng|hrc|iron|steel/i, tickers: "HPG, HSG, NKG", note: "thép" },
  { re: /vàng|gold|sjc/i, tickers: "tâm lý phòng thủ", note: "kim loại quý" },
  { re: /đồng|copper/i, tickers: "HPG, PC1", note: "kim loại" },
  { re: /ure|phân bón|urea|dap/i, tickers: "DPM, DCM, LAS, BFC", note: "phân bón" },
  { re: /cao su|rubber/i, tickers: "GVR, PHR, DPR, TRC", note: "cao su" },
  { re: /cà phê|cafe|coffee/i, tickers: "DBC · xuất khẩu nông sản", note: "nông sản" },
  { re: /gạo|lúa|rice/i, tickers: "LTG, TAR, AGM", note: "nông sản" },
  { re: /heo|lợn|pork/i, tickers: "DBC, BAF", note: "chăn nuôi" },
  { re: /đường|sugar/i, tickers: "SBT, QNS, LSS", note: "đường" },
];

function resolveCommImpact(symbol: string, name: string): { tickers: string; note: string } | null {
  const bySym = COMM_IMPACT[symbol?.toUpperCase?.() ?? ""] ?? COMM_IMPACT[symbol];
  if (bySym) return bySym;
  const blob = `${symbol} ${name}`;
  for (const m of COMM_NAME_MAP) {
    if (m.re.test(blob)) return { tickers: m.tickers, note: m.note };
  }
  return null;
}

function computeMomentum(ctx: MorningCtx): number {
  const p = ctx.snap.pulse.score; // -1..1
  const br = ctx.intel.breadth;
  let breadthPart = 50;
  if (br?.available && (br.advancers + br.decliners) > 0) {
    const total = br.advancers + br.decliners + (br.unchanged ?? 0);
    breadthPart = clamp((br.advancers / Math.max(1, total)) * 100, 0, 100);
  }
  const flowPart =
    ctx.intel.flow?.foreignNet != null
      ? clamp(50 + Math.sign(ctx.intel.flow.foreignNet) * 20, 0, 100)
      : 50;
  const intlPart = clamp((p + 1) * 50, 0, 100);
  // weights ~ framework: breadth 25 + flow 25 + sector/intl proxy 50
  return Math.round(breadthPart * 0.25 + flowPart * 0.25 + intlPart * 0.5);
}

function regimeLabel(score: number, momentum: number): string {
  if (momentum >= 70 && score > 0.2) return "Uptrend / risk-on";
  if (momentum >= 55 && score > 0.05) return "Sideway tích lũy nghiêng tăng";
  if (momentum <= 30 && score < -0.2) return "Downtrend / risk-off";
  if (momentum <= 45 && score < -0.05) return "Sideway phân phối nghiêng giảm";
  if (score > 0.35) return "Hồi phục kỹ thuật";
  return "Sideway trung tính";
}

export function composeMorningFramework(
  ctx: MorningCtx,
  assumptions: string[],
): { sections: Section[]; assumptions: string[] } {
  const { snap, intel } = ctx;
  const sections: Section[] = [];
  const p = snap.pulse;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0] ?? null;
  const vn30 = snap.indices?.find((i) => i.code === "VN30") ?? null;
  const hnx = snap.indices?.find((i) => /HNX/.test(i.code)) ?? null;
  const tone: "up" | "down" | "neutral" =
    p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral";
  const momentum = computeMomentum(ctx);
  const regime = regimeLabel(p.score, momentum);

  // ——— Block 0: Header ———
  const live = ctx.sourcesLive ?? Object.values(snap as object).filter(Boolean).length;
  const total = ctx.sourcesTotal ?? 5;
  const confidence = Math.round((live / Math.max(1, total)) * 100);
  const focusLine =
    p.headline?.slice(0, 120) ||
    (idx
      ? `VN-Index ${num(idx.value)} (${pct(idx.changePercent)}) — theo dõi độ rộng + KL đầu phiên`
      : "Thiếu VN-Index LIVE — ưu tiên quan sát quốc tế & chờ xác nhận mở cửa");
  sections.push({
    heading: "0. Header",
    tone,
    paragraphs: sanitizeParas([
      `Ngày: ${ctx.dateVi} · Trạng thái phiên: ${snap.vnSession?.labelVi ?? ctx.sessionState}`,
      `Tâm điểm: ${focusLine}`,
      `Độ tin cậy dữ liệu: ~${confidence}% nguồn khả dụng · Pulse ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} · Momentum ${momentum}/100 · ${regime}`,
    ]),
  });

  // ——— Block 1: Điểm tin 60 giây (max 5, mỗi dòng ≥1 số) ———
  const bullets: string[] = [];
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    bullets.push(
      `Quốc tế: BTC ${pct(s.btcChangePercent)} · ETH ${pct(s.ethChangePercent)} · độ rộng ${s.advancers}/${s.marketCount} mã xanh.`,
    );
  } else {
    bullets.push("Quốc tế: chưa có snapshot crypto 24h (0 nguồn) — không suy diễn risk-appetite qua đêm.");
  }
  if (snap.forex?.usdStrengthNote) {
    const note = snap.forex.usdStrengthNote.slice(0, 100);
    bullets.push(`Ngoại hối: ${note}${/\d/.test(note) ? "" : " (theo dõi DXY/USDVND)."}`);
  } else {
    bullets.push("Ngoại hối: chưa có note USD strength LIVE — theo dõi DXY/USDVND khi nguồn mở.");
  }
  if (idx) {
    bullets.push(
      `VN: ${idx.code} ${num(idx.value)} điểm (${pct(idx.changePercent)}, Δ ${idx.change >= 0 ? "+" : ""}${num(idx.change)}) — recap phiên gần nhất.`,
    );
  } else {
    bullets.push("VN: VN-Index UNAVAILABLE (0 điểm số) — block trong nước chờ nguồn LIVE.");
  }
  const gold = (snap.commodities ?? []).find((c) => c.symbol === "XAUUSD" || c.symbol === "SJC");
  if (gold && gold.changePercent != null) {
    bullets.push(
      `Hàng hóa: ${gold.name ?? gold.symbol} ${pct(gold.changePercent)} — ${resolveCommImpact(gold.symbol, gold.name ?? "")?.note ?? "lan tỏa"}.`,
    );
  } else if ((snap.commodities ?? []).length) {
    const top = [...snap.commodities!]
      .filter((c) => c.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))[0];
    if (top)
      bullets.push(`Hàng hóa biến động mạnh: ${top.name ?? top.symbol} ${pct(top.changePercent)}.`);
  } else {
    bullets.push("Hàng hóa: 0 mã LIVE — không điền số giả.");
  }
  const actionLevel = idx ? num(idx.value) : "VN-Index";
  bullets.push(
    `Việc cần làm hôm nay: xác nhận độ rộng + thanh khoản 30 phút đầu quanh ${actionLevel}; đứng ngoài nếu thiếu 2/2 xác nhận.`,
  );
  sections.push({
    heading: "1. Điểm tin 60 giây",
    tone,
    paragraphs: sanitizeParas(bullets.slice(0, 5).map((b) => `• ${b}`)),
  });

  // ——— Block 2: Tin tức vĩ mô (có impactTag) ———
  const newsItems = snap.news ?? [];
  const actionable = pickActionableNews(newsItems, 8);
  const macroNews = actionable.filter((n) => n.category === "macro" || n.category === "market").slice(0, 4);
  const corpNews = actionable.filter((n) => n.category === "corporate").slice(0, 3);
  const macroParas: string[] = [];
  if (macroNews.length) {
    macroParas.push("Quốc tế / chính sách (kênh truyền dẫn ATO):");
    for (const n of macroNews) {
      const tag = impactTagFromTitle(n.title ?? "");
      const tags = [
        `impact: ${tag}`,
        n.relatedSector ? `ngành: ${n.relatedSector}` : null,
        n.relatedSymbols?.length ? `mã: ${n.relatedSymbols.slice(0, 3).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      macroParas.push(`• ${n.title} — ${n.source} · ${tags}.`);
    }
  } else {
    macroParas.push(
      "Chưa có tin vĩ mô/market đạt ngưỡng actionable (Fed · SBV · FX · BCTC · dòng vốn) — không bịa headline.",
    );
  }
  if (corpNews.length) {
    macroParas.push("Trong nước / doanh nghiệp:");
    for (const n of corpNews) {
      const tag = impactTagFromTitle(n.title ?? "");
      const sym = n.relatedSymbols?.length ? ` · mã: ${n.relatedSymbols.slice(0, 3).join(", ")}` : "";
      macroParas.push(`• ${n.title} — ${n.source} · impact: ${tag}${sym}.`);
    }
  }
  const noiseDropped = newsItems.length - actionable.length;
  if (noiseDropped > 0) {
    assumptions.push(`Đã lọc ${noiseDropped} tin nhiễu — chỉ giữ tin có kênh truyền dẫn ATO.`);
  }
  sections.push({
    heading: "2. Tin tức vĩ mô & doanh nghiệp",
    tone: "neutral",
    paragraphs: sanitizeParas(macroParas),
  });

  // ——— Block 3: Thị trường tài chính ———
  const mktParas: string[] = [];
  mktParas.push("3.1 Quốc tế qua đêm (proxy risk-appetite)");
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    mktParas.push(
      `Crypto 24h: BTC ${pct(s.btcChangePercent)} · ETH ${pct(s.ethChangePercent)} · TB ${pct(s.avgChangePercent)} · KL ${bigUsd(s.totalQuoteVolume)} · ${s.advancers}↑/${s.decliners}↓.`,
    );
    mktParas.push(
      "Truyền dẫn VN: risk-on/off qua đêm thường lan sang nhóm beta cao (chứng khoán, BĐS) với độ trễ — bối cảnh, không phải tín hiệu máy móc.",
    );
  } else {
    mktParas.push("Chưa có snapshot crypto — bỏ qua proxy thay vì nội suy.");
  }
  if (snap.forex?.usdStrengthNote) mktParas.push(snap.forex.usdStrengthNote);

  mktParas.push("3.2 VN-Index — recap phiên gần nhất");
  if (idx) {
    mktParas.push(
      `Đóng cửa: ${num(idx.value)} điểm · ${pct(idx.changePercent)} · Δ ${idx.change >= 0 ? "+" : ""}${num(idx.change)} điểm.`,
    );
    if (vn30) mktParas.push(`VN30: ${num(vn30.value)} (${pct(vn30.changePercent)}).`);
    if (hnx) mktParas.push(`${hnx.code}: ${num(hnx.value)} (${pct(hnx.changePercent)}).`);
    mktParas.push(`Phiên theo lịch: ${snap.vnSession?.labelVi ?? "—"}. ${snap.vnSessionHint ?? ""}`);
  } else {
    mktParas.push(
      "VN-Index UNAVAILABLE — không suy diễn. Khi LIVE đủ: điểm, %, GTGD vs TB20, trần/sàn, top kéo/đè, range.",
    );
  }

  // 3.3 Breadth + liquidity from intel
  const br = intel.breadth;
  if (br?.available) {
    const ratio = br.adRatio == null ? "—" : br.adRatio >= 10 ? ">10" : br.adRatio.toFixed(2);
    const pctBr = br.advancePct != null ? `${br.advancePct.toFixed(1)}%` : "—";
    const net =
      br.netAdvances == null ? "—" : `${br.netAdvances >= 0 ? "+" : ""}${br.netAdvances}`;
    mktParas.push(
      `3.3 Độ rộng: ${br.advancers}↑ / ${br.decliners}↓ / ${br.unchanged ?? 0}— · A/D ${ratio} · mã tăng ${pctBr} · net ${net}${br.regimeVi ? ` · ${br.regimeVi}` : ""}.`,
    );
  } else {
    mktParas.push("3.3 Độ rộng: chưa có session-stats — không suy diễn A/D; ưu tiên 30 phút đầu phiên.");
  }

  if (intel.liquidity?.available && intel.liquidity.valueTraded != null) {
    mktParas.push(
      `Thanh khoản: GTGD ${bigVnd(intel.liquidity.valueTraded)} VND · ${intel.liquidity.note}`,
    );
  } else if (intel.liquidity?.note) {
    mktParas.push(`Thanh khoản: ${intel.liquidity.note}`);
  }

  // 3.4 Flow
  if (intel.flow?.available) {
    const f = intel.flow;
    mktParas.push(
      `3.4 Dòng tiền: khối ngoại ròng ${f.foreignNet != null ? bigVnd(f.foreignNet) : "—"} · tự doanh ${f.propNet != null ? bigVnd(f.propNet) : "—"} · ETF ${f.etfNet != null ? bigVnd(f.etfNet) : "—"}.`,
    );
    if (f.note) mktParas.push(f.note.slice(0, 220));
  } else {
    mktParas.push("3.4 Dòng tiền: foreign/prop/ETF chưa đủ phiên — không ước lượng.");
  }

  // Contributors
  if (intel.contributors) {
    const pos = intel.contributors.positive.slice(0, 5);
    const neg = intel.contributors.negative.slice(0, 5);
    if (pos.length) {
      mktParas.push(
        `Top kéo (proxy %): ${pos.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
      );
    }
    if (neg.length) {
      mktParas.push(
        `Top đè (proxy %): ${neg.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
      );
    }
    if (intel.contributors.note) mktParas.push(intel.contributors.note);
  }

  mktParas.push(
    `Pulse: ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} (−1..+1) · ${p.headline}`,
  );
  sections.push({
    heading: "3. Thị trường tài chính",
    tone,
    paragraphs: sanitizeParas(mktParas),
  });

  // ——— Block 4: Hàng hóa + ánh xạ mã VN ———
  const commParas: string[] = [];
  const comms = snap.commodities ?? [];
  if (comms.length) {
    const ranked = [...comms]
      .map((c) => {
        const label = (c.name || c.commodity || c.symbol || "").trim();
        const impact = resolveCommImpact(c.symbol, label);
        const hasDelta = c.changePercent != null;
        const score = (hasDelta ? Math.abs(c.changePercent!) : 0) + (impact ? 5 : 0);
        return { c, label, impact, hasDelta, score };
      })
      .filter((x) => x.label && !/^han-[a-z0-9-]+$/i.test(x.label))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    for (const x of ranked) {
      const delta = x.hasDelta ? pct(x.c.changePercent) : "Δ n/a";
      const impactStr = x.impact ? ` → ${x.impact.tickers} (${x.impact.note})` : "";
      commParas.push(
        `• ${x.label}: ${x.c.price != null ? num(x.c.price, 2) : "—"} (${delta})${impactStr}.`,
      );
    }
    if (comms.every((c) => c.changePercent == null)) {
      assumptions.push("Hàng hóa: Δ% chưa có (DELAYED) — chỉ hiển thị giá đã verify.");
    }
  } else {
    commParas.push("Chưa lấy được bảng hàng hóa — ẩn block số liệu thay vì ước lượng.");
  }
  sections.push({
    heading: "4. Thị trường hàng hóa & ánh xạ mã VN",
    tone: "neutral",
    paragraphs: sanitizeParas(commParas),
  });

  // ——— Block 5: Tỷ giá & tiền số ———
  const fxParas: string[] = [];
  if (snap.forex?.rows?.length) {
    for (const r of snap.forex.rows.slice(0, 6)) {
      fxParas.push(
        `• ${r.pair ?? r.symbol}: ${r.price != null ? num(r.price, 2) : "—"}${r.changePercent != null ? ` (${pct(r.changePercent)})` : ""}.`,
      );
    }
    if (snap.forex.usdStrengthNote) fxParas.push(snap.forex.usdStrengthNote);
  } else {
    fxParas.push("Tỷ giá: chưa có hàng LIVE — không dùng số cũ không nhãn STALE.");
  }
  const sjc = (snap.commodities ?? []).find((c) => /SJC/i.test(c.symbol) || /SJC/i.test(c.name ?? ""));
  if (sjc) {
    fxParas.push(
      `Vàng SJC/nhẫn: ${sjc.price != null ? num(sjc.price) : "—"} (${pct(sjc.changePercent)}) — theo dõi chênh lệch thế giới khi đủ nguồn.`,
    );
  }
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    fxParas.push(
      `Crypto (khẩu vị rủi ro): BTC ${pct(s.btcChangePercent)} · ETH ${pct(s.ethChangePercent)} · Fear&Greed/funding/ETF flow chưa nối đầy đủ trong pipeline hiện tại.`,
    );
  }
  sections.push({
    heading: "5. Tỷ giá & tiền số",
    tone: "neutral",
    paragraphs: sanitizeParas(fxParas),
  });

  // ——— Block 6: Lịch sự kiện (honest UNAVAILABLE) ———
  sections.push({
    heading: "6. Lịch sự kiện hôm nay",
    tone: "neutral",
    paragraphs: sanitizeParas([
      "Economic calendar (ForexFactory) và lịch GDKHQ/ĐHCĐ/BCTC VN chưa nối connector đầy đủ — block đánh dấu UNAVAILABLE.",
      "Hành động thủ công trước ATO: kiểm tra lịch công bố BCTC · đáo hạn VN30F · cơ cấu ETF (VNM, FTSE, Fubon, DCVFM).",
      "Khi connector LIVE: giờ VN · sự kiện · forecast · previous · ★ nếu lịch sử biến động chỉ số >1%.",
    ]),
  });

  // ——— Block 7: Nhận định nhanh (regime + momentum + levels + scenarios actions + risk) ———
  const s1 = idx ? Math.round(idx.value * 0.99) : null;
  const s2 = idx ? Math.round(idx.value * 0.98) : null;
  const r1 = idx ? Math.round(idx.value * 1.01) : null;
  const r2 = idx ? Math.round(idx.value * 1.02) : null;
  const pip = clamp(p.score, -1, 1);
  const baseP = Math.round(clamp(58 - Math.abs(pip) * 22, 30, 60));
  const bullP = Math.round(clamp(21 + (pip > 0 ? pip * 20 : 0), 10, 45));
  const bearP = Math.max(1, 100 - baseP - bullP);

  const quickParas = [
    `TRẠNG THÁI: ${regime}`,
    `ĐỘNG LƯỢNG: ${momentum}/100 (breadth 25% + dòng tiền 25% + quốc tế/pulse 50%; pulse ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)}).`,
    s1 != null
      ? `VÙNG KỸ THUẬT: Hỗ trợ S1 ≈ ${s1} (≈1% dưới đóng) · S2 ≈ ${s2} · Kháng cự R1 ≈ ${r1} · R2 ≈ ${r2}. Cơ sở: % quanh giá đóng — thay bằng MA20/50/POC khi chuỗi nến đủ.`
      : "VÙNG KỸ THUẬT: Chưa định vị — thiếu VN-Index LIVE, không phác thảo vùng giá giả.",
    `KỊCH BẢN CƠ SỞ (${baseP - 5}–${baseP + 5}%): duy trì động lượng hiện tại. Hành động: chờ xác nhận độ rộng + KL 30 phút đầu; giao dịch chọn lọc, không đuổi.`,
    `KỊCH BẢN TÍCH CỰC (${bullP - 4}–${bullP + 4}%): risk-on đồng thuận. Kích hoạt khi ${idx ? `VN-Index vượt ${r1} kèm độ rộng mở` : "chỉ số tăng + thanh khoản vượt TB"}. Hành động: nâng tỷ trọng nhóm dẫn dắt có KL thực.`,
    `KỊCH BẢN TIÊU CỰC (${bearP - 3}–${bearP + 3}%): bán lan tỏa / USD mạnh / tin xấu DN lớn. Kích hoạt khi ${idx ? `mất S1 ${s1} kèm bán chiếm ưu thế` : "độ rộng thu hẹp rõ"}. Hành động: giảm vị thế, đứng ngoài đến khi có xác nhận đóng cửa.`,
    `QUẢN TRỊ RỦI RO: tỷ trọng đề xuất — phòng thủ khi momentum <40, linh hoạt 40–60, chỉ nâng khi ≥65 kèm độ rộng mở. Cắt nếu mất S1 kèm bán lan tỏa. Không mở lệnh khi thiếu 2/2 xác nhận (độ rộng + KL).`,
  ];
  sections.push({
    heading: "7. Nhận định nhanh",
    tone,
    paragraphs: sanitizeParas(quickParas),
  });

  // ——— Block 8: Phân tích chuyên sâu (xoay theo thứ) ———
  const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).getDay();
  const deepTopics: Record<number, string> = {
    1: "Sector rotation & dòng tiền ngành (khung qualitative — RRG khi sector engine LIVE)",
    2: "Bóc tách cổ phiếu: ưu tiên mã được tin đề cập + kiểm tra thanh khoản đầu phiên",
    3: "Chuỗi giá trị hàng hóa → mã hưởng lợi (đối chiếu block 4)",
    4: "Dòng vốn: khối ngoại / ETF / tự doanh — đối chiếu số liệu block 3.4",
    5: "Vĩ mô chuyên đề + preview tuần",
    0: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
    6: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
  };
  const deepTopic = deepTopics[dow] ?? deepTopics[1];
  const deepBody = [
    `Chủ đề hôm nay: ${deepTopic}.`,
    "Không lặp số liệu khối 1–3. Tập trung điều kiện kích hoạt: độ rộng mở + KL vượt TB ngắn hạn tại vùng kỹ thuật đã nêu.",
    actionable[0]
      ? `Tin dẫn dắt cần đối chiếu đầu phiên: «${actionable[0].title.slice(0, 120)}» (${actionable[0].source}).`
      : "Chưa có tin actionable dẫn dắt — ưu tiên tín hiệu kỹ thuật và thanh khoản hơn narrative.",
    intel.conditionRating
      ? `Market condition engine: ${intel.conditionRating}${intel.conditionScore != null ? ` (${Math.round(intel.conditionScore)}/100)` : ""}.`
      : "Market condition: chưa đủ component để chấm điểm đầy đủ.",
  ];
  sections.push({
    heading: "8. Phân tích chuyên sâu",
    tone: "neutral",
    paragraphs: sanitizeParas(deepBody),
  });

  // ——— Block 9: Danh mục theo dõi ———
  const tagged = [
    ...new Set(
      actionable
        .flatMap((n) => n.relatedSymbols ?? [])
        .filter((s) => s.length >= 3 && s.length <= 4),
    ),
  ].slice(0, 8);
  const watchParas: string[] = [];
  if (tagged.length) {
    watchParas.push("Mã | Nguồn | Trạng thái | Điều kiện kích hoạt");
    for (const sym of tagged) {
      watchParas.push(
        `• ${sym} | tin actionable 24h | Theo dõi | KL 15–30p đầu > TB ngắn hạn + giá giữ trên S1 phiên / MA ngắn`,
      );
    }
    watchParas.push(
      "Cột Kết quả (chấm điểm lịch sử nhận định) sẽ bổ sung ở phase tracker — tạo uy tín, không lặp rổ cố định mỗi ngày.",
    );
  } else {
    watchParas.push("Chưa có mã gắn từ tin actionable trong cửa sổ gần.");
    watchParas.push("Duy trì watchlist cá nhân; không lặp rổ cố định mỗi ngày.");
  }
  if (intel.contributors?.positive?.length) {
    const lead = intel.contributors.positive.slice(0, 3).map((c) => c.symbol);
    watchParas.push(`Gợi ý quan sát thêm (top kéo proxy): ${lead.join(", ")}.`);
  }
  sections.push({
    heading: "9. Danh mục theo dõi",
    tone: "neutral",
    paragraphs: sanitizeParas(watchParas),
  });

  // ——— Block 10: Disclaimer ———
  sections.push({
    heading: "10. Disclaimer",
    tone: "neutral",
    paragraphs: [
      "Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư. Mọi quyết định mua/bán thuộc về nhà đầu tư và khẩu vị rủi ro cá nhân.",
    ],
  });

  if (confidence < 60) {
    assumptions.push(
      `dataConfidence ~${confidence}% (<60) — một số block VN/calendar đánh dấu UNAVAILABLE; ưu tiên bản rút gọn nếu phát hành ngoài cửa sổ đủ nguồn.`,
    );
  }

  return { sections, assumptions };
}

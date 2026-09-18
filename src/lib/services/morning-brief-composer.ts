import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

interface MorningCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  breadth?: {
    available: boolean;
    advancers: number;
    decliners: number;
    unchanged: number;
    adRatio?: number | null;
    advancePct?: number | null;
    netAdvances?: number | null;
    regimeVi?: string | null;
  } | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
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
  /Fed|NHNN|lãi suất|tỷ giá|USD\/VND|BCTC|doanh thu|lợi nhuận|khối ngoại|ETF|niêm yết|HOSE|HNX|phát hành|trái phiếu|lạm phát|GDP|PMI|xuất khẩu|nhập khẩu|dầu|thép|ngân hàng|bất động sản|chứng khoán|margin|room ngoại|cổ tức|đại hội|GDKHQ|IPO/i;

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

function pickActionableNews(items: NewsItem[], limit = 6): NewsItem[] {
  return [...items]
    .map((n) => ({ n, score: newsRelevance(n) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

const COMM_IMPACT: Record<string, { tickers: string; note: string }> = {
  XAUUSD: { tickers: "tâm lý phòng thủ toàn cầu", note: "chỉ báo risk-off" },
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
  { re: /cà phê|cafe|coffee/i, tickers: "DBC (chuỗi nông sản) · xuất khẩu", note: "nông sản" },
  { re: /gạo|lúa|rice/i, tickers: "LTG, TAR, AGM", note: "nông sản" },
  { re: /heo|lợn|pork/i, tickers: "DBC, BAF", note: "chăn nuôi" },
  { re: /tiêu|pepper/i, tickers: "xuất khẩu nông sản", note: "nông sản" },
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

export function composeMorningFramework(
  ctx: MorningCtx,
  assumptions: string[],
): { sections: Section[]; assumptions: string[] } {
  const { snap } = ctx;
  const sections: Section[] = [];
  const p = snap.pulse;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0] ?? null;
  const vn30 = snap.indices?.find((i) => i.code === "VN30") ?? null;
  const hnx = snap.indices?.find((i) => /HNX/.test(i.code)) ?? null;
  const tone: "up" | "down" | "neutral" =
    p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral";

  const bullets: string[] = [];
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    bullets.push(
      `Quốc tế: BTC ${s.btcChangePercent != null ? pct(s.btcChangePercent) : "—"} · ETH ${s.ethChangePercent != null ? pct(s.ethChangePercent) : "—"} · độ rộng ${s.advancers}/${s.marketCount} mã xanh.`,
    );
  } else {
    bullets.push("Quốc tế: chưa lấy được snapshot crypto 24h — không suy diễn risk-appetite qua đêm.");
  }
  if (snap.forex?.usdStrengthNote) {
    bullets.push(`Ngoại hối: ${snap.forex.usdStrengthNote.slice(0, 120)}`);
  } else {
    bullets.push("Ngoại hối: chưa có note USD strength; theo dõi DXY/USDVND khi có nguồn LIVE.");
  }
  if (idx) {
    bullets.push(
      `VN: ${idx.code} ${idx.value.toLocaleString("vi-VN")} điểm (${pct(idx.changePercent)}) — recap phiên gần nhất.`,
    );
  } else {
    bullets.push("VN: chưa có VN-Index LIVE — phần chỉ số trong nước sẽ đầy đủ khi nguồn chỉ số khả dụng.");
  }
  const gold = (snap.commodities ?? []).find((c) => c.symbol === "XAUUSD" || c.symbol === "SJC");
  if (gold && gold.changePercent != null) {
    bullets.push(
      `Hàng hóa: ${gold.name ?? gold.commodity ?? gold.symbol} ${pct(gold.changePercent)} — ${resolveCommImpact(gold.symbol, gold.name ?? "")?.note ?? "theo dõi lan tỏa"}.`,
    );
  } else if ((snap.commodities ?? []).length) {
    const top = snap.commodities!
      .filter((c) => c.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))[0];
    if (top)
      bullets.push(
        `Hàng hóa biến động mạnh: ${top.name ?? top.commodity ?? top.symbol} ${pct(top.changePercent)}.`,
      );
  } else {
    bullets.push("Chưa đủ nguồn phụ để bổ sung điểm tin — ưu tiên dữ liệu LIVE, không điền số giả.");
  }
  bullets.push(
    `Việc cần làm hôm nay: xác nhận độ rộng + thanh khoản 30 phút đầu phiên quanh ${idx ? idx.value.toLocaleString("vi-VN") : "VN-Index"}; đứng ngoài nếu thiếu 2 xác nhận.`,
  );
  sections.push({
    heading: "1. Điểm tin 60 giây",
    tone,
    paragraphs: sanitizeParas(bullets.slice(0, 5).map((b) => `• ${b}`)),
  });

  const newsItems = snap.news ?? [];
  const actionable = pickActionableNews(newsItems, 7);
  const macroNews = actionable.filter((n) => n.category === "macro" || n.category === "market").slice(0, 4);
  const corpNews = actionable.filter((n) => n.category === "corporate").slice(0, 3);
  const otherActionable = actionable
    .filter((n) => n.category !== "macro" && n.category !== "market" && n.category !== "corporate")
    .slice(0, 2);

  const macroParas: string[] = [];
  if (macroNews.length) {
    macroParas.push("Quốc tế / chính sách (ưu tiên kênh truyền dẫn sang VN):");
    for (const n of macroNews) {
      const tags = [
        n.relatedSector ? `ngành: ${n.relatedSector}` : null,
        n.relatedSymbols?.length ? `mã: ${n.relatedSymbols.slice(0, 3).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      macroParas.push(`• ${n.title} — ${n.source}${tags ? ` · ${tags}` : ""}.`);
    }
  } else {
    macroParas.push(
      "Chưa có tin vĩ mô/market đạt ngưỡng actionable (lãi suất · FX · BCTC · dòng vốn · ngành niêm yết) trong cửa sổ gần — không bịa headline.",
    );
  }
  if (corpNews.length) {
    macroParas.push("Trong nước / doanh nghiệp:");
    for (const n of corpNews) {
      const sym = n.relatedSymbols?.length ? ` · mã: ${n.relatedSymbols.slice(0, 3).join(", ")}` : "";
      macroParas.push(`• ${n.title} — ${n.source}${sym}.`);
    }
  }
  if (otherActionable.length && macroParas.length < 7) {
    for (const n of otherActionable) {
      macroParas.push(`• ${n.title} — ${n.source}.`);
    }
  }
  const noiseDropped = newsItems.length - actionable.length;
  if (noiseDropped > 0) {
    assumptions.push(
      `Đã lọc ${noiseDropped} tin nhiễu (đời sống/án hình sự/sức khỏe lẻ) — chỉ giữ tin có kênh truyền dẫn ATO.`,
    );
  }
  sections.push({
    heading: "2. Tin tức vĩ mô & doanh nghiệp",
    tone: "neutral",
    paragraphs: sanitizeParas(macroParas),
  });

  const mktParas: string[] = [];
  mktParas.push("3.1 Quốc tế qua đêm (proxy risk-appetite)");
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    mktParas.push(
      `Crypto 24h: BTC ${pct(s.btcChangePercent)} · ETH ${pct(s.ethChangePercent)} · TB thị trường ${pct(s.avgChangePercent)} · KL quy đổi ${bigUsd(s.totalQuoteVolume)} · độ rộng ${s.advancers}↑/${s.decliners}↓.`,
    );
    mktParas.push(
      "Truyền dẫn sang VN: risk-on/off qua đêm thường ảnh hưởng nhóm beta cao (chứng khoán, BĐS) với độ trễ — đây là bối cảnh, không phải tín hiệu mua/bán máy móc.",
    );
  } else {
    mktParas.push("Chưa có snapshot crypto — bỏ qua proxy risk-appetite thay vì nội suy.");
  }
  if (snap.forex) mktParas.push(snap.forex.usdStrengthNote);
  mktParas.push("3.2 VN-Index — recap phiên gần nhất");
  if (idx) {
    mktParas.push(
      `Đóng cửa: ${idx.value.toLocaleString("vi-VN")} điểm · ${pct(idx.changePercent)} · Δ ${idx.change >= 0 ? "+" : ""}${idx.change.toLocaleString("vi-VN")} điểm.`,
    );
    if (vn30) mktParas.push(`VN30: ${vn30.value.toLocaleString("vi-VN")} (${pct(vn30.changePercent)}).`);
    if (hnx) mktParas.push(`${hnx.code}: ${hnx.value.toLocaleString("vi-VN")} (${pct(hnx.changePercent)}).`);
    mktParas.push(`Phiên theo lịch: ${snap.vnSession.labelVi}. ${snap.vnSessionHint}`);
    mktParas.push(
      "Cần bổ sung GTGD vs TB 20 phiên, số trần/sàn, top đóng góp điểm khi nguồn session-stats LIVE — hiện chỉ báo cáo số đã verify.",
    );
  } else {
    mktParas.push(
      "VN-Index UNAVAILABLE — không suy diễn điểm số. Khi VNDirect/VNStock LIVE, block này đủ 10 trường (điểm, %, GTGD, breadth, top kéo/đè, range).",
    );
  }
  const br = ctx.breadth;
  if (br?.available) {
    const ratio =
      br.adRatio == null ? "—" : br.adRatio >= 10 ? ">10" : br.adRatio.toFixed(2);
    const pctBr = br.advancePct != null ? `${br.advancePct.toFixed(1)}%` : "—";
    const net =
      br.netAdvances == null
        ? "—"
        : `${br.netAdvances >= 0 ? "+" : ""}${br.netAdvances}`;
    mktParas.push(
      `3.3 Độ rộng VN: ${br.advancers}↑ / ${br.decliners}↓ / ${br.unchanged}— · A/D ${ratio} · mã tăng ${pctBr} · net ${net}${br.regimeVi ? ` · ${br.regimeVi}` : ""}.`,
    );
    mktParas.push(
      br.regimeVi?.includes("Mở") || br.regimeVi?.includes("tăng")
        ? "Độ rộng ủng hộ nhịp tăng — xác nhận thêm KL đầu phiên trước khi nâng tỷ trọng."
        : br.regimeVi?.includes("Thu") || br.regimeVi?.includes("giảm")
          ? "Độ rộng nghiêng bán — chỉ số xanh dễ là lực kéo ít mã; tránh đuổi khi breadth thu hẹp."
          : "Độ rộng trung tính — ưu tiên mã có KL thực hơn đánh chỉ số.",
    );
  } else {
    mktParas.push(
      "3.3 Độ rộng VN: chưa có session-stats tăng/giảm — không suy diễn A/D; ưu tiên quan sát 30 phút đầu phiên.",
    );
  }
  mktParas.push(
    `Pulse engine: score ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} (−1..+1) · ${p.headline}`,
  );
  sections.push({
    heading: "3. Thị trường tài chính",
    tone,
    paragraphs: sanitizeParas(mktParas),
  });

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
      .sort((a, b) => b.score - a.score);
    const shown = ranked.slice(0, 8);
    if (!shown.length) {
      for (const c of comms.slice(0, 8)) {
        const label = c.name || c.commodity || c.symbol;
        const impact = resolveCommImpact(c.symbol, label);
        const delta = c.changePercent != null ? pct(c.changePercent) : "Δ n/a";
        const impactStr = impact ? ` → ${impact.tickers} (${impact.note})` : "";
        commParas.push(
          `• ${label}: ${c.price != null ? c.price.toLocaleString("vi-VN") : "—"} (${delta})${impactStr}.`,
        );
      }
    } else {
      for (const x of shown) {
        const delta = x.hasDelta ? pct(x.c.changePercent) : "Δ n/a";
        const impactStr = x.impact ? ` → ${x.impact.tickers} (${x.impact.note})` : "";
        commParas.push(
          `• ${x.label}: ${x.c.price != null ? x.c.price.toLocaleString("vi-VN") : "—"} (${delta})${impactStr}.`,
        );
      }
    }
    if (comms.every((c) => c.changePercent == null)) {
      assumptions.push(
        "Hàng hóa: Δ% chưa có (nguồn DELAYED) — chỉ hiển thị giá đã verify, không nội suy biến động.",
      );
    }
  } else {
    commParas.push("Chưa lấy được bảng hàng hóa — ẩn block số liệu thay vì ước lượng.");
  }
  sections.push({
    heading: "4. Thị trường hàng hóa & ánh xạ mã VN",
    tone: "neutral",
    paragraphs: sanitizeParas(commParas),
  });

  const fxParas: string[] = [];
  if (snap.forex?.rows?.length) {
    for (const r of snap.forex.rows.slice(0, 6)) {
      fxParas.push(
        `• ${r.pair ?? r.symbol}: ${r.price != null ? r.price.toLocaleString("vi-VN") : "—"}${r.changePercent != null ? ` (${pct(r.changePercent)})` : ""}.`,
      );
    }
    fxParas.push(snap.forex.usdStrengthNote);
  } else {
    fxParas.push("Tỷ giá: chưa có hàng LIVE từ connector — không dùng số cũ không nhãn STALE.");
  }
  if (snap.crypto?.summary) {
    const s = snap.crypto.summary;
    fxParas.push(
      `Crypto (khẩu vị rủi ro): BTC ${pct(s.btcChangePercent)} · dominance/flow chi tiết cần nguồn bổ sung · Fear&Greed chưa nối trong pipeline hiện tại.`,
    );
  }
  sections.push({
    heading: "5. Tỷ giá & tiền số",
    tone: "neutral",
    paragraphs: sanitizeParas(fxParas),
  });

  sections.push({
    heading: "6. Lịch sự kiện hôm nay",
    tone: "neutral",
    paragraphs: sanitizeParas([
      "Economic calendar (ForexFactory) và lịch GDKHQ/ĐHCĐ/BCTC VN chưa nối connector đầy đủ trong phase hiện tại.",
      "Hành động: kiểm tra thủ công lịch công bố BCTC / đáo hạn VN30F / cơ cấu ETF trong ngày trước ATO.",
      "Khi connector calendar LIVE, block này sẽ liệt kê giờ VN · sự kiện · forecast · previous · đánh dấu ★ nếu lịch sử biến động chỉ số > 1%.",
    ]),
  });

  const regime =
    p.score > 0.35
      ? "Uptrend / risk-on"
      : p.score > 0.1
        ? "Sideway tích lũy nghiêng tăng"
        : p.score < -0.35
          ? "Downtrend / risk-off"
          : p.score < -0.1
            ? "Sideway phân phối nghiêng giảm"
            : "Sideway trung tính";
  const momentum = Math.round(clamp((p.score + 1) * 50, 0, 100));
  const s1 = idx ? Math.round(idx.value * 0.99) : null;
  const s2 = idx ? Math.round(idx.value * 0.98) : null;
  const r1 = idx ? Math.round(idx.value * 1.01) : null;
  const r2 = idx ? Math.round(idx.value * 1.02) : null;
  sections.push({
    heading: "7. Nhận định nhanh",
    tone,
    paragraphs: sanitizeParas([
      `TRẠNG THÁI: ${regime}`,
      `ĐỘNG LƯỢNG: ${momentum}/100 (pulse score ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)}; cấu thành từ crypto breadth + cross-asset + độ rộng VN khi LIVE).`,
      s1 != null
        ? `VÙNG KỸ THUẬT: Hỗ trợ S1 ≈ ${s1} (1% dưới đóng gần nhất) · S2 ≈ ${s2} · Kháng cự R1 ≈ ${r1} · R2 ≈ ${r2}. Cơ sở: % quanh giá đóng — thay bằng MA20/50/POC khi chuỗi nến đủ.`
        : "VÙNG KỸ THUẬT: Chưa định vị được vì thiếu VN-Index LIVE — không phác thảo vùng giá giả.",
      "KỊCH BẢN HÔM NAY: xem bảng Base/Bull/Bear bên dưới (xác suất sinh từ pulse engine, không do LLM bịa).",
      "QUẢN TRỊ RỦI RO: Ưu tiên chờ xác nhận độ rộng + thanh khoản 30 phút đầu; cắt nếu mất S1 kèm bán lan tỏa. Tỷ trọng đề xuất: phòng thủ khi momentum < 40, linh hoạt 40–60, chỉ nâng khi ≥ 65 kèm độ rộng mở.",
    ]),
  });

  const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).getDay();
  const hasForeignHint = (snap.news ?? []).some(
    (n) => /khối ngoại|foreign|ETF|room ngoại/i.test(n.title ?? ""),
  );
  let deepTopic: string;
  let deepBody: string[];
  if (dow === 4 && !hasForeignHint) {
    deepTopic = "Risk-appetite qua đêm → nhóm beta VN (không có foreign-flow session LIVE)";
    deepBody = [
      "Thiếu số liệu khối ngoại/ETF phiên gần — không suy diễn dòng vốn. Thay vào đó: dùng proxy risk-on/off từ crypto/FX để ước lượng áp lực lên nhóm beta cao (chứng khoán, BĐS) trong 30–60 phút đầu.",
      idx
        ? `VN-Index đóng ${idx.value.toLocaleString("vi-VN")} (${pct(idx.changePercent)}). Kịch bản thao tác: giữ quan sát quanh S1/R1 ở khối 7; chỉ nâng tỷ trọng khi độ rộng + KL xác nhận cùng chiều với proxy risk-on.`
        : "Thiếu VN-Index LIVE — ưu tiên đứng ngoài đến khi có điểm số và độ rộng đầu phiên.",
      "Insight: khi foreign-flow connector LIVE, block này sẽ đối chiếu mua/bán ròng theo nhóm ngành thay vì proxy gián tiếp.",
    ];
  } else {
    const deepTopics: Record<number, string> = {
      1: "Sector rotation & dòng tiền ngành (khung qualitative — RRG đầy đủ khi sector engine LIVE)",
      2: "Bóc tách cổ phiếu: ưu tiên mã được tin đề cập + kiểm tra thanh khoản đầu phiên",
      3: "Chuỗi giá trị hàng hóa → mã hưởng lợi (xem block 4)",
      4: "Dòng vốn: khối ngoại / ETF — bổ sung khi foreign-flow session LIVE",
      5: "Vĩ mô chuyên đề + preview tuần",
      0: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
      6: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
    };
    deepTopic = deepTopics[dow] ?? deepTopics[1];
    deepBody = [
      "Không lặp lại số liệu khối 1–3. Tập trung điều kiện kích hoạt: độ rộng mở + KL vượt TB ngắn hạn tại vùng kỹ thuật đã nêu.",
      actionable[0]
        ? `Tin dẫn dắt cần đối chiếu đầu phiên: «${actionable[0].title.slice(0, 120)}» (${actionable[0].source}).`
        : "Chưa có tin actionable dẫn dắt — ưu tiên tín hiệu kỹ thuật và thanh khoản hơn narrative.",
    ];
  }
  sections.push({
    heading: "8. Phân tích chuyên sâu",
    tone: "neutral",
    paragraphs: sanitizeParas([`Chủ đề hôm nay: ${deepTopic}.`, ...deepBody]),
  });

  const tagged = [
    ...new Set(
      actionable
        .flatMap((n) => n.relatedSymbols ?? [])
        .filter((s) => s.length >= 3 && s.length <= 4),
    ),
  ].slice(0, 8);
  sections.push({
    heading: "9. Danh mục theo dõi",
    tone: "neutral",
    paragraphs: sanitizeParas(
      tagged.length
        ? [
            `Mã từ tin actionable (24h): ${tagged.join(", ")}.`,
            "Trạng thái: Theo dõi. Kích hoạt khi (1) KL 15–30 phút đầu > TB 20 phiên và (2) giá giữ trên MA ngắn / không thủng S1 phiên. Cột kết quả tracker ở phase sau.",
          ]
        : [
            "Chưa có mã được gắn từ tin actionable trong cửa sổ gần.",
            "Duy trì watchlist cá nhân; không lặp rổ cố định mỗi ngày.",
          ],
    ),
  });

  sections.push({
    heading: "10. Disclaimer",
    tone: "neutral",
    paragraphs: [
      "Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư. Mọi quyết định mua/bán thuộc về nhà đầu tư và khẩu vị rủi ro cá nhân.",
    ],
  });

  return { sections, assumptions };
}

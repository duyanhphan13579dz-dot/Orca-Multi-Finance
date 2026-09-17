import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

interface MorningCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
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
      return out;
    })
    .filter((p) => p.trim().length > 0);
}

/** Commodity → VN tickers (ORCA Morning Brief Framework §4) */
const COMM_IMPACT: Record<string, { tickers: string; note: string }> = {
  XAUUSD: { tickers: "tâm lý phòng thủ toàn cầu", note: "chỉ báo risk-off" },
  CL: { tickers: "GAS, PLX, PVD, PVS, BSR, POW", note: "năng lượng" },
  BRENT: { tickers: "GAS, PLX, PVD, PVS, BSR", note: "năng lượng" },
  IRON: { tickers: "HPG, HSG, NKG", note: "thép / quặng" },
  HRC: { tickers: "HPG, HSG, NKG, VGS", note: "thép" },
  COPPER: { tickers: "HPG, PC1", note: "kim loại" },
  UREA: { tickers: "DPM, DCM, LAS, BFC", note: "phân bón" },
  SJC: { tickers: "tâm lý tích trữ trong nước", note: "vàng SJC" },
};

/**
 * Morning Brief 10 khối theo ORCA_Morning_Brief_Framework.md
 * no-mock-data · brand voice filter · commodity→VN mapping
 */
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
      `Hàng hóa: ${gold.commodity ?? gold.symbol} ${pct(gold.changePercent)} — ${COMM_IMPACT[gold.symbol]?.note ?? "theo dõi lan tỏa"}.`,
    );
  } else if ((snap.commodities ?? []).length) {
    const top = snap.commodities!
      .filter((c) => c.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))[0];
    if (top) bullets.push(`Hàng hóa biến động mạnh: ${top.commodity ?? top.symbol} ${pct(top.changePercent)}.`);
  }
  while (bullets.length < 4) {
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
  const macroNews = newsItems.filter((n) => n.category === "macro" || n.category === "policy").slice(0, 4);
  const corpNews = newsItems.filter((n) => n.category === "corporate").slice(0, 4);
  const otherNews = newsItems
    .filter((n) => n.category !== "macro" && n.category !== "policy" && n.category !== "corporate")
    .slice(0, 3);
  const macroParas: string[] = [];
  if (macroNews.length) {
    macroParas.push("**Quốc tế / chính sách:**");
    for (const n of macroNews) {
      macroParas.push(
        `• ${n.title} — ${n.source}${n.relatedSector ? ` · ngành: ${n.relatedSector}` : ""}${n.relatedSymbols?.length ? ` · mã: ${n.relatedSymbols.slice(0, 3).join(", ")}` : ""}.`,
      );
    }
  } else {
    macroParas.push("Chưa có tin vĩ mô/policy đạt ngưỡng nguồn trong cửa sổ gần — không bịa headline.");
  }
  if (corpNews.length) {
    macroParas.push("**Trong nước / doanh nghiệp:**");
    for (const n of corpNews) macroParas.push(`• ${n.title} — ${n.source}.`);
  }
  if (otherNews.length && macroParas.length < 6) {
    for (const n of otherNews.slice(0, 2)) macroParas.push(`• ${n.title} — ${n.source}.`);
  }
  sections.push({
    heading: "2. Tin tức vĩ mô & doanh nghiệp",
    tone: "neutral",
    paragraphs: sanitizeParas(macroParas),
  });

  const mktParas: string[] = [];
  mktParas.push("**3.1 Quốc tế qua đêm (proxy risk-appetite)**");
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
  mktParas.push("**3.2 VN-Index — recap phiên gần nhất**");
  if (idx) {
    mktParas.push(
      `Đóng cửa: **${idx.value.toLocaleString("vi-VN")}** điểm · ${pct(idx.changePercent)} · Δ ${idx.change >= 0 ? "+" : ""}${idx.change.toLocaleString("vi-VN")} điểm.`,
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
  mktParas.push(
    `**Pulse engine:** score ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} (−1..+1) · ${p.headline}`,
  );
  sections.push({
    heading: "3. Thị trường tài chính",
    tone,
    paragraphs: sanitizeParas(mktParas),
  });

  const commParas: string[] = [];
  const comms = snap.commodities ?? [];
  if (comms.length) {
    for (const c of comms.slice(0, 10)) {
      if (c.changePercent == null && c.price == null) continue;
      const map = COMM_IMPACT[c.symbol];
      const impact = map ? ` → tác động VN: ${map.tickers} (${map.note})` : "";
      commParas.push(
        `• **${c.commodity ?? c.symbol}**: ${c.price != null ? c.price.toLocaleString("vi-VN") : "—"} (${pct(c.changePercent)})${impact}.`,
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
      `**TRẠNG THÁI:** ${regime}`,
      `**ĐỘNG LƯỢNG:** ${momentum}/100 (pulse score ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)}; cấu thành từ crypto breadth + cross-asset — chưa gộp đủ breadth/foreign VN cho tới khi session-stats LIVE).`,
      s1 != null
        ? `**VÙNG KỸ THUẬT:** Hỗ trợ S1 ≈ ${s1} (1% dưới đóng gần nhất) · S2 ≈ ${s2} · Kháng cự R1 ≈ ${r1} · R2 ≈ ${r2}. Cơ sở: % quanh giá đóng — thay bằng MA20/50/POC khi chuỗi nến đủ.`
        : "**VÙNG KỸ THUẬT:** Chưa định vị được vì thiếu VN-Index LIVE — không phác thảo vùng giá giả.",
      "**KỊCH BẢN HÔM NAY:** xem bảng Base/Bull/Bear bên dưới (xác suất sinh từ pulse engine, không do LLM bịa).",
      "**QUẢN TRỊ RỦI RO:** Ưu tiên chờ xác nhận độ rộng + thanh khoản 30 phút đầu; cắt nếu mất S1 kèm bán lan tỏa. Tỷ trọng đề xuất: phòng thủ khi momentum < 40, linh hoạt 40–60, chỉ nâng khi ≥ 65 kèm độ rộng mở.",
    ]),
  });

  const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).getDay();
  const deepTopics: Record<number, string> = {
    1: "Sector rotation & dòng tiền ngành (khung qualitative — RRG đầy đủ khi sector engine LIVE)",
    2: "Bóc tách cổ phiếu: ưu tiên mã được tin đề cập + kiểm tra thanh khoản đầu phiên",
    3: "Chuỗi giá trị hàng hóa → mã hưởng lợi (xem block 4)",
    4: "Dòng vốn: khối ngoại / ETF — bổ sung khi foreign-flow session LIVE",
    5: "Vĩ mô chuyên đề + preview tuần",
    0: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
    6: "Tổng quan cuối tuần — rủi ro gap đầu tuần sau",
  };
  sections.push({
    heading: "8. Phân tích chuyên sâu",
    tone: "neutral",
    paragraphs: sanitizeParas([
      `Chủ đề hôm nay: **${deepTopics[dow] ?? deepTopics[1]}**.`,
      p.body[0] ?? "Động lượng cross-asset chưa đủ mạnh để xác nhận xu hướng mới trên VN.",
      p.body[1] ?? "Ưu tiên quan sát phản ứng tại vùng hỗ trợ/kháng cự gần và chất lượng thanh khoản.",
      `Drivers pulse: ${p.drivers?.map((d) => `${d.label}: ${d.value}`).join("; ") || "—"}.`,
    ]),
  });

  const tagged = [
    ...new Set(
      (snap.news ?? [])
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
            `Mã được dòng tin gắn nhãn (24h): **${tagged.join(", ")}**.`,
            "Trạng thái mặc định: Theo dõi — kích hoạt chỉ khi volume đột biến đầu phiên + giá giữ trên MA ngắn. Cột Kết quả sẽ được tracker công khai ở phase sau.",
          ]
        : [
            "Chưa có mã được gắn từ tin trong cửa sổ gần.",
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

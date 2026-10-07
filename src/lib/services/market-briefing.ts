import "server-only";
import { buildMarketIntel } from "./market-intel";
import * as vndirect from "../providers/vndirect";
import { getVnQuotes } from "./stocks";
import { getSectorTrendSnapshot } from "./sector-trend";
import type { FreshnessStatus } from "../types";

export type MarketBriefingBuilt = {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
};

function fmtPts(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: d });
}

function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

/** Giá trị VND → tỷ đồng */
function fmtTy(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const ty = v / 1e9;
  if (Math.abs(ty) >= 1000) return `${(ty / 1000).toFixed(2)} nghìn tỷ`;
  return `${ty.toFixed(1)} tỷ`;
}

/**
 * Bản nhận định thị trường 4 phần chuẩn hóa — dùng cho Agent khi hỏi
 * "Thị trường đang diễn ra chuyện gì?" / "Nhận định thị trường hôm nay" …
 */
export async function buildVnMarketBriefing(): Promise<MarketBriefingBuilt> {
  const sectionsUsed: string[] = [];
  const freshnesses: FreshnessStatus[] = [];
  const symbols: string[] = [];

  const [intelPack, foreignPack, idxStats, boardQuotes, sectorPack] = await Promise.all([
    buildMarketIntel().catch(() => null),
    vndirect.getVndForeignFlow().catch(() => null),
    vndirect.getVndIndexSessionStats("VNINDEX").catch(() => null),
    getVnQuotes([
      "VCB",
      "BID",
      "CTG",
      "TCB",
      "MBB",
      "VPB",
      "HPG",
      "FPT",
      "VIC",
      "VHM",
      "GAS",
      "MSN",
      "MWG",
      "VNM",
      "SSI",
    ]).catch(() => null),
    getSectorTrendSnapshot().catch(() => null),
  ]);

  if (!intelPack) {
    return {
      narrative:
        "Chưa lấy được dữ liệu thị trường Việt Nam từ pipeline ORCA. Vui lòng thử lại sau ít phút.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: [],
      unavailable: true,
    };
  }

  const { intel, meta } = intelPack;
  freshnesses.push(meta.freshness);
  sectionsUsed.push("market-intel");

  const vn = intel.indices?.find((i) => i.code === "VNINDEX") ?? null;
  const vn30 = intel.indices?.find((i) => i.code === "VN30") ?? null;
  const hnx = intel.indices?.find((i) => /HNX/.test(i.code)) ?? null;
  const upcom = intel.indices?.find((i) => /UPCOM/.test(i.code)) ?? null;

  // —— 1. Chỉ số & dẫn dắt ——
  const part1: string[] = ["## 1. Biến động chỉ số & cổ phiếu dẫn dắt"];

  if (vn) {
    part1.push(
      `**VN-Index**: ${fmtPts(vn.value)} điểm (${fmtPct(vn.changePercent)} · ${vn.change >= 0 ? "+" : ""}${fmtPts(vn.change)} điểm).`,
    );
    symbols.push("VNINDEX");
  } else {
    part1.push("**VN-Index**: chưa có số liệu phiên từ nguồn chỉ số.");
  }
  if (vn30) {
    part1.push(`**VN30**: ${fmtPts(vn30.value)} (${fmtPct(vn30.changePercent)}).`);
  }
  if (hnx) {
    part1.push(`**${hnx.code}**: ${fmtPts(hnx.value)} (${fmtPct(hnx.changePercent)}).`);
  }
  if (upcom) {
    part1.push(`**${upcom.code}**: ${fmtPts(upcom.value)} (${fmtPct(upcom.changePercent)}).`);
  }

  const pos = intel.contributors?.positive?.slice(0, 6) ?? [];
  const neg = intel.contributors?.negative?.slice(0, 6) ?? [];
  if (pos.length || neg.length) {
    if (pos.length) {
      part1.push(
        "**Mã đóng góp tích cực (trọng yếu):** " +
          pos
            .map((c) => {
              symbols.push(c.symbol);
              const chg = c.changePercent != null ? fmtPct(c.changePercent) : "";
              return `${c.symbol}${chg ? ` ${chg}` : ""}`;
            })
            .join(", ") +
          ".",
      );
    }
    if (neg.length) {
      part1.push(
        "**Mã kéo chỉ số giảm:** " +
          neg
            .map((c) => {
              symbols.push(c.symbol);
              const chg = c.changePercent != null ? fmtPct(c.changePercent) : "";
              return `${c.symbol}${chg ? ` ${chg}` : ""}`;
            })
            .join(", ") +
          ".",
      );
    }
  } else if (boardQuotes?.quotes?.length) {
    const sorted = [...boardQuotes.quotes].sort(
      (a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0),
    );
    const up = sorted.filter((q) => (q.changePercent ?? 0) > 0).slice(0, 5);
    const dn = sorted.filter((q) => (q.changePercent ?? 0) < 0).slice(0, 5);
    if (up.length) {
      part1.push(
        "**Cổ phiếu vốn hóa lớn biến động mạnh (tăng):** " +
          up.map((q) => `${q.symbol} ${fmtPct(q.changePercent)}`).join(", ") +
          ".",
      );
    }
    if (dn.length) {
      part1.push(
        "**Cổ phiếu vốn hóa lớn biến động mạnh (giảm):** " +
          dn.map((q) => `${q.symbol} ${fmtPct(q.changePercent)}`).join(", ") +
          ".",
      );
    }
  } else {
    part1.push("Chưa đủ dữ liệu đóng góp từng mã vào chỉ số trong phiên.");
  }

  // —— 2. Khối ngoại ——
  const part2: string[] = ["## 2. Động thái khối ngoại"];
  sectionsUsed.push("foreign-flow");

  const fn = foreignPack?.netVal ?? intel.flow.foreignNet;
  const fb = foreignPack?.buyVal ?? null;
  const fs = foreignPack?.sellVal ?? null;
  const sess = foreignPack?.sessionDate ?? null;

  if (fn != null) {
    const side = fn >= 0 ? "**mua ròng**" : "**bán ròng**";
    part2.push(
      `Xu hướng: khối ngoại ${side} khoảng **${fmtTy(Math.abs(fn))}**` +
        (sess ? ` (phiên ${sess})` : "") +
        ".",
    );
    if (fb != null && fs != null) {
      part2.push(`Giá trị mua: ${fmtTy(fb)} · Giá trị bán: ${fmtTy(fs)}.`);
    }
  } else {
    part2.push(
      intel.flow.note ||
        "Chưa lấy được vị thế ròng khối ngoại phiên — không ước lượng số liệu.",
    );
  }

  const topBuy = foreignPack?.topNetBuy?.slice(0, 5) ?? [];
  const topSell = foreignPack?.topNetSell?.slice(0, 5) ?? [];
  if (topBuy.length) {
    part2.push(
      "**Mua ròng mạnh:** " +
        topBuy
          .map((r) => {
            symbols.push(r.symbol);
            return `${r.symbol} (${fmtTy(r.netVal)})`;
          })
          .join(", ") +
        ".",
    );
  }
  if (topSell.length) {
    part2.push(
      "**Bán ròng mạnh:** " +
        topSell
          .map((r) => {
            symbols.push(r.symbol);
            return `${r.symbol} (${fmtTy(Math.abs(r.netVal))})`;
          })
          .join(", ") +
        ".",
    );
  }
  if (!topBuy.length && !topSell.length && fn != null) {
    part2.push("Chưa tách được danh mục mã mua/bán ròng chi tiết trong payload phiên.");
  }

  // —— 3. Thanh khoản & độ rộng ——
  const part3: string[] = ["## 3. Thanh khoản & độ rộng thị trường"];
  sectionsUsed.push("liquidity", "breadth");

  const val = idxStats?.value ?? intel.liquidity.valueTraded ?? null;
  if (val != null) {
    part3.push(`**Giá trị khớp lệnh (tham chiếu VN-Index board):** khoảng **${fmtTy(val)}**.`);
  } else {
    part3.push(intel.liquidity.note || "Chưa có tổng giá trị giao dịch phiên.");
  }

  const { advancers, decliners, unchanged } = intel.breadth;
  if (intel.breadth.available) {
    const total = advancers + decliners + unchanged;
    part3.push(
      `**Độ rộng:** ${advancers} mã tăng / ${decliners} mã giảm / ${unchanged} tham chiếu` +
        (total > 0 ? ` (trên ~${total} mã thống kê)` : "") +
        ".",
    );
    const bias =
      advancers > decliners * 1.15
        ? "Dòng tiền nghiêng về phía mua, số mã tăng vượt trội."
        : decliners > advancers * 1.15
          ? "Áp lực bán lan rộng, số mã giảm chiếm ưu thế."
          : "Thị trường phân hóa, cung cầu cân bằng hơn.";
    part3.push(bias);
  } else {
    part3.push(intel.breadth.note || "Chưa có thống kê tăng/giảm toàn sàn.");
  }

  const sessionHint = intel.sessionHint || intel.session?.labelVi || "";
  if (sessionHint) {
    part3.push(`**Khung phiên:** ${sessionHint}.`);
  }

  // —— 4. Ngành & vĩ mô ——
  const part4: string[] = ["## 4. Tổng quan ngành & nguyên nhân vĩ mô"];
  sectionsUsed.push("condition", "news");

  if (intel.condition) {
    part4.push(
      `**Đánh giá điều kiện thị trường (ORCA):** ${intel.condition.rating}` +
        (intel.condition.score != null ? ` · điểm ${Math.round(intel.condition.score)}/100` : "") +
        ` · độ tin cậy ${intel.condition.confidence}.`,
    );
    if (intel.condition.drivers?.length) {
      part4.push("**Động lực chính:** " + intel.condition.drivers.slice(0, 4).join("; ") + ".");
    }
    if (intel.condition.risks?.length) {
      part4.push("**Rủi ro cần theo dõi:** " + intel.condition.risks.slice(0, 3).join("; ") + ".");
    }
  }

  if (boardQuotes?.quotes?.length) {
    const banks = boardQuotes.quotes.filter((q) =>
      ["VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "HDB"].includes(q.symbol),
    );
    const avg = (qs: typeof boardQuotes.quotes) => {
      const xs = qs.map((q) => q.changePercent).filter((x): x is number => x != null);
      if (!xs.length) return null;
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const bankAvg = avg(banks);
    if (bankAvg != null) {
      part4.push(`**Nhóm ngân hàng (mẫu vốn hóa lớn):** biên độ TB khoảng ${fmtPct(bankAvg)}.`);
    }
  }

  if (intel.news?.length) {
    part4.push(
      "**Tin / yếu tố đang được nhắc tới:** " +
        intel.news
          .slice(0, 3)
          .map((n) => n.title)
          .filter(Boolean)
          .join("; ") +
        ".",
    );
  }

  if (sectorPack?.snapshot?.sectors?.length) {
    const leaders = sectorPack.snapshot.leaders.slice(0, 3).map((s) => `${s.sector} (${s.trendLabelVi}, ${fmtPct(s.avgChangePercent)})`).join("; ");
    const laggards = sectorPack.snapshot.laggards.slice(0, 3).map((s) => `${s.sector} (${s.trendLabelVi}, ${fmtPct(s.avgChangePercent)})`).join("; ");
    if (leaders) part4.push(`**Ngành mạnh:** ${leaders}.`);
    if (laggards) part4.push(`**Ngành yếu:** ${laggards}.`);
  } else {
    part4.push("Chưa lấy được bảng xếp hạng ngành trong phiên; không suy diễn nhóm dẫn dắt.");
  }

  if (intel.crossAsset.length) {
    const cross = intel.crossAsset.filter((x) => x.changePercent != null).slice(0, 6).map((x) => `${x.label} ${fmtPct(x.changePercent)}`).join("; ");
    if (cross) part4.push(`**Liên thị trường:** ${cross}.`);
  }

  part4.push(
    "**Tâm lý:** " +
      (vn && vn.changePercent != null
        ? vn.changePercent > 0.4
          ? "Dòng tiền chủ động mua, cổ phiếu trụ và độ rộng ủng hộ nhịp tăng."
          : vn.changePercent < -0.4
            ? "Áp lực điều chỉnh, cần quan sát phản ứng tại vùng hỗ trợ và hành vi khối ngoại."
            : "Thị trường đi ngang / phân hóa; biến động chỉ số phụ thuộc nhóm dẫn dắt và thanh khoản cuối phiên."
        : "Chưa đủ biến động chỉ số để kết luận tâm lý phiên."),
  );

  const updatedAt = meta.sourceTimestamp ? new Date(meta.sourceTimestamp).toLocaleString("vi-VN") : "chưa xác định";
  const header =
    `Bản nhận định thị trường được xây dựng theo cấu trúc **4 phần chuẩn hóa**, đi từ biến động chỉ số đến hành vi dòng vốn và yếu tố liên thị trường. **Thời điểm dữ liệu:** ${updatedAt}.\n`;

  const narrative = [header, part1.join("\n\n"), part2.join("\n\n"), part3.join("\n\n"), part4.join("\n\n")].join(
    "\n\n",
  );

  return {
    narrative,
    contract: {
      scope: "vn-market-briefing-v1",
      vnIndex: vn,
      vn30,
      hnx,
      upcom,
      foreign: foreignPack
        ? {
            net: foreignPack.netVal,
            buy: foreignPack.buyVal,
            sell: foreignPack.sellVal,
            sessionDate: foreignPack.sessionDate,
            topBuy: foreignPack.topNetBuy?.slice(0, 5),
            topSell: foreignPack.topNetSell?.slice(0, 5),
          }
        : { net: intel.flow.foreignNet },
      breadth: intel.breadth,
      liquidity: { valueTraded: val },
      condition: intel.condition,
      crossAsset: intel.crossAsset,
      sectors: sectorPack?.snapshot?.sectors?.slice(0, 10) ?? [],
      dataTimestamp: meta.sourceTimestamp,
    },
    sectionsUsed: [...new Set(sectionsUsed)],
    symbols: [...new Set(symbols)],
    freshnesses,
  };
}

import "server-only";

export interface BreadthMetrics {
  advancers: number;
  decliners: number;
  unchanged: number;
  source: string;
  available: boolean;
  note?: string;
  total?: number;
  adRatio?: number | null;
  advancePct?: number | null;
  netAdvances?: number | null;
  regime?: string | null;
  regimeVi?: string | null;
}

export function enrichBreadth<
  T extends { advancers: number; decliners: number; unchanged: number; available: boolean },
>(b: T): T & {
  total: number;
  adRatio: number | null;
  advancePct: number | null;
  netAdvances: number | null;
  regime: string | null;
  regimeVi: string | null;
} {
  if (!b.available) {
    return {
      ...b,
      total: 0,
      adRatio: null,
      advancePct: null,
      netAdvances: null,
      regime: null,
      regimeVi: null,
    };
  }
  const total = Math.max(0, b.advancers + b.decliners + b.unchanged);
  const adRatio = b.decliners > 0 ? b.advancers / b.decliners : b.advancers > 0 ? 99 : 1;
  const advancePct = total > 0 ? (b.advancers / total) * 100 : null;
  const netAdvances = b.advancers - b.decliners;
  let regime = "neutral";
  let regimeVi = "Trung tính";
  if (adRatio >= 2.0 || (advancePct != null && advancePct >= 60)) {
    regime = "strong-up";
    regimeVi = "Mở rộng mạnh";
  } else if (adRatio >= 1.25 || (advancePct != null && advancePct >= 52)) {
    regime = "mild-up";
    regimeVi = "Nghiêng tăng";
  } else if (adRatio <= 0.5 || (advancePct != null && advancePct <= 35)) {
    regime = "strong-down";
    regimeVi = "Thu hẹp mạnh";
  } else if (adRatio <= 0.8 || (advancePct != null && advancePct <= 45)) {
    regime = "mild-down";
    regimeVi = "Nghiêng giảm";
  }
  return { ...b, total, adRatio, advancePct, netAdvances, regime, regimeVi };
}

export function formatBreadthParagraphs(
  b: { available: boolean; advancers: number; decliners: number; unchanged: number } | null | undefined,
): string[] {
  if (!b || !b.available) {
    return [
      "Độ rộng VN: chưa có thống kê tăng/giảm phiên (session-stats) — không suy diễn A/D.",
    ];
  }
  const e = enrichBreadth(b);
  const ratio =
    e.adRatio != null ? (e.adRatio >= 10 ? ">10" : e.adRatio.toFixed(2)) : "—";
  const pct = e.advancePct != null ? `${e.advancePct.toFixed(1)}%` : "—";
  const net =
    e.netAdvances != null
      ? `${e.netAdvances >= 0 ? "+" : ""}${e.netAdvances}`
      : "—";
  return [
    `Độ rộng VN: ${e.advancers}↑ / ${e.decliners}↓ / ${e.unchanged}— · A/D ${ratio} · mã tăng ${pct} · net ${net} · ${e.regimeVi ?? "—"}.`,
    e.regime === "strong-up" || e.regime === "mild-up"
      ? "Độ rộng ủng hộ nhịp tăng — ưu tiên xác nhận thêm thanh khoản trước khi nâng tỷ trọng."
      : e.regime === "strong-down" || e.regime === "mild-down"
        ? "Độ rộng nghiêng bán — nếu chỉ số vẫn xanh dễ là lực kéo tập trung ít mã; tránh đuổi khi breadth thu hẹp."
        : "Độ rộng trung tính — ưu tiên cổ phiếu có KL thực và câu chuyện riêng hơn là đánh chỉ số.",
  ];
}

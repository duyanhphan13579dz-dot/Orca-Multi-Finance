import "server-only";

/**
 * MARKET CONDITION / MARKET STATE ENGINE (quantitative, deterministic).
 *
 * Every score exposes: formula · weight · inputs · value — so the UI and the
 * LLM can explain exactly WHY the market is rated the way it is. The LLM never
 * decides the rating; it only interprets this output.
 *
 * Components (0..100, 50 = neutral):
 *   trend       — VN index momentum (fallback: cross-asset risk proxy)
 *   breadth     — advancers vs decliners participation
 *   liquidity   — traded value vs its own recent baseline
 *   flow        — foreign/proprietary net flow direction
 *   globalRisk  — DXY (inverse) + US yields proxy + oil shock
 *   crossAsset  — BTC/Gold/Oil composite risk appetite
 */

export type MarketRating =
  | "BULLISH"
  | "MODERATELY BULLISH"
  | "NEUTRAL"
  | "MIXED"
  | "MODERATELY BEARISH"
  | "BEARISH";

export interface ScoreComponent {
  key: "trend" | "breadth" | "liquidity" | "flow" | "globalRisk" | "crossAsset";
  label: string;
  score: number | null; // 0..100
  weight: number; // 0..1
  formula: string;
  inputs: Record<string, number | string | null>;
  available: boolean;
  note?: string;
}

export interface MarketConditionResult {
  rating: MarketRating;
  score: number; // 0..100 weighted composite
  confidence: "HIGH" | "MEDIUM" | "LOW";
  components: ScoreComponent[];
  drivers: string[];
  risks: string[];
  crossAssetState: "RISK ON" | "RISK OFF" | "NEUTRAL" | "MIXED";
  coverage: number; // share of weight with real data
}

export interface ConditionInputs {
  index?: { changePercent: number | null; value: number | null; code: string } | null;
  breadth?: { advancers: number; decliners: number; unchanged: number } | null;
  liquidity?: { valueTraded: number | null; baseline: number | null } | null;
  flow?: { foreignNet: number | null; propNet: number | null } | null;
  crossAsset?: { dxy: number | null; wti: number | null; gold: number | null; btc: number | null } | null;
  cryptoBreadth?: { advancers: number; decliners: number; total: number; avgChange: number } | null;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function computeMarketCondition(inp: ConditionInputs): MarketConditionResult {
  const comps: ScoreComponent[] = [];

  /* ---------------------------- 1. trend (0.26) --------------------------- */
  if (inp.index?.changePercent != null) {
    const c = inp.index.changePercent;
    comps.push({
      key: "trend",
      label: "Xu hướng chỉ số",
      score: clamp(50 + c * 20),
      weight: 0.26,
      formula: "50 + (index_change_% × 20), clamp 0..100",
      inputs: { index: inp.index.code, change_pct: round1(c) },
      available: true,
    });
  } else if (inp.cryptoBreadth) {
    const a = inp.cryptoBreadth.avgChange;
    comps.push({
      key: "trend",
      label: "Xu hướng (proxy tài sản rủi ro toàn cầu)",
      score: clamp(50 + a * 8),
      weight: 0.18,
      formula: "50 + (avg_global_risk_asset_change_% × 8) — proxy khi VN-Index chưa kết nối",
      inputs: { avg_change_pct: round1(a) },
      available: true,
      note: "Proxy — không thay thế VN-Index",
    });
  } else {
    comps.push({ key: "trend", label: "Xu hướng chỉ số", score: null, weight: 0.26, formula: "50 + (index_change_% × 20)", inputs: {}, available: false });
  }

  /* --------------------------- 2. breadth (0.22) -------------------------- */
  const br = inp.breadth ?? (inp.cryptoBreadth ? { advancers: inp.cryptoBreadth.advancers, decliners: inp.cryptoBreadth.decliners, unchanged: 0 } : null);
  if (br && br.advancers + br.decliners > 0) {
    const ratio = (br.advancers - br.decliners) / (br.advancers + br.decliners);
    comps.push({
      key: "breadth",
      label: "Độ rộng thị trường",
      score: clamp(50 + ratio * 50),
      weight: inp.breadth ? 0.22 : 0.14,
      formula: "50 + ((advancers − decliners) / (advancers + decliners)) × 50",
      inputs: { advancers: br.advancers, decliners: br.decliners, unchanged: br.unchanged },
      available: true,
      note: inp.breadth ? undefined : "Proxy từ độ rộng crypto khi breadth VN chưa khả dụng",
    });
  } else {
    comps.push({ key: "breadth", label: "Độ rộng thị trường", score: null, weight: 0.22, formula: "50 + A/D ratio × 50", inputs: {}, available: false });
  }

  /* -------------------------- 3. liquidity (0.16) ------------------------- */
  if (inp.liquidity?.valueTraded != null && inp.liquidity.baseline) {
    const r = inp.liquidity.valueTraded / inp.liquidity.baseline;
    comps.push({
      key: "liquidity",
      label: "Thanh khoản",
      score: clamp(50 + (r - 1) * 60),
      weight: 0.16,
      formula: "50 + (value_traded / baseline_20d − 1) × 60",
      inputs: { value_traded: inp.liquidity.valueTraded, baseline_20d: inp.liquidity.baseline, ratio: round1(r) },
      available: true,
    });
  } else {
    comps.push({ key: "liquidity", label: "Thanh khoản", score: null, weight: 0.16, formula: "50 + (value/baseline − 1) × 60", inputs: {}, available: false, note: "Cần dữ liệu giá trị giao dịch từ VNStock" });
  }

  /* ----------------------------- 4. flow (0.14) --------------------------- */
  if (inp.flow && (inp.flow.foreignNet != null || inp.flow.propNet != null)) {
    const fn = inp.flow.foreignNet ?? 0;
    const pn = inp.flow.propNet ?? 0;
    const net = fn + pn * 0.5;
    comps.push({
      key: "flow",
      label: "Dòng vốn (ngoại + tự doanh)",
      score: clamp(50 + Math.sign(net) * Math.min(Math.abs(net) / 1e12, 1) * 40),
      weight: 0.14,
      formula: "50 + sign(net) × min(|foreign_net + 0.5×prop_net| / 1e12, 1) × 40",
      inputs: { foreign_net: fn, prop_net: pn },
      available: true,
    });
  } else {
    comps.push({ key: "flow", label: "Dòng vốn (ngoại + tự doanh)", score: null, weight: 0.14, formula: "sign(net) × normalized magnitude", inputs: {}, available: false, note: "Cần dữ liệu khối ngoại/tự doanh từ provider VN" });
  }

  /* -------------------------- 5. global risk (0.12) ----------------------- */
  const ca = inp.crossAsset;
  if (ca && (ca.dxy != null || ca.wti != null)) {
    const dxyPart = ca.dxy != null ? -ca.dxy * 12 : 0; // USD mạnh → áp lực lên EM
    const oilShock = ca.wti != null ? -Math.max(0, Math.abs(ca.wti) - 3) * 3 : 0; // sốc giá dầu 2 chiều
    comps.push({
      key: "globalRisk",
      label: "Rủi ro toàn cầu",
      score: clamp(50 + dxyPart + oilShock),
      weight: 0.12,
      formula: "50 − (DXY_change_% × 12) − max(0, |WTI_change_%| − 3) × 3",
      inputs: { dxy_change_pct: ca.dxy != null ? round1(ca.dxy) : null, wti_change_pct: ca.wti != null ? round1(ca.wti) : null },
      available: true,
    });
  } else {
    comps.push({ key: "globalRisk", label: "Rủi ro toàn cầu", score: null, weight: 0.12, formula: "50 − DXY×12 − oil shock", inputs: {}, available: false });
  }

  /* -------------------------- 6. cross-asset (0.10) ----------------------- */
  if (ca && (ca.btc != null || ca.gold != null)) {
    const btcPart = ca.btc != null ? ca.btc * 3 : 0;
    const goldPart = ca.gold != null ? -ca.gold * 4 : 0; // vàng tăng mạnh = né rủi ro
    comps.push({
      key: "crossAsset",
      label: "Khẩu vị rủi ro liên tài sản",
      score: clamp(50 + btcPart + goldPart),
      weight: 0.1,
      formula: "50 + (BTC_change_% × 3) − (Gold_change_% × 4)",
      inputs: { btc_change_pct: ca.btc != null ? round1(ca.btc) : null, gold_change_pct: ca.gold != null ? round1(ca.gold) : null },
      available: true,
    });
  } else {
    comps.push({ key: "crossAsset", label: "Khẩu vị rủi ro liên tài sản", score: null, weight: 0.1, formula: "50 + BTC×3 − Gold×4", inputs: {}, available: false });
  }

  /* ------------------------------ composite ------------------------------- */
  const active = comps.filter((c) => c.available && c.score != null);
  const totalW = active.reduce((a, c) => a + c.weight, 0);
  const score = totalW > 0 ? active.reduce((a, c) => a + (c.score as number) * c.weight, 0) / totalW : 50;
  const totalPossible = comps.reduce((a, c) => a + c.weight, 0);
  const coverage = totalPossible > 0 ? totalW / totalPossible : 0;

  const spread = active.length > 1 ? Math.max(...active.map((c) => c.score as number)) - Math.min(...active.map((c) => c.score as number)) : 0;
  const rating: MarketRating =
    spread > 42 && Math.abs(score - 50) < 12
      ? "MIXED"
      : score >= 68
        ? "BULLISH"
        : score >= 57
          ? "MODERATELY BULLISH"
          : score > 43
            ? "NEUTRAL"
            : score > 32
              ? "MODERATELY BEARISH"
              : "BEARISH";

  const confidence: MarketConditionResult["confidence"] = coverage >= 0.7 ? "HIGH" : coverage >= 0.4 ? "MEDIUM" : "LOW";

  /* cross-asset state (independent of VN availability) */
  let crossAssetState: MarketConditionResult["crossAssetState"] = "NEUTRAL";
  if (ca) {
    const riskOn = (ca.btc ?? 0) > 0.5 && (ca.dxy ?? 0) < 0.15;
    const riskOff = ((ca.gold ?? 0) > 0.5 && (ca.btc ?? 0) < -0.5) || (ca.dxy ?? 0) > 0.4;
    crossAssetState = riskOn && !riskOff ? "RISK ON" : riskOff && !riskOn ? "RISK OFF" : riskOn && riskOff ? "MIXED" : "NEUTRAL";
  }

  /* drivers & risks derived from component deviation from neutral */
  const sorted = [...active].sort((a, b) => Math.abs((b.score as number) - 50) - Math.abs((a.score as number) - 50));
  const drivers = sorted.filter((c) => (c.score as number) >= 53).slice(0, 3).map((c) => describe(c, true));
  const risks = sorted.filter((c) => (c.score as number) <= 47).slice(0, 3).map((c) => describe(c, false));
  if (!drivers.length) drivers.push("Chưa có cấu phần nào đủ mạnh để xem là động lực dẫn dắt — thị trường thiếu chất xúc tác rõ ràng.");
  if (!risks.length) risks.push("Không có cấu phần nào ở vùng cảnh báo tại thờ điểm đánh giá.");
  const missing = comps.filter((c) => !c.available);
  if (missing.length) risks.push(`Độ phủ dữ liệu ${(coverage * 100).toFixed(0)}% — thiếu: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`);

  return { rating, score: Math.round(score * 10) / 10, confidence, components: comps, drivers, risks, crossAssetState, coverage: Math.round(coverage * 100) / 100 };
}

function describe(c: ScoreComponent, positive: boolean): string {
  const v = c.score as number;
  const map: Record<ScoreComponent["key"], [string, string]> = {
    trend: ["Xu hướng chỉ số đang nghiêng tích cực", "Xu hướng chỉ số suy yếu"],
    breadth: ["Độ rộng mở rộng — nhịp tăng có sự tham gia rộng", "Độ rộng thu hẹp — nhịp vận động tập trung ở ít mã"],
    liquidity: ["Thanh khoản cải thiện so với nền 20 phiên", "Thanh khoản suy giảm dưới nền 20 phiên"],
    flow: ["Dòng vốn ngoại/tự doanh nghiêng mua ròng", "Dòng vốn ngoại/tự doanh nghiêng bán ròng"],
    globalRisk: ["Bối cảnh quốc tế hỗ trợ (USD dịu, giá dầu ổn)", "Bối cảnh quốc tế gây áp lực (USD mạnh hoặc sốc giá dầu)"],
    crossAsset: ["Khẩu vị rủi ro liên tài sản tích cực", "Dòng tiền phòng thủ chiếm ưu thế trên các lớp tài sản"],
  };
  const [pos, neg] = map[c.key];
  return `${positive ? pos : neg} (điểm ${v.toFixed(0)}/100${c.note ? ` · ${c.note}` : ""}).`;
}

/* ------------------------- index contribution engine ----------------------- */

export interface ContributionRow {
  symbol: string;
  changePercent: number;
  weightPct: number | null;
  indexPoints: number | null;
}

/**
 * INDEX POINT CONTRIBUTION = index_value × weight × (price_change_% / 100)
 * Distinguishes "mã tăng mạnh nhất" from "mã đóng góp nhiều điểm nhất".
 * Requires index weights; without them the engine returns nulls (no guessing).
 */
export function computeContributions(
  indexValue: number | null,
  rows: { symbol: string; changePercent: number | null; weightPct?: number | null }[],
): { positive: ContributionRow[]; negative: ContributionRow[]; hasWeights: boolean } {
  const hasWeights = rows.some((r) => r.weightPct != null && r.weightPct > 0);
  const mapped: ContributionRow[] = rows
    .filter((r) => r.changePercent != null)
    .map((r) => ({
      symbol: r.symbol,
      changePercent: r.changePercent as number,
      weightPct: r.weightPct ?? null,
      indexPoints:
        indexValue != null && r.weightPct != null
          ? (indexValue * (r.weightPct / 100) * (r.changePercent as number)) / 100
          : null,
    }));
  const sortKey = (x: ContributionRow) => (x.indexPoints != null ? x.indexPoints : x.changePercent);
  const sorted = [...mapped].sort((a, b) => sortKey(b) - sortKey(a));
  return {
    positive: sorted.filter((x) => sortKey(x) > 0).slice(0, 8),
    negative: sorted.filter((x) => sortKey(x) < 0).reverse().slice(0, 8),
    hasWeights,
  };
}

/**
 * VALUATION ENGINE — Phase 2
 * Cash-flow multiples (P/FCF, P/CF), FCFF / FCFE, historical multiples, peer comparison.
 * Rules: never invent figures; null + status when inputs missing; no NaN/Infinity.
 * FCFF → enterprise side · FCFE → equity side (never conflate).
 */

import { type MetricCell, type MetricStatus } from "./valuation-phase1";

export const VALUATION_ENGINE_VERSION_PHASE2 = "2.1.0-phase2";

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function cell(
  value: number | null,
  status: MetricStatus,
  note?: string,
  inputs?: string[],
): MetricCell {
  if (value != null && !Number.isFinite(value)) {
    return { value: null, status: "invalid", note: note ?? "Non-finite result", inputs };
  }
  return { value, status, note, inputs };
}

function round(n: number | null, d = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** FCFF = EBIT × (1 − t) + D&A − CAPEX − ΔNWC */
export function calcFCFF(input: {
  ebit: number | null;
  taxRate: number | null;
  da: number | null;
  capex: number | null;
  deltaNwc: number | null;
}): MetricCell {
  const { ebit, taxRate, da, capex, deltaNwc } = input;
  if (!finite(ebit)) {
    return cell(null, "incomplete", "Thiếu EBIT để tính FCFF", ["ebit"]);
  }
  const t = finite(taxRate) && taxRate >= 0 && taxRate < 1 ? taxRate : null;
  const missing: string[] = [];
  if (t == null) missing.push("taxRate");
  if (!finite(da)) missing.push("da");
  if (!finite(capex)) missing.push("capex");
  if (!finite(deltaNwc)) missing.push("deltaNwc");

  const tax = t ?? 0.2;
  const nopat = ebit * (1 - tax);
  const fcff = nopat + (da ?? 0) - (capex ?? 0) - (deltaNwc ?? 0);
  const status: MetricStatus = missing.length ? "incomplete" : "ok";
  const note =
    missing.length > 0
      ? `FCFF ước lượng — thiếu: ${missing.join(", ")}${t == null ? " (tax 20% mặc định VN)" : ""}`
      : undefined;
  return cell(round(fcff, 0), status, note, ["ebit", "taxRate", "da", "capex", "deltaNwc"]);
}

/** FCFE = Net Income + D&A − CAPEX − ΔNWC + Net Borrowing */
export function calcFCFE(input: {
  netIncome: number | null;
  da: number | null;
  capex: number | null;
  deltaNwc: number | null;
  netBorrowing: number | null;
}): MetricCell {
  const { netIncome, da, capex, deltaNwc, netBorrowing } = input;
  if (!finite(netIncome)) {
    return cell(null, "incomplete", "Thiếu Net Income để tính FCFE", ["netIncome"]);
  }
  const missing: string[] = [];
  if (!finite(da)) missing.push("da");
  if (!finite(capex)) missing.push("capex");
  if (!finite(deltaNwc)) missing.push("deltaNwc");
  if (!finite(netBorrowing)) missing.push("netBorrowing");

  const fcfe =
    netIncome + (da ?? 0) - (capex ?? 0) - (deltaNwc ?? 0) + (netBorrowing ?? 0);
  const status: MetricStatus = missing.length ? "incomplete" : "ok";
  const note =
    missing.length > 0 ? `FCFE ước lượng — thiếu: ${missing.join(", ")}` : undefined;
  return cell(round(fcfe, 0), status, note, [
    "netIncome",
    "da",
    "capex",
    "deltaNwc",
    "netBorrowing",
  ]);
}

/** FCF = OCF − |CAPEX| (explicit equity proxy definition) */
export function calcFcfFromOcf(ocf: number | null, capex: number | null): MetricCell {
  if (!finite(ocf)) {
    return cell(null, "incomplete", "Thiếu Operating Cash Flow", ["ocf"]);
  }
  if (!finite(capex)) {
    return cell(round(ocf, 0), "incomplete", "Thiếu CAPEX — FCF = OCF (CAPEX coi = 0)", [
      "ocf",
      "capex",
    ]);
  }
  return cell(round(ocf - Math.abs(capex), 0), "ok", "FCF = OCF − |CAPEX|", ["ocf", "capex"]);
}

export function calcPFCF(marketCap: number | null, fcf: number | null): MetricCell {
  if (!finite(marketCap) || marketCap <= 0) {
    return cell(null, "incomplete", "Thiếu Market Cap để tính P/FCF", ["marketCap"]);
  }
  if (!finite(fcf)) {
    return cell(null, "incomplete", "Thiếu FCF để tính P/FCF", ["fcf"]);
  }
  if (fcf <= 0) {
    return cell(null, "not_applicable", "FCF ≤ 0 — không tính P/FCF", ["fcf"]);
  }
  return cell(round(marketCap / fcf, 2), "ok", undefined, ["marketCap", "fcf"]);
}

export function calcPCF(marketCap: number | null, ocf: number | null): MetricCell {
  if (!finite(marketCap) || marketCap <= 0) {
    return cell(null, "incomplete", "Thiếu Market Cap để tính P/CF", ["marketCap"]);
  }
  if (!finite(ocf)) {
    return cell(null, "incomplete", "Thiếu OCF để tính P/CF", ["ocf"]);
  }
  if (ocf <= 0) {
    return cell(null, "not_applicable", "OCF ≤ 0 — không tính P/CF", ["ocf"]);
  }
  return cell(round(marketCap / ocf, 2), "ok", undefined, ["marketCap", "ocf"]);
}

export function calcFcfYield(fcf: number | null, marketCap: number | null): MetricCell {
  if (!finite(fcf) || !finite(marketCap) || marketCap <= 0) {
    return cell(null, "incomplete", "Thiếu FCF hoặc Market Cap", ["fcf", "marketCap"]);
  }
  return cell(round(fcf / marketCap, 6), "ok", undefined, ["fcf", "marketCap"]);
}

export function calcEvFcff(ev: number | null, fcff: number | null): MetricCell {
  if (!finite(ev)) {
    return cell(null, "incomplete", "Thiếu EV để tính EV/FCFF", ["enterpriseValue"]);
  }
  if (!finite(fcff)) {
    return cell(null, "incomplete", "Thiếu FCFF", ["fcff"]);
  }
  if (fcff <= 0) {
    return cell(null, "not_applicable", "FCFF ≤ 0 — không tính EV/FCFF", ["fcff"]);
  }
  return cell(round(ev / fcff, 2), "ok", undefined, ["enterpriseValue", "fcff"]);
}

export interface HistoricalPoint {
  period: string;
  year: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda: number | null;
  price: number | null;
}

export interface HistoricalSummary {
  points: HistoricalPoint[];
  pe: { avg3y: number | null; median3y: number | null; avg5y: number | null; median5y: number | null };
  pb: { avg3y: number | null; median3y: number | null; avg5y: number | null; median5y: number | null };
  evEbitda: {
    avg3y: number | null;
    median3y: number | null;
    avg5y: number | null;
    median5y: number | null;
  };
  premiumDiscount: {
    peVsMedian3y: number | null;
    pbVsMedian3y: number | null;
    evEbitdaVsMedian3y: number | null;
  };
  notes: string[];
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function windowStats(points: HistoricalPoint[], key: "pe" | "pb" | "evEbitda", years: number) {
  const nowY = new Date().getFullYear();
  const vals = points
    .filter((p) => p.year != null && p.year >= nowY - years && finite(p[key]))
    .map((p) => p[key] as number)
    .filter((v) => v > 0);
  return { avg: round(avg(vals), 2), median: round(median(vals), 2) };
}

export function buildHistoricalMultiples(input: {
  rows: {
    period: string;
    year: number | null;
    eps: number | null;
    bvps: number | null;
    equity: number | null;
    shares: number | null;
    revenue: number | null;
    ebitda: number | null;
    netIncome: number | null;
    totalDebt: number | null;
    cash: number | null;
    price: number | null;
  }[];
  current?: { pe: number | null; pb: number | null; evEbitda: number | null };
}): HistoricalSummary {
  const notes: string[] = [];
  const points: HistoricalPoint[] = [];
  let missingPrice = 0;

  for (const r of input.rows) {
    const price = finite(r.price) && r.price! > 0 ? r.price! : null;
    if (!price) missingPrice++;

    let pe: number | null = null;
    if (price && finite(r.eps) && r.eps! > 0) pe = round(price / r.eps!, 2);
    else if (price && finite(r.netIncome) && r.netIncome! > 0 && finite(r.shares) && r.shares! > 0) {
      pe = round(price / (r.netIncome! / r.shares!), 2);
    }

    let pb: number | null = null;
    if (price && finite(r.bvps) && r.bvps! > 0) pb = round(price / r.bvps!, 3);
    else if (price && finite(r.equity) && r.equity! > 0 && finite(r.shares) && r.shares! > 0) {
      pb = round(price / (r.equity! / r.shares!), 3);
    }

    let ps: number | null = null;
    if (price && finite(r.revenue) && r.revenue! > 0 && finite(r.shares) && r.shares! > 0) {
      ps = round((price * r.shares!) / r.revenue!, 3);
    }

    let evEbitda: number | null = null;
    if (price && finite(r.shares) && r.shares! > 0 && finite(r.ebitda) && r.ebitda! > 0) {
      const mc = price * r.shares!;
      const debt = r.totalDebt ?? 0;
      const cash = r.cash ?? 0;
      const ev = mc + debt - cash;
      evEbitda = round(ev / r.ebitda!, 2);
    }

    points.push({ period: r.period, year: r.year, pe, pb, ps, evEbitda, price });
  }

  if (missingPrice > 0) {
    notes.push(
      `${missingPrice}/${input.rows.length} kỳ thiếu giá cuối kỳ — multiple lịch sử tương ứng = null (không suy diễn).`,
    );
  }
  if (!points.length) notes.push("Không đủ chuỗi kỳ để tính historical multiples.");

  const pe3 = windowStats(points, "pe", 3);
  const pe5 = windowStats(points, "pe", 5);
  const pb3 = windowStats(points, "pb", 3);
  const pb5 = windowStats(points, "pb", 5);
  const ev3 = windowStats(points, "evEbitda", 3);
  const ev5 = windowStats(points, "evEbitda", 5);

  const ratio = (cur: number | null, med: number | null) =>
    cur != null && med != null && med > 0 ? round(cur / med, 3) : null;

  return {
    points,
    pe: { avg3y: pe3.avg, median3y: pe3.median, avg5y: pe5.avg, median5y: pe5.median },
    pb: { avg3y: pb3.avg, median3y: pb3.median, avg5y: pb5.avg, median5y: pb5.median },
    evEbitda: { avg3y: ev3.avg, median3y: ev3.median, avg5y: ev5.avg, median5y: ev5.median },
    premiumDiscount: {
      peVsMedian3y: ratio(input.current?.pe ?? null, pe3.median),
      pbVsMedian3y: ratio(input.current?.pb ?? null, pb3.median),
      evEbitdaVsMedian3y: ratio(input.current?.evEbitda ?? null, ev3.median),
    },
    notes,
  };
}

export interface PeerMetricRow {
  symbol: string;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda: number | null;
  pfcf: number | null;
  dividendYield: number | null;
  marketCap: number | null;
}

export interface PeerComparisonResult {
  symbol: string;
  sector: string | null;
  subject: PeerMetricRow;
  peers: PeerMetricRow[];
  industry: {
    peMedian: number | null;
    peAvg: number | null;
    pbMedian: number | null;
    pbAvg: number | null;
    psMedian: number | null;
    evEbitdaMedian: number | null;
    pfcfMedian: number | null;
    sampleSize: number;
  };
  relative: {
    peVsMedian: number | null;
    pbVsMedian: number | null;
    evEbitdaVsMedian: number | null;
    pfcfVsMedian: number | null;
  };
  notes: string[];
}

function medianOrNull(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => finite(x) && x > 0);
  return round(median(v), 3);
}

function avgOrNull(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => finite(x) && x > 0);
  return round(avg(v), 3);
}

export function buildPeerComparison(input: {
  symbol: string;
  sector: string | null;
  subject: PeerMetricRow;
  peers: PeerMetricRow[];
}): PeerComparisonResult {
  const notes: string[] = [];
  const peers = input.peers.filter((p) => p.symbol.toUpperCase() !== input.symbol.toUpperCase());
  if (!peers.length) {
    notes.push("Không có peer cùng ngành với đủ dữ liệu để so sánh.");
  }

  const peMedian = medianOrNull(peers.map((p) => p.pe));
  const pbMedian = medianOrNull(peers.map((p) => p.pb));
  const psMedian = medianOrNull(peers.map((p) => p.ps));
  const evMed = medianOrNull(peers.map((p) => p.evEbitda));
  const pfcfMed = medianOrNull(peers.map((p) => p.pfcf));

  const rel = (sub: number | null, med: number | null) =>
    sub != null && med != null && med > 0 ? round(sub / med, 3) : null;

  return {
    symbol: input.symbol.toUpperCase(),
    sector: input.sector,
    subject: input.subject,
    peers,
    industry: {
      peMedian,
      peAvg: avgOrNull(peers.map((p) => p.pe)),
      pbMedian,
      pbAvg: avgOrNull(peers.map((p) => p.pb)),
      psMedian,
      evEbitdaMedian: evMed,
      pfcfMedian: pfcfMed,
      sampleSize: peers.filter((p) => p.pe != null || p.pb != null || p.evEbitda != null).length,
    },
    relative: {
      peVsMedian: rel(input.subject.pe, peMedian),
      pbVsMedian: rel(input.subject.pb, pbMedian),
      evEbitdaVsMedian: rel(input.subject.evEbitda, evMed),
      pfcfVsMedian: rel(input.subject.pfcf, pfcfMed),
    },
    notes,
  };
}

export interface Phase2CashFlowBlock {
  fcf: MetricCell;
  fcfDefinition: string;
  fcff: MetricCell;
  fcfe: MetricCell;
  pfcf: MetricCell;
  pcf: MetricCell;
  fcfYield: MetricCell;
  evFcff: MetricCell;
}

export interface Phase2ValuationResult {
  cashFlow: Phase2CashFlowBlock;
  historical: HistoricalSummary | null;
  peers: PeerComparisonResult | null;
  notes: string[];
  valuationEngineVersion: string;
}

export function buildPhase2Valuation(input: {
  marketCap: number | null;
  enterpriseValue: number | null;
  ocfTtm: number | null;
  capexTtm: number | null;
  fcfTtm?: number | null;
  ebitTtm?: number | null;
  taxRate?: number | null;
  daTtm?: number | null;
  deltaNwc?: number | null;
  netIncomeTtm?: number | null;
  netBorrowing?: number | null;
  historicalRows?: Parameters<typeof buildHistoricalMultiples>[0]["rows"];
  currentMultiples?: { pe: number | null; pb: number | null; evEbitda: number | null };
  peerComparison?: {
    symbol: string;
    sector: string | null;
    subject: PeerMetricRow;
    peers: PeerMetricRow[];
  };
}): Phase2ValuationResult {
  const notes: string[] = [];

  const fcfFromOcf = calcFcfFromOcf(input.ocfTtm, input.capexTtm);
  const fcf: MetricCell =
    finite(input.fcfTtm)
      ? cell(round(input.fcfTtm, 0), "ok", "FCF từ anchors (OCF − CAPEX)", ["fcfTtm"])
      : fcfFromOcf;

  const fcff = calcFCFF({
    ebit: input.ebitTtm ?? null,
    taxRate: input.taxRate ?? null,
    da: input.daTtm ?? null,
    capex: input.capexTtm ?? null,
    deltaNwc: input.deltaNwc ?? null,
  });
  const fcfe = calcFCFE({
    netIncome: input.netIncomeTtm ?? null,
    da: input.daTtm ?? null,
    capex: input.capexTtm ?? null,
    deltaNwc: input.deltaNwc ?? null,
    netBorrowing: input.netBorrowing ?? null,
  });

  const fcfForMultiple =
    fcfe.status === "ok" && finite(fcfe.value) ? fcfe.value : fcf.value;
  const pfcf = calcPFCF(input.marketCap, fcfForMultiple);
  const pcf = calcPCF(input.marketCap, input.ocfTtm);
  const fcfYield = calcFcfYield(fcfForMultiple, input.marketCap);
  const evFcff = calcEvFcff(input.enterpriseValue, fcff.value);

  for (const m of [fcf, fcff, fcfe, pfcf, pcf]) {
    if (m.note && (m.status === "incomplete" || m.status === "not_applicable")) {
      notes.push(m.note);
    }
  }

  const historical =
    input.historicalRows && input.historicalRows.length
      ? buildHistoricalMultiples({
          rows: input.historicalRows,
          current: input.currentMultiples,
        })
      : null;
  if (historical) notes.push(...historical.notes);

  const peers = input.peerComparison
    ? buildPeerComparison(input.peerComparison)
    : null;
  if (peers) notes.push(...peers.notes);

  return {
    cashFlow: {
      fcf,
      fcfDefinition:
        "FCF = OCF − |CAPEX| (equity proxy); FCFF/FCFE dùng công thức chuẩn khi đủ input",
      fcff,
      fcfe,
      pfcf,
      pcf,
      fcfYield,
      evFcff,
    },
    historical,
    peers,
    notes,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE2,
  };
}

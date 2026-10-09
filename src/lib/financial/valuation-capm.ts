/**
 * CAPM / cost-of-capital inputs for VN equity valuation.
 *
 * Sources (cascade):
 *  - Risk-free: VietnamBiz currency-interest-rate (proxy T-bill / deposit) → documented default
 *  - Beta: OLS vs VNINDEX from resilient OHLCV (alpha-beta engine) → default 1.0
 *  - ERP / CRP: Damodaran-style emerging + Vietnam country risk (documented constants)
 *
 * Hard rule: every number is tagged with source; never silently invent without notes.
 */
import "server-only";
import { cached } from "../cache";
import { computeAlphaBeta } from "../engines/alpha-beta";
import { getEconomicData } from "../services/economy";
import { fetchOhlcvResilient } from "../services/screener-ohlcv";

/** Damodaran-style mature-market ERP + emerging premium band (documented, not live). */
export const DEFAULT_EQUITY_RISK_PREMIUM = 0.075;
/** Vietnam country risk premium overlay (basis-point style ratio). */
export const DEFAULT_COUNTRY_RISK_PREMIUM = 0.015;
/** Fallback VN 10Y-ish risk-free when macro feed is empty. */
export const DEFAULT_RISK_FREE_RATE = 0.055;
export const DEFAULT_BETA = 1.0;

export interface CapmInputs {
  riskFreeRate: number;
  beta: number;
  equityRiskPremium: number;
  countryRiskPremium: number;
  /** Ke = Rf + beta * ERP + CRP */
  costOfEquity: number;
  sources: {
    riskFree: string;
    beta: string;
    equityRiskPremium: string;
    countryRiskPremium: string;
  };
  notes: string[];
  /** Raw beta snapshot diagnostics when computed. */
  betaMeta: {
    raw: number | null;
    adjusted: number | null;
    r2: number | null;
    n: number | null;
    reliable: boolean;
  } | null;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampRate(v: number, min: number, max: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

/**
 * Parse VietnamBiz interest-rate rows for a government / policy rate proxy.
 * Prefers labels containing trái phiếu / tín phiếu / OMO / huy động 12T.
 */
export function extractRiskFreeFromEconomyRows(
  rows: { name?: string | null; value?: number | null; unit?: string | null }[],
): { rate: number; label: string } | null {
  if (!rows?.length) return null;
  const scored: { rate: number; label: string; score: number }[] = [];
  for (const row of rows) {
    const name = String(row.name ?? "").toLowerCase();
    const raw = row.value;
    if (!finite(raw)) continue;
    // Values may be percent (5.5) or ratio (0.055)
    let rate = raw > 1 ? raw / 100 : raw;
    rate = clampRate(rate, 0.01, 0.2) ?? 0;
    if (rate <= 0) continue;
    let score = 0;
    if (/tr[aá]i phi[eế]u ch[ií]nh ph[uủ]|government bond|t[ií]n phi[eế]u/i.test(name)) score += 50;
    if (/omo|ng[aâ]n h[aà]ng nh[aà] n[uư][oớ]c|policy|refinanc/i.test(name)) score += 40;
    if (/huy [dđ][oộ]ng.*12|12 th[aá]ng|term deposit.*12/i.test(name)) score += 30;
    if (/l[aã]i su[aấ]t|interest|deposit|huy [dđ][oộ]ng/i.test(name)) score += 10;
    if (score > 0) scored.push({ rate, label: String(row.name ?? "rate"), score });
  }
  scored.sort((a, b) => b.score - a.score || Math.abs(a.rate - 0.05) - Math.abs(b.rate - 0.05));
  const best = scored[0];
  return best ? { rate: best.rate, label: best.label } : null;
}

async function resolveRiskFreeRate(): Promise<{ rate: number; source: string; note?: string }> {
  try {
    const pack = await Promise.race([
      getEconomicData("currency-interest-rate"),
      new Promise<null>((r) => setTimeout(() => r(null), 4_000)),
    ]);
    const rows = pack?.data?.rows ?? [];
    const hit = extractRiskFreeFromEconomyRows(
      rows.map((r) => ({
        name: r.name,
        value: r.current?.value ?? null,
        unit: r.current?.isPercent ? "%" : null,
      })),
    );
    if (hit) {
      return {
        rate: hit.rate,
        source: `vietnambiz:${hit.label}`,
        note: `Rf proxy từ VietnamBiz «${hit.label}» = ${(hit.rate * 100).toFixed(2)}%.`,
      };
    }
  } catch {
    /* non-fatal */
  }
  return {
    rate: DEFAULT_RISK_FREE_RATE,
    source: "default-vn-gov-bond-proxy",
    note: `Rf mặc định ${DEFAULT_RISK_FREE_RATE * 100}% (proxy trái phiếu CP VN) — không lấy được lãi suất live.`,
  };
}

async function resolveBeta(
  symbol: string,
): Promise<{
  beta: number;
  source: string;
  meta: CapmInputs["betaMeta"];
  note?: string;
}> {
  const sym = symbol.toUpperCase();
  try {
    const result = await cached(`capm:beta:${sym}:v1`, {
      ttlMs: 6 * 3_600_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const [stock, mkt] = await Promise.all([
          fetchOhlcvResilient(sym, 280),
          fetchOhlcvResilient("VNINDEX", 280),
        ]);
        if (stock.bars.length < 60 || mkt.bars.length < 60) {
          throw new Error("insufficient ohlcv for beta");
        }
        const ab = computeAlphaBeta(stock.bars, mkt.bars, { benchmark: "VNINDEX" });
        if (!ab || ab.beta == null || !Number.isFinite(ab.beta)) {
          throw new Error("beta compute failed");
        }
        return ab;
      },
    });
    const ab = result.value;
    // Blume-style adjusted beta toward 1.0 when available
    const raw = ab.beta;
    const adjusted =
      ab.betaAdj != null && Number.isFinite(ab.betaAdj)
        ? ab.betaAdj
        : 0.33 + 0.67 * raw;
    const use = clampRate(adjusted, 0.2, 2.5) ?? clampRate(raw, 0.2, 2.5) ?? DEFAULT_BETA;
    const reliable = Boolean(ab.quality?.reliable);
    return {
      beta: use,
      source: reliable ? "ohlcv-vnindex-ols-adj" : "ohlcv-vnindex-ols",
      meta: {
        raw,
        adjusted: ab.betaAdj ?? adjusted,
        r2: ab.r2,
        n: ab.n,
        reliable,
      },
      note: `Beta ${use.toFixed(2)} (OLS vs VNINDEX, n=${ab.n}, R²=${ab.r2 != null ? (ab.r2 * 100).toFixed(0) + "%" : "n/a"}${reliable ? ", reliable" : ""}).`,
    };
  } catch {
    return {
      beta: DEFAULT_BETA,
      source: "default-market",
      meta: null,
      note: `Beta mặc định ${DEFAULT_BETA} — chưa tính được từ OHLCV/VNINDEX.`,
    };
  }
}

/**
 * Resolve full CAPM stack for a VN ticker. Soft-timeouts keep valuation latency bounded.
 */
export async function resolveCapmInputs(
  symbol: string,
  opts?: { skipBeta?: boolean },
): Promise<CapmInputs> {
  const notes: string[] = [];
  const [rfPack, betaPack] = await Promise.all([
    resolveRiskFreeRate(),
    opts?.skipBeta
      ? Promise.resolve({
          beta: DEFAULT_BETA,
          source: "skipped",
          meta: null as CapmInputs["betaMeta"],
          note: "Beta bỏ qua (skipBeta).",
        })
      : Promise.race([
          resolveBeta(symbol),
          new Promise<{
            beta: number;
            source: string;
            meta: CapmInputs["betaMeta"];
            note?: string;
          }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  beta: DEFAULT_BETA,
                  source: "default-timeout",
                  meta: null,
                  note: `Beta timeout — dùng mặc định ${DEFAULT_BETA}.`,
                }),
              5_500,
            ),
          ),
        ]),
  ]);

  if (rfPack.note) notes.push(rfPack.note);
  if (betaPack.note) notes.push(betaPack.note);

  const erp = DEFAULT_EQUITY_RISK_PREMIUM;
  const crp = DEFAULT_COUNTRY_RISK_PREMIUM;
  notes.push(
    `ERP ${erp * 100}% (emerging-market documented) + CRP VN ${crp * 100}% — không phải live Damodaran scrape.`,
  );

  const ke = rfPack.rate + betaPack.beta * erp + crp;
  const costOfEquity = clampRate(ke, 0.04, 0.35) ?? 0.12;

  return {
    riskFreeRate: rfPack.rate,
    beta: betaPack.beta,
    equityRiskPremium: erp,
    countryRiskPremium: crp,
    costOfEquity,
    sources: {
      riskFree: rfPack.source,
      beta: betaPack.source,
      equityRiskPremium: "documented-emerging-erp",
      countryRiskPremium: "documented-vn-crp",
    },
    notes,
    betaMeta: betaPack.meta,
  };
}

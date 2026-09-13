"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import {
  Panel,
  Badge,
  Chg,
  Loading,
  ErrorNote,
  Unavailable,
  FreshnessDot,
  fmtNum,
  fmtCompact,
} from "@/components/ui";
import { Calculator, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types (mirror API Phase 1–6 response)                                       */
/* -------------------------------------------------------------------------- */

type ValuationApi = {
  symbol: string;
  currentPrice: number;
  marketCap: number | null;
  enterpriseValue: number | null;
  multiples: {
    pe: number | null;
    pb: number | null;
    ps: number | null;
    pfcf: number | null;
    pcf: number | null;
    evEbitda: number | null;
    fcfYield: number | null;
    earningsYield: number | null;
    dividendYield: number | null;
  };
  fairValues: {
    blended: number | null;
    low: number | null;
    base: number | null;
    high: number | null;
    bandWidthPct: number | null;
    dcfBase: number | null;
    dcfBear: number | null;
    dcfBull: number | null;
    peBased: number | null;
    pbBased: number | null;
    evEbitdaBased: number | null;
    pfcfBased: number | null;
    residualIncome: number | null;
    ddm: number | null;
    nav: number | null;
    sotp: number | null;
    industryWeightsApplied?: Record<string, number> | null;
    dcf?: {
      label: string;
      intrinsicPerShare: number;
      growthY1to5: number;
      terminalGrowth: number;
      discountRate: number;
      marginOfSafetyPct: number;
    }[] | null;
  };
  sensitivity?: {
    waccAxis: number[];
    growthAxis: number[];
    cells: { fairPrice: number | null; valid: boolean }[][];
    baseWacc: number;
    baseGrowth: number;
  } | null;
  valuationScore: number | null;
  valuationGrade: string | null;
  valuationScoreBreakdown?: {
    upsideScore: number;
    agreementScore: number;
    dataQualityScore: number;
    coverageScore: number;
    drivers: string[];
  } | null;
  valuationStatus: string | null;
  upsideDownside: number | null;
  confidence: string | null;
  valuationConfidence?: string | null;
  confidenceBands?: {
    low: number | null;
    base: number | null;
    high: number | null;
    bandWidthPct: number | null;
  } | null;
  dataQuality: number | null;
  industryProfile: string | null;
  notes: string[];
  valuationEngineVersion: string;
};

type AnalystApi = {
  narrative: string;
  usedLlm: boolean;
  model: string | null;
  headline: {
    price: number;
    fairValue: number | null;
    upsidePct: number | null;
    status: string | null;
    score: number | null;
    grade: string | null;
    gaps: string[];
  };
  valuationEngineVersion: string;
};

function statusTone(s: string | null | undefined): "up" | "down" | "warn" | "neutral" | "accent" {
  if (!s) return "neutral";
  if (s.includes("undervalued")) return "up";
  if (s.includes("overvalued")) return "down";
  if (s === "fairly_valued") return "accent";
  if (s === "insufficient_data") return "warn";
  return "neutral";
}

function statusLabel(s: string | null | undefined): string {
  const map: Record<string, string> = {
    deep_undervalued: "Rẻ rõ rệt",
    undervalued: "Đang rẻ",
    fairly_valued: "Hợp lý",
    overvalued: "Đang đắt",
    deep_overvalued: "Đắt rõ rệt",
    insufficient_data: "Thiếu dữ liệu",
  };
  return s ? map[s] ?? s : "—";
}

function gradeTone(g: string | null | undefined): "up" | "down" | "warn" | "neutral" | "accent" {
  if (g === "A" || g === "B") return "up";
  if (g === "C") return "accent";
  if (g === "D") return "warn";
  if (g === "F") return "down";
  return "neutral";
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
}

function MethodRow({
  label,
  value,
  weight,
}: {
  label: string;
  value: number | null;
  weight?: number | null;
}) {
  if (value == null) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-line/40 py-1.5 text-[12px] last:border-0">
        <span className="text-ink-3">{label}</span>
        <span className="text-ink-3">n/a</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/40 py-1.5 text-[12px] last:border-0">
      <span className="text-ink-2">
        {label}
        {weight != null && weight > 0 ? (
          <span className="ml-1.5 text-[10px] text-ink-3">({(weight * 100).toFixed(0)}%)</span>
        ) : null}
      </span>
      <span className="num font-medium text-ink">{fmtPrice(value)}</span>
    </div>
  );
}

function FairValueBar({
  price,
  low,
  base,
  high,
}: {
  price: number | null;
  low: number | null;
  base: number | null;
  high: number | null;
}) {
  if (base == null && low == null && high == null) {
    return <p className="text-[11px] text-ink-3">Chưa đủ dữ liệu dải fair value.</p>;
  }
  const vals = [price, low, base, high].filter((v): v is number => v != null && v > 0);
  if (!vals.length) return null;
  const min = Math.min(...vals) * 0.92;
  const max = Math.max(...vals) * 1.08;
  const span = max - min || 1;
  const pct = (v: number | null) => (v == null ? null : ((v - min) / span) * 100);
  const pPct = pct(price);
  const lPct = pct(low);
  const bPct = pct(base);
  const hPct = pct(high);

  return (
    <div className="space-y-2">
      <div className="relative h-3 rounded-full bg-bg-3">
        {lPct != null && hPct != null && (
          <div
            className="absolute top-0 h-full rounded-full bg-accent/25"
            style={{ left: `${Math.min(lPct, hPct)}%`, width: `${Math.abs(hPct - lPct)}%` }}
          />
        )}
        {bPct != null && (
          <div
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-bg-2"
            style={{ left: `${bPct}%` }}
            title={`FV base ${fmtPrice(base)}`}
          />
        )}
        {pPct != null && (
          <div
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `${pPct}%` }}
            title={`Giá ${fmtPrice(price)}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-ink-3">
        <span>Low {fmtPrice(low)}</span>
        <span>Base {fmtPrice(base)}</span>
        <span>High {fmtPrice(high)}</span>
      </div>
    </div>
  );
}

function ScoreRing({ score, grade }: { score: number | null; grade: string | null }) {
  const s = score ?? 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, s)) / 100) * c;
  return (
    <div className="relative flex size-[100px] items-center justify-center">
      <svg width="100" height="100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line/40" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={s >= 65 ? "text-up" : s >= 50 ? "text-accent" : s >= 35 ? "text-warn" : "text-down"}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[20px] font-semibold text-ink">{score != null ? score : "—"}</span>
        <span className="text-[10px] text-ink-3">/{grade ? ` ${grade}` : " 100"}</span>
      </div>
    </div>
  );
}

export function ValuationPanel({
  symbol,
  compact = false,
  showAnalyst = true,
}: {
  symbol: string;
  compact?: boolean;
  showAnalyst?: boolean;
}) {
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [wantLlm, setWantLlm] = useState(false);

  const path = symbol ? `/api/v1/stocks/${symbol}/valuation?peers=1` : null;
  const { res, data, meta, isLoading, error } = useApi<ValuationApi>(path, {
    refreshInterval: 120_000,
  });

  const analystPath =
    showAnalyst && symbol
      ? `/api/v1/stocks/${symbol}/valuation/analyst?peers=0${wantLlm ? "&llm=1" : ""}`
      : null;
  const { data: analyst, isLoading: analystLoading } = useApi<AnalystApi>(analystPath, {
    refreshInterval: 0,
  });

  const multiples = useMemo(() => {
    if (!data?.multiples) return [];
    const m = data.multiples;
    return [
      { k: "P/E", v: m.pe },
      { k: "P/B", v: m.pb },
      { k: "P/S", v: m.ps },
      { k: "P/FCF", v: m.pfcf },
      { k: "EV/EBITDA", v: m.evEbitda },
      { k: "FCF yield", v: m.fcfYield, suffix: "%" },
      { k: "Earn. yield", v: m.earningsYield, suffix: "%" },
      { k: "Div. yield", v: m.dividendYield, suffix: "%" },
    ];
  }, [data]);

  if (!symbol || (isLoading && !res)) {
    return (
      <Panel title="Định giá doanh nghiệp">
        <Loading rows={4} />
      </Panel>
    );
  }

  if (error && !data) {
    return (
      <Panel title="Định giá doanh nghiệp">
        <ErrorNote message={error} />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Định giá doanh nghiệp">
        <Unavailable title="Chưa có kết quả định giá" note="Engine chưa trả về dữ liệu." meta={meta} />
      </Panel>
    );
  }

  const fv = data.fairValues;
  const weights = fv.industryWeightsApplied ?? {};

  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Calculator className="size-4 text-accent" />
            Định giá doanh nghiệp
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
            <span className="text-[10px] font-normal text-ink-3">{data.valuationEngineVersion}</span>
          </span>
        }
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={statusTone(data.valuationStatus)}>{statusLabel(data.valuationStatus)}</Badge>
            {data.valuationGrade && (
              <Badge tone={gradeTone(data.valuationGrade)}>Grade {data.valuationGrade}</Badge>
            )}
            {data.confidence && (
              <Badge tone="neutral">{String(data.confidence).toUpperCase()}</Badge>
            )}
          </span>
        }
      >
        <div className={`grid gap-4 ${compact ? "md:grid-cols-2" : "md:grid-cols-[auto_1fr_1fr]"}`}>
          <div className="flex flex-col items-center justify-center">
            <ScoreRing score={data.valuationScore} grade={data.valuationGrade} />
            <div className="mt-1 text-center text-[10px] text-ink-3">Valuation Score</div>
            {data.industryProfile && (
              <div className="mt-0.5 text-[10px] text-ink-3">Ngành: {data.industryProfile}</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-3">Giá vs Fair value</div>
            <div className="flex flex-wrap items-baseline gap-3">
              <div>
                <div className="text-[10px] text-ink-3">Giá hiện tại</div>
                <div className="num text-[22px] font-semibold text-ink">{fmtPrice(data.currentPrice)}</div>
              </div>
              <div className="text-ink-3">→</div>
              <div>
                <div className="text-[10px] text-ink-3">FV blended</div>
                <div className="num text-[22px] font-semibold text-accent">{fmtPrice(fv.blended)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">Upside</span>
              <Chg value={data.upsideDownside} className="text-[14px] font-semibold" />
            </div>
            {(data.marketCap != null || data.enterpriseValue != null) && (
              <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
                {data.marketCap != null && <span>MC {fmtCompact(data.marketCap)}</span>}
                {data.enterpriseValue != null && <span>EV {fmtCompact(data.enterpriseValue)}</span>}
                {data.dataQuality != null && <span>DQ {data.dataQuality}/100</span>}
              </div>
            )}
          </div>

          {!compact && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-ink-3">Dải tin cậy</div>
              <FairValueBar
                price={data.currentPrice}
                low={fv.low ?? data.confidenceBands?.low ?? null}
                base={fv.base ?? data.confidenceBands?.base ?? fv.blended}
                high={fv.high ?? data.confidenceBands?.high ?? null}
              />
              {fv.bandWidthPct != null && (
                <div className="text-[10px] text-ink-3">Độ rộng band ~{fv.bandWidthPct}%</div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">Multiples quan sát</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {multiples.map((m) => (
              <div key={m.k} className="rounded-lg border border-line/50 bg-bg-2/40 px-2.5 py-2">
                <div className="text-[10px] text-ink-3">{m.k}</div>
                <div className="num mt-0.5 text-[15px] font-semibold text-ink">
                  {m.v != null ? `${fmtNum(m.v, 1)}${m.suffix ?? ""}` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!compact && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-line/50 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">
                Fair price theo phương pháp
              </div>
              <MethodRow label="DCF Base" value={fv.dcfBase} weight={weights.dcf} />
              <MethodRow label="DCF Bear" value={fv.dcfBear} />
              <MethodRow label="DCF Bull" value={fv.dcfBull} />
              <MethodRow label="P/E based" value={fv.peBased} weight={weights.pe} />
              <MethodRow label="P/B based" value={fv.pbBased} weight={weights.pb} />
              <MethodRow label="EV/EBITDA based" value={fv.evEbitdaBased} weight={weights.evEbitda} />
              <MethodRow label="P/FCF based" value={fv.pfcfBased} weight={weights.pfcf} />
              <MethodRow label="Residual Income" value={fv.residualIncome} weight={weights.residualIncome} />
              <MethodRow label="DDM" value={fv.ddm} weight={weights.ddm} />
              <MethodRow label="NAV" value={fv.nav} weight={weights.nav} />
              <MethodRow label="SOTP" value={fv.sotp} weight={weights.sotp} />
            </div>

            <div className="space-y-3">
              {fv.dcf && fv.dcf.length > 0 && (
                <div className="rounded-lg border border-line/50 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">DCF scenarios</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-ink-3">
                        <tr>
                          <th className="py-1 font-medium">Scenario</th>
                          <th className="py-1 font-medium">Fair</th>
                          <th className="py-1 font-medium">g</th>
                          <th className="py-1 font-medium">r</th>
                          <th className="py-1 font-medium">MOS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fv.dcf.map((s) => (
                          <tr key={s.label} className="border-t border-line/30">
                            <td className="py-1.5 font-medium text-ink-2">{s.label}</td>
                            <td className="num py-1.5">{fmtPrice(s.intrinsicPerShare)}</td>
                            <td className="num py-1.5">{(s.growthY1to5 * 100).toFixed(1)}%</td>
                            <td className="num py-1.5">{(s.discountRate * 100).toFixed(1)}%</td>
                            <td className="py-1.5">
                              <Chg value={s.marginOfSafetyPct} className="text-[11px]" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.valuationScoreBreakdown?.drivers &&
                data.valuationScoreBreakdown.drivers.length > 0 && (
                  <div className="rounded-lg border border-line/50 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">
                      Điểm nhấn score
                    </div>
                    <ul className="space-y-1 text-[12px] text-ink-2">
                      {data.valuationScoreBreakdown.drivers.map((d) => (
                        <li key={d} className="flex gap-2">
                          <span className="text-accent">•</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        )}

        {!compact && data.sensitivity && data.sensitivity.cells?.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSensitivity((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              {showSensitivity ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Ma trận nhạy cảm WACC × terminal growth
            </button>
            {showSensitivity && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-line/50 p-2">
                <table className="w-full text-center text-[10px]">
                  <thead>
                    <tr>
                      <th className="p-1 text-ink-3">g \\ WACC</th>
                      {data.sensitivity.waccAxis.map((w) => (
                        <th key={w} className="p-1 font-medium text-ink-3">
                          {(w * 100).toFixed(1)}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.sensitivity.growthAxis.map((g, gi) => (
                      <tr key={g}>
                        <td className="p-1 font-medium text-ink-3">{(g * 100).toFixed(1)}%</td>
                        {data.sensitivity!.cells[gi]?.map((cell, wi) => {
                          const isBase =
                            Math.abs(data.sensitivity!.waccAxis[wi] - data.sensitivity!.baseWacc) < 1e-6 &&
                            Math.abs(g - data.sensitivity!.baseGrowth) < 1e-6;
                          return (
                            <td
                              key={wi}
                              className={`p-1 num ${isBase ? "bg-accent/20 font-semibold text-accent" : ""}`}
                            >
                              {cell.valid && cell.fairPrice != null ? fmtPrice(cell.fairPrice) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {data.notes && data.notes.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-ink"
            >
              {showNotes ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Ghi chú engine ({data.notes.length})
            </button>
            {showNotes && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink-3">
                {data.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      {showAnalyst && (
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              AI Equity Research — Valuation Narrative
              {analyst?.usedLlm ? (
                <Badge tone="accent">LLM</Badge>
              ) : (
                <Badge tone="neutral">Deterministic</Badge>
              )}
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => setWantLlm((v) => !v)}
              className="rounded border border-line px-2 py-0.5 text-[10px] text-ink-2 hover:bg-bg-2"
            >
              {wantLlm ? "Tắt LLM" : "Bật LLM"}
            </button>
          }
        >
          {analystLoading && !analyst ? (
            <Loading rows={3} />
          ) : analyst ? (
            <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
              {analyst.headline && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <Badge tone={statusTone(analyst.headline.status)}>
                    {statusLabel(analyst.headline.status)}
                  </Badge>
                  {analyst.headline.grade && (
                    <Badge tone={gradeTone(analyst.headline.grade)}>Grade {analyst.headline.grade}</Badge>
                  )}
                  {analyst.headline.upsidePct != null && (
                    <span className="text-ink-3">
                      Upside <Chg value={analyst.headline.upsidePct} className="inline text-[12px]" />
                    </span>
                  )}
                </div>
              )}
              {analyst.headline?.gaps && analyst.headline.gaps.length > 0 && (
                <div className="rounded border border-warn/30 bg-warn/5 p-2 text-[11px] text-ink-2">
                  <div className="mb-0.5 font-medium text-warn">Data gaps</div>
                  <ul className="list-inside list-disc">
                    {analyst.headline.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{analyst.narrative}</div>
              {analyst.model && (
                <div className="pt-1 text-[10px] text-ink-3">Model: {analyst.model}</div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-ink-3">
              Narrative deterministic sẽ hiển thị khi API analyst sẵn sàng.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

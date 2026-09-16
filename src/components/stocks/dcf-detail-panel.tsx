"use client";

import { useState } from "react";
import { Panel, Badge, Chg, fmtCompact, fmtNum } from "@/components/ui";
import { LineChart, ChevronDown, ChevronUp } from "lucide-react";

type DcfYear = {
  year: number;
  growth?: number;
  fcf: number;
  discountFactor: number;
  pv: number;
  stage?: string;
};

type DcfScenario = {
  label: string;
  status?: string;
  baseFcf?: number;
  fairPrice?: number | null;
  fairPriceQuote?: number | null;
  upsidePct?: number | null;
  equityValue?: number | null;
  terminalValue?: number | null;
  pvTerminal?: number | null;
  pvExplicit?: number | null;
  terminalShareOfValue?: number | null;
  assumptions?: {
    forecastYears?: number;
    highGrowthYears?: number;
    growthY1toN?: number;
    terminalGrowth?: number;
    discountRate?: number;
    terminalMethod?: string;
    cashFlowType?: string;
  };
  explicitYears?: DcfYear[];
  notes?: string[];
};

type Sensitivity = {
  waccAxis: number[];
  growthAxis: number[];
  cells: {
    fairPriceQuote?: number | null;
    fairPrice?: number | null;
    upsidePct?: number | null;
    valid: boolean;
  }[][];
  baseWacc: number;
  baseGrowth: number;
};

type CostOfCapital = {
  costOfEquity?: { value?: number | null };
  wacc?: { value?: number | null; note?: string };
};

function pct(x: number | null | undefined, d = 1) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(d)}%`;
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmtCompact(n);
}

export function DcfDetailPanel({
  scenarios,
  sensitivity,
  costOfCapital,
  currentPrice,
}: {
  scenarios: DcfScenario[] | null | undefined;
  sensitivity?: Sensitivity | null;
  costOfCapital?: CostOfCapital | null;
  currentPrice?: number | null;
}) {
  const list = Array.isArray(scenarios) ? scenarios : [];
  const [active, setActive] = useState<string>(
    list.find((s) => s.label === "Base")?.label ?? list[0]?.label ?? "Base",
  );
  const [showYears, setShowYears] = useState(true);
  const [showSens, setShowSens] = useState(false);

  if (!list.length) {
    return (
      <Panel title="Mô hình DCF">
        <p className="text-[12px] text-text-muted">
          Chưa đủ FCF dương để chạy DCF. Cần dòng tiền tự do (OCF − CAPEX) hoặc LN ròng ổn định từ BCTC.
        </p>
      </Panel>
    );
  }

  const sc = list.find((s) => s.label === active) ?? list[0];
  const fair = sc.fairPriceQuote ?? (sc.fairPrice != null ? sc.fairPrice / 1000 : null);
  const a = sc.assumptions ?? {};

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <LineChart className="size-4 text-accent-primary" />
          Mô hình DCF chi tiết
          <Badge tone="neutral">2 giai đoạn</Badge>
        </span>
      }
      right={
        <span className="flex flex-wrap gap-1">
          {list.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setActive(s.label)}
              className={`rounded-md border px-2 py-0.5 text-[11px] ${
                s.label === active
                  ? "border-accent-primary/50 bg-accent-primary/15 text-accent-primary"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </span>
      }
    >
      <div className="space-y-3">
        {/* Tóm tắt kịch bản */}
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Giá hợp lý</div>
            <div className="num mt-0.5 text-[20px] font-semibold text-text-primary">
              {fair != null ? fmtNum(fair, fair >= 100 ? 0 : 2) : "—"}
            </div>
            {currentPrice != null && fair != null && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                <span className="text-text-muted">vs {fmtNum(currentPrice, 2)}</span>
                <Chg value={sc.upsidePct ?? null} />
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">WACC / r</div>
            <div className="num mt-0.5 text-[18px] font-semibold">{pct(a.discountRate)}</div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              Ke {pct(costOfCapital?.costOfEquity?.value)} · WACC{" "}
              {pct(costOfCapital?.wacc?.value)}
            </div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Tăng trưởng</div>
            <div className="num mt-0.5 text-[18px] font-semibold">{pct(a.growthY1toN)}</div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              Cao {a.highGrowthYears ?? "—"}n · g∞ {pct(a.terminalGrowth)}
            </div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Cơ cấu PV</div>
            <div className="num mt-0.5 text-[18px] font-semibold">
              {sc.terminalShareOfValue != null
                ? `${(sc.terminalShareOfValue * 100).toFixed(0)}%`
                : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">Tỷ trọng terminal value</div>
          </div>
        </div>

        {/* So sánh 3 kịch bản */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-muted">
                <th className="py-1.5 pr-2 font-medium">Kịch bản</th>
                <th className="py-1.5 pr-2 font-medium">g cao</th>
                <th className="py-1.5 pr-2 font-medium">g∞</th>
                <th className="py-1.5 pr-2 font-medium">r</th>
                <th className="py-1.5 pr-2 font-medium">FV</th>
                <th className="py-1.5 font-medium">Upside</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const f =
                  s.fairPriceQuote ?? (s.fairPrice != null ? s.fairPrice / 1000 : null);
                return (
                  <tr
                    key={s.label}
                    className={`border-b border-border-subtle/60 ${
                      s.label === active ? "bg-accent-primary/5" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-2 font-medium text-text-primary">{s.label}</td>
                    <td className="num py-1.5 pr-2">{pct(s.assumptions?.growthY1toN)}</td>
                    <td className="num py-1.5 pr-2">{pct(s.assumptions?.terminalGrowth)}</td>
                    <td className="num py-1.5 pr-2">{pct(s.assumptions?.discountRate)}</td>
                    <td className="num py-1.5 pr-2 font-semibold">
                      {f != null ? fmtNum(f, f >= 100 ? 0 : 2) : "—"}
                    </td>
                    <td className="py-1.5">
                      <Chg value={s.upsidePct ?? null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bảng năm */}
        <div>
          <button
            type="button"
            onClick={() => setShowYears((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-primary"
          >
            {showYears ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            Dự phóng FCF theo năm ({sc.explicitYears?.length ?? 0} năm)
          </button>
          {showYears && sc.explicitYears && sc.explicitYears.length > 0 && (
            <div className="mt-1.5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-muted">
                    <th className="py-1 pr-2 font-medium">Năm</th>
                    <th className="py-1 pr-2 font-medium">Giai đoạn</th>
                    <th className="py-1 pr-2 font-medium">g</th>
                    <th className="py-1 pr-2 font-medium">FCF</th>
                    <th className="py-1 pr-2 font-medium">DF</th>
                    <th className="py-1 font-medium">PV</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.explicitYears.map((y) => (
                    <tr key={y.year} className="border-b border-border-subtle/50">
                      <td className="num py-1 pr-2">{y.year}</td>
                      <td className="py-1 pr-2 text-text-muted">
                        {y.stage === "high"
                          ? "Tăng trưởng cao"
                          : y.stage === "fade"
                            ? "Fade"
                            : y.stage ?? "—"}
                      </td>
                      <td className="num py-1 pr-2">{pct(y.growth)}</td>
                      <td className="num py-1 pr-2">{money(y.fcf)}</td>
                      <td className="num py-1 pr-2">{y.discountFactor?.toFixed(3)}</td>
                      <td className="num py-1">{money(y.pv)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border-subtle font-medium">
                    <td className="py-1.5 pr-2" colSpan={5}>
                      PV dòng tiền tường minh
                    </td>
                    <td className="num py-1.5">{money(sc.pvExplicit)}</td>
                  </tr>
                  <tr className="font-medium">
                    <td className="py-1 pr-2" colSpan={5}>
                      PV terminal ({a.terminalMethod === "exit_multiple" ? "exit multiple" : "Gordon"})
                    </td>
                    <td className="num py-1">{money(sc.pvTerminal)}</td>
                  </tr>
                  <tr className="font-semibold text-text-primary">
                    <td className="py-1.5 pr-2" colSpan={5}>
                      Tổng giá trị (equity / EV)
                    </td>
                    <td className="num py-1.5">{money(sc.equityValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sensitivity */}
        {sensitivity && sensitivity.cells?.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowSens((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-primary"
            >
              {showSens ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Ma trận độ nhạy (WACC × g∞)
            </button>
            {showSens && (
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full min-w-[400px] text-center text-[11px]">
                  <thead>
                    <tr className="border-b border-border-subtle text-[10px] text-text-muted">
                      <th className="py-1 px-1 font-medium">g∞ \ WACC</th>
                      {sensitivity.waccAxis.map((w) => (
                        <th key={w} className="num py-1 px-1 font-medium">
                          {(w * 100).toFixed(1)}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.growthAxis.map((g, gi) => (
                      <tr key={g} className="border-b border-border-subtle/50">
                        <td className="num py-1 px-1 text-text-muted">{(g * 100).toFixed(1)}%</td>
                        {sensitivity.cells[gi]?.map((c, wi) => {
                          const v = c.fairPriceQuote ?? (c.fairPrice != null ? c.fairPrice / 1000 : null);
                          const isBase =
                            Math.abs(sensitivity.waccAxis[wi] - sensitivity.baseWacc) < 0.001 &&
                            Math.abs(g - sensitivity.baseGrowth) < 0.001;
                          return (
                            <td
                              key={wi}
                              className={`num py-1 px-1 ${
                                !c.valid
                                  ? "text-text-muted/40"
                                  : isBase
                                    ? "rounded bg-accent-primary/20 font-semibold text-accent-primary"
                                    : ""
                              }`}
                            >
                              {c.valid && v != null ? fmtNum(v, v >= 100 ? 0 : 1) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-text-muted">
                  Ô tô đậm = kịch bản cơ sở (WACC {(sensitivity.baseWacc * 100).toFixed(1)}% · g∞{" "}
                  {(sensitivity.baseGrowth * 100).toFixed(1)}%)
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-text-muted">
          DCF 2 giai đoạn: tăng trưởng cao → fade → terminal Gordon. Nghiên cứu nội bộ · không phải khuyến nghị đầu tư.
        </p>
      </div>
    </Panel>
  );
}

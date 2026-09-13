"use client";

import { useCallback, useState } from "react";
import { fmtCompact, Panel } from "@/components/ui";

interface AiAnalysisPayload {
  symbol: string;
  narrative: string;
  structured: {
    healthSummary: string;
    trendSummary: string;
    strengths: string[];
    risks: string[];
    watchpoints: string[];
    outlook: string;
    chartInsights?: string[];
  } | null;
  model: string | null;
  latencyMs: number | null;
  usedLlm: boolean;
  sourceNote: string;
  llmConfigured?: boolean;
}

interface ForecastPayload {
  symbol: string;
  method: string;
  currencyNote: string;
  history: { period: string; netRevenue: number | null; kind: string }[];
  forecast: {
    period: string;
    netRevenue: number | null;
    kind: string;
    scenario?: string;
  }[];
  metrics: {
    lastRevenue: number | null;
    avgQoqGrowth: number | null;
    avgYoyGrowth: number | null;
    baseGrowthUsed: number | null;
  };
  narrative: string | null;
  model: string | null;
  usedLlm: boolean;
  sourceNote: string;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function AiFinancialPanel({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(false);
  const [loadingFc, setLoadingFc] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AiAnalysisPayload | null>(null);
  const [fc, setFc] = useState<ForecastPayload | null>(null);

  const runAnalysis = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/stocks/${symbol}/ai-analysis`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.success) {
        setErr(json?.error?.message ?? "Không phân tích được");
        setData(null);
      } else {
        setData(json.data as AiAnalysisPayload);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi mạng");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const runForecast = useCallback(async () => {
    if (!symbol) return;
    setLoadingFc(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/stocks/${symbol}/revenue-forecast?horizons=4`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.success) {
        setErr(json?.error?.message ?? "Không dự báo được");
        setFc(null);
      } else {
        setFc(json.data as ForecastPayload);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi mạng");
    } finally {
      setLoadingFc(false);
    }
  }, [symbol]);

  const baseRows =
    fc?.forecast.filter((p) => p.scenario === "base" || !p.scenario).slice(0, 4) ?? [];

  return (
    <Panel
      title="AI phân tích sức khỏe, xu hướng & dự báo DT"
      right={
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={loading || !symbol}
            className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {loading ? "Đang phân tích…" : data ? "Phân tích lại" : "AI phân tích + đọc chart"}
          </button>
          <button
            type="button"
            onClick={() => void runForecast()}
            disabled={loadingFc || !symbol}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:bg-accent/10 disabled:opacity-50"
          >
            {loadingFc ? "Đang dự báo…" : fc ? "Dự báo lại" : "Dự báo doanh thu"}
          </button>
        </div>
      }
    >
      {!data && !fc && !err && !loading && !loadingFc && (
        <p className="text-[12px] text-ink-3">
          Dữ liệu + chuỗi biểu đồ từ snapshot <strong className="text-ink-2">Báo cáo tài chính</strong>. LLM
          OpenRouter role <code className="text-ink-2">report</code> — model do{" "}
          <code className="text-ink-2">AI_MODEL_REPORT</code> quyết định (rỗng thì dùng default toàn hệ
          thống). Model đang chạy thật xem tại <code className="text-ink-2">/api/v1/system/llm</code>.
        </p>
      )}
      {(loading || loadingFc) && (
        <p className="text-[12px] text-ink-3">Đang gọi OpenRouter (qwen report)…</p>
      )}
      {err && <p className="text-[12px] text-warn/90">{err}</p>}

      {data && (
        <div className="mb-4 space-y-3 border-b border-line/50 pb-4">
          {data.structured && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-line/40 px-3 py-2">
                <div className="text-[10px] uppercase text-ink-3">Sức khỏe</div>
                <div className="text-[12px] font-medium text-ink-2">{data.structured.healthSummary}</div>
              </div>
              <div className="rounded-md border border-line/40 px-3 py-2">
                <div className="text-[10px] uppercase text-ink-3">Xu hướng</div>
                <div className="text-[12px] font-medium text-ink-2">{data.structured.trendSummary}</div>
              </div>
            </div>
          )}
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{data.narrative}</div>
          {data.structured &&
            (data.structured.strengths.length > 0 || data.structured.risks.length > 0) && (
              <div className="grid gap-3 md:grid-cols-2">
                {data.structured.strengths.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-up">Điểm mạnh</div>
                    <ul className="space-y-0.5 text-[12px] text-ink-2">
                      {data.structured.strengths.map((s, i) => (
                        <li key={i}>• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.structured.risks.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-down">Rủi ro</div>
                    <ul className="space-y-0.5 text-[12px] text-ink-2">
                      {data.structured.risks.map((s, i) => (
                        <li key={i}>• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          {data.structured?.outlook && (
            <p className="text-[12px] text-ink-2">
              <strong className="text-ink-3">Outlook: </strong>
              {data.structured.outlook}
            </p>
          )}
          {data.structured?.chartInsights && data.structured.chartInsights.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">AI đọc biểu đồ</div>
              <ul className="space-y-0.5 text-[12px] text-ink-2">
                {data.structured.chartInsights.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {data.structured && data.structured.watchpoints.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">Theo dõi</div>
              <ul className="space-y-0.5 text-[12px] text-ink-2">
                {data.structured.watchpoints.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-ink-3">
            {data.usedLlm
              ? `OpenRouter · ${data.model ?? "—"} · ${data.latencyMs ?? "—"}ms`
              : "Engine deterministic"}{" "}
            · {data.sourceNote}
          </p>
        </div>
      )}

      {fc && (
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-ink-2">Dự báo doanh thu thuần (4 quý)</div>
          <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
            <span>QoQ TB: {pct(fc.metrics.avgQoqGrowth)}</span>
            <span>YoY TB: {pct(fc.metrics.avgYoyGrowth)}</span>
            <span>Base/quý: {pct(fc.metrics.baseGrowthUsed)}</span>
            <span>DT gần nhất: {fmtCompact(fc.metrics.lastRevenue)}</span>
          </div>
          {baseRows.length > 0 && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="py-1 text-left font-medium">Kỳ</th>
                  <th className="num py-1 font-medium">Base</th>
                  <th className="num py-1 font-medium">Bull</th>
                  <th className="num py-1 font-medium">Bear</th>
                </tr>
              </thead>
              <tbody>
                {baseRows.map((b) => {
                  const bull = fc.forecast.find((p) => p.period === b.period && p.scenario === "bull");
                  const bear = fc.forecast.find((p) => p.period === b.period && p.scenario === "bear");
                  return (
                    <tr key={b.period} className="border-b border-line/40">
                      <td className="py-1 text-ink-2">{b.period}</td>
                      <td className="num py-1">{fmtCompact(b.netRevenue)}</td>
                      <td className="num py-1 text-up">{fmtCompact(bull?.netRevenue ?? null)}</td>
                      <td className="num py-1 text-down">{fmtCompact(bear?.netRevenue ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {fc.narrative && (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{fc.narrative}</p>
          )}
          <p className="text-[10px] text-ink-3">
            {fc.usedLlm ? `LLM · ${fc.model}` : "Engine"} · {fc.sourceNote} · {fc.currencyNote}
          </p>
        </div>
      )}
    </Panel>
  );
}

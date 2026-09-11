"use client";

import { useCallback, useState } from "react";
import { Panel } from "@/components/ui";

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
  } | null;
  model: string | null;
  latencyMs: number | null;
  usedLlm: boolean;
  sourceNote: string;
  llmConfigured?: boolean;
}

export function AiFinancialPanel({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AiAnalysisPayload | null>(null);

  const run = useCallback(async () => {
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

  return (
    <Panel
      title="AI phân tích sức khỏe & xu hướng"
      right={
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || !symbol}
          className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          {loading ? "Đang phân tích…" : data ? "Phân tích lại" : "Chạy AI phân tích"}
        </button>
      }
    >
      {!data && !err && !loading && (
        <p className="text-[12px] text-ink-3">
          Tổng hợp snapshot BCTC + điểm sức khỏe + xu hướng ngành. Cấu hình{" "}
          <code className="text-ink-2">AI_PROVIDER_KEY</code> (và tuỳ chọn{" "}
          <code className="text-ink-2">AI_MODEL_ANALYSIS</code>) trên Vercel để dùng LLM; không có key vẫn chạy
          engine deterministic.
        </p>
      )}
      {loading && (
        <p className="text-[12px] text-ink-3">Đang tổng hợp số liệu và gọi model phân tích…</p>
      )}
      {err && <p className="text-[12px] text-warn/90">{err}</p>}
      {data && (
        <div className="space-y-3">
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
              ? `LLM · ${data.model ?? "—"} · ${data.latencyMs ?? "—"}ms`
              : "Engine deterministic"}{" "}
            · {data.sourceNote}
          </p>
        </div>
      )}
    </Panel>
  );
}

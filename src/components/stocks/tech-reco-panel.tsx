"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StockTechRecoResult } from "@/lib/services/stock-tech-reco";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Brain, Compass, ShieldAlert } from "lucide-react";

export const TechRecoPanel = memo(function TechRecoPanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<StockTechRecoResult>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/tech-reco` : null,
    { refreshInterval: 180_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Khuyến nghị kỹ thuật">
        <Loading rows={4} />
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title="Khuyến nghị kỹ thuật">
        <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu để tổng hợp khuyến nghị kỹ thuật.</p>
      </Panel>
    );
  }

  const { quant, llm, llmStatus } = data;
  const stanceTone =
    (llm?.stance ?? quant.stance) === "watch-long"
      ? "up"
      : (llm?.stance ?? quant.stance) === "watch-short"
        ? "down"
        : "neutral";
  const stanceLabel =
    (llm?.stance ?? quant.stance) === "watch-long"
      ? "Theo dõi tăng"
      : (llm?.stance ?? quant.stance) === "watch-short"
        ? "Theo dõi giảm"
        : "Trung lập";

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Compass className="size-4 text-accent-primary" />
          Khuyến nghị kỹ thuật
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={stanceTone}>{stanceLabel}</Badge>
          <Badge
            tone={
              quant.confidence === "HIGH" ? "up" : quant.confidence === "MEDIUM" ? "warn" : "neutral"
            }
          >
            {quant.confidence}
          </Badge>
        </span>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Điểm quant kỹ thuật</div>
            <div className="num mt-0.5 text-[22px] font-semibold text-text-primary">
              {quant.score > 0 ? "+" : ""}
              {quant.score}
              <span className="ml-1.5 text-[12px] font-normal text-text-muted">/ 100</span>
            </div>
          </div>
          <p className="max-w-md text-[12px] leading-relaxed text-text-secondary">{quant.summary}</p>
        </div>

        <div className="relative h-2 overflow-hidden rounded-full bg-background-secondary">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border-subtle" />
          <div
            className={`absolute inset-y-0 ${quant.score >= 0 ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70"}`}
            style={{ width: `${Math.min(50, Math.abs(quant.score) / 2)}%` }}
          />
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {quant.factors.map((f) => (
            <div
              key={f.key}
              className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-elevated/50 px-2.5 py-2"
            >
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                  f.bias === "up" ? "bg-positive" : f.bias === "down" ? "bg-negative" : "bg-text-muted"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-text-secondary">{f.label}</span>
                  <span className="num text-[11px] text-text-primary">{f.value}</span>
                </div>
                <p className="text-[10.5px] leading-snug text-text-muted">{f.note}</p>
              </div>
            </div>
          ))}
        </div>

        {llm?.narrative && (
          <div className="panel-inset space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
              <Brain className="size-3.5 text-accent-primary" />
              <span>LLM tổng hợp</span>
              <Badge tone={stanceTone}>{stanceLabel}</Badge>
              {llm.model && <span className="normal-case tracking-normal text-text-muted">{llm.model}</span>}
            </div>
            <p className="text-[12.5px] leading-relaxed text-text-primary">{llm.narrative}</p>
            {llm.keyDrivers?.length > 0 && (
              <ul className="space-y-0.5 text-[11.5px] text-text-secondary">
                {llm.keyDrivers.map((d, i) => (
                  <li key={i}>▸ {d}</li>
                ))}
              </ul>
            )}
            {llm.risks?.length > 0 && (
              <div className="flex items-start gap-1.5 text-[11px] text-text-muted">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>{llm.risks.join(" · ")}</span>
              </div>
            )}
            {llm.invalidation && (
              <p className="text-[11px] text-text-muted">
                <span className="font-medium text-text-secondary">Vô hiệu hóa: </span>
                {llm.invalidation}
              </p>
            )}
          </div>
        )}

        {!llm && llmStatus === "skipped" && (
          <p className="text-[10.5px] text-text-muted">LLM chưa bật (AI_PROVIDER_KEY) — đang hiển thị điểm quant.</p>
        )}
        {!llm && (llmStatus === "unavailable" || llmStatus === "failed") && (
          <p className="text-[10.5px] text-text-muted">LLM tạm không phản hồi — giữ điểm quant kỹ thuật.</p>
        )}

        <p className="text-[10px] leading-relaxed text-text-muted">
          Tổng hợp kỹ thuật phục vụ nghiên cứu — không phải khuyến nghị mua/bán. Kết hợp thêm cơ bản & thanh khoản trước
          khi quyết định.
        </p>
      </div>
    </Panel>
  );
});

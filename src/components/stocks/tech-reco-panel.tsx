"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StockTechRecoResult } from "@/lib/services/stock-tech-reco";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Brain, Compass, Crosshair, ShieldAlert } from "lucide-react";

const CONF_VI: Record<string, string> = {
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp",
};

const REL_VI: Record<string, string> = {
  high: "cao",
  medium: "TB",
  low: "thấp",
};

function fmtPx(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export const TechRecoPanel = memo(function TechRecoPanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<StockTechRecoResult>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/tech-reco` : null,
    { refreshInterval: 120_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Tín hiệu kỹ thuật">
        <Loading rows={4} />
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title="Tín hiệu kỹ thuật">
        <p className="text-[12px] text-text-muted">
          Chưa đủ dữ liệu nến / chỉ báo để tính MUA · BÁN · QUAN SÁT.
        </p>
      </Panel>
    );
  }

  const { quant, llm, llmStatus } = data;
  const signal = quant.signal ?? "QUAN_SÁT";
  const confPct = quant.confidencePct ?? 0;
  const signalTone = signal === "MUA" ? "up" : signal === "BÁN" ? "down" : "neutral";
  const signalColor =
    signal === "MUA" ? "text-positive" : signal === "BÁN" ? "text-negative" : "text-text-secondary";

  const stanceTone =
    (llm?.stance ?? quant.stance) === "watch-long"
      ? "up"
      : (llm?.stance ?? quant.stance) === "watch-short"
        ? "down"
        : "neutral";

  const confLabel = CONF_VI[quant.confidence] ?? quant.confidence;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Compass className="size-4 text-accent-primary" />
          Tín hiệu kỹ thuật
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={signalTone}>{signal === "QUAN_SÁT" ? "QUAN SÁT" : signal}</Badge>
          <Badge
            tone={
              quant.confidence === "HIGH" ? "up" : quant.confidence === "MEDIUM" ? "warn" : "neutral"
            }
          >
            {confPct}%
          </Badge>
        </span>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border-subtle bg-surface-elevated/60 px-3 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Tín hiệu</div>
            <div className={`mt-0.5 text-[28px] font-bold tracking-tight ${signalColor}`}>
              {signal === "QUAN_SÁT" ? "QUAN SÁT" : signal}
            </div>
            <p className="mt-1 max-w-md text-[11.5px] text-text-secondary">{quant.summary}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Độ tin cậy</div>
            <div className="num text-[26px] font-semibold text-text-primary">
              {confPct}
              <span className="ml-0.5 text-[13px] font-normal text-text-muted">%</span>
            </div>
            <div className="text-[10.5px] text-text-muted">{confLabel}</div>
          </div>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-modal">
          <div
            className={`h-full rounded-full ${
              signal === "MUA" ? "bg-positive" : signal === "BÁN" ? "bg-negative" : "bg-warning"
            }`}
            style={{ width: `${Math.max(4, Math.min(100, confPct))}%` }}
          />
        </div>

        {quant.plan && (signal === "MUA" || signal === "BÁN") ? (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-elevated/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Crosshair className="size-3.5 text-accent-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Đề xuất Entry · SL · TP
              </span>
              <Badge tone={signalTone}>R:R 1:{quant.plan.riskReward.toFixed(1)}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-border-subtle bg-background-secondary/60 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-muted">Entry</div>
                <div className="num mt-0.5 text-[15px] font-semibold text-text-primary">
                  {fmtPx(quant.plan.entry)}
                </div>
              </div>
              <div className="rounded-md border border-negative/30 bg-negative/5 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-muted">Stop Loss</div>
                <div className="num mt-0.5 text-[15px] font-semibold text-negative">
                  {fmtPx(quant.plan.stopLoss)}
                </div>
                <div className="text-[10px] text-text-muted">−{quant.plan.riskPct}%</div>
              </div>
              <div className="rounded-md border border-positive/30 bg-positive/5 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-muted">Take Profit</div>
                <div className="num mt-0.5 text-[15px] font-semibold text-positive">
                  {fmtPx(quant.plan.takeProfit)}
                </div>
                <div className="text-[10px] text-text-muted">+{quant.plan.rewardPct}%</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
              <span>
                TP1 <strong className="num text-text-primary">{fmtPx(quant.plan.takeProfit1)}</strong>
              </span>
              <span>
                TP2 <strong className="num text-text-primary">{fmtPx(quant.plan.takeProfit2)}</strong>
              </span>
              <span>
                TP3 <strong className="num text-text-primary">{fmtPx(quant.plan.takeProfit3)}</strong>
              </span>
            </div>
            {quant.plan.basis?.length > 0 && (
              <ul className="space-y-0.5 text-[10.5px] text-text-muted">
                {quant.plan.basis.map((b, i) => (
                  <li key={i}>· {b}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-[11.5px] text-text-muted">
            Chưa có tín hiệu MUA/BÁN rõ — mặc định QUAN SÁT. Entry/SL/TP chỉ hiện khi có đồng thuận kỹ
            thuật.
          </div>
        )}

        {quant.patterns && quant.patterns.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Mẫu hình nến
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quant.patterns.map((p) => (
                <span
                  key={p.name}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${
                    p.type === "bullish"
                      ? "border-positive/40 bg-positive/10 text-positive"
                      : p.type === "bearish"
                        ? "border-negative/40 bg-negative/10 text-negative"
                        : "border-border-subtle text-text-secondary"
                  }`}
                  title={REL_VI[p.reliability] ?? p.reliability}
                >
                  {p.nameVi}
                  <span className="ml-1 opacity-70">({REL_VI[p.reliability] ?? p.reliability})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Yếu tố kỹ thuật
          </div>
          {quant.factors.map((f) => (
            <div key={f.key} className="flex items-start gap-2">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  f.bias === "up" ? "bg-positive" : f.bias === "down" ? "bg-negative" : "bg-text-muted"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[11.5px] font-medium text-text-primary">{f.label}</span>
                  <span className="num text-[11px] text-text-secondary">{f.value}</span>
                </div>
                {f.note && <p className="text-[10.5px] text-text-muted">{f.note}</p>}
              </div>
            </div>
          ))}
        </div>

        {llm && (
          <div className="space-y-1.5 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Brain className="size-3.5 text-accent-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                AI narrative
              </span>
              <Badge tone={stanceTone}>{llm.stance}</Badge>
            </div>
            <p className="text-[12px] leading-relaxed text-text-secondary">{llm.narrative}</p>
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

        {llmStatus !== "ok" && llmStatus !== "skipped" && (
          <p className="text-[10px] text-text-muted">
            AI:{" "}
            {llmStatus === "unavailable"
              ? "không khả dụng"
              : llmStatus === "failed"
                ? "lỗi"
                : llmStatus}{" "}
            — đang dùng tín hiệu định lượng.
          </p>
        )}

        <p className="text-[10px] text-text-muted">
          Tín hiệu nghiên cứu từ mẫu hình nến + chỉ báo · không phải khuyến nghị đầu tư.
        </p>
      </div>
    </Panel>
  );
});

"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StockTechRecoResult } from "@/lib/services/stock-tech-reco";
import type { StockStyleFitResult, StyleCriterionExplanation } from "@/lib/services/stock-style-fit";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Brain, CheckCircle2, Compass, ListChecks, ShieldAlert, XCircle } from "lucide-react";

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

export const TechRecoPanel = memo(function TechRecoPanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<StockTechRecoResult>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/tech-reco` : null,
    { refreshInterval: 120_000 },
  );
  const { data: styleFit, isLoading: styleFitLoading } = useApi<StockStyleFitResult>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/style-fit` : null,
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
            <div className="mt-1 text-[10px] text-text-muted">
              Điểm định lượng {quant.score > 0 ? "+" : ""}
              {quant.score}/100 · {confLabel}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[10px] text-text-muted">
            <span>Độ tin cậy định lượng</span>
            <span className="num">{confPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-modal">
            <div
              className={`h-full rounded-full ${
                signal === "MUA" ? "bg-positive" : signal === "BÁN" ? "bg-negative" : "bg-warning"
              }`}
              style={{ width: `${Math.max(4, Math.min(100, confPct))}%` }}
            />
          </div>
        </div>

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
            Chỉ báo / yếu tố
          </div>
          {quant.factors.map((f) => (
            <div
              key={f.key}
              className="flex items-start gap-2 rounded-md border border-border-subtle/80 px-2 py-1.5"
            >
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                  f.bias === "up" ? "bg-positive" : f.bias === "down" ? "bg-negative" : "bg-text-muted"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[11.5px] font-medium text-text-primary">{f.label}</span>
                  <span className="num text-[11px] text-text-primary">{f.value}</span>
                </div>
                <p className="text-[10.5px] leading-snug text-text-muted">{f.note}</p>
              </div>
            </div>
          ))}
        </div>

        {styleFitLoading && !styleFit ? (
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-2 text-[11px] text-text-muted">
            Đang đối chiếu điều kiện Minervini và CANSLIM…
          </div>
        ) : styleFit ? (
          <StyleFitBlock fit={styleFit} />
        ) : null}

        {llm?.narrative && (
          <div className="panel-inset space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
              <Brain className="size-3.5 text-accent-primary" />
              <span>Tổng hợp AI</span>
              <Badge tone={stanceTone}>
                {(llm.stance ?? quant.stance) === "watch-long"
                  ? "Theo dõi tăng"
                  : (llm.stance ?? quant.stance) === "watch-short"
                    ? "Theo dõi giảm"
                    : "Trung lập"}
              </Badge>
              {llm.model && (
                <span className="normal-case tracking-normal text-text-muted">{llm.model}</span>
              )}
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

        {llmStatus !== "ok" && llmStatus !== "skipped" && (
          <p className="text-[10px] text-text-muted">
            AI: {llmStatus === "unavailable" ? "không khả dụng" : llmStatus === "failed" ? "lỗi" : llmStatus}{" "}
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

function StyleFitBlock({ fit }: { fit: StockStyleFitResult }) {
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-elevated/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="size-3.5 text-accent-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Điều kiện bộ lọc
        </span>
        <span className="text-[10px] text-text-muted">đối chiếu theo dữ liệu hiện có</span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <StyleFitCard
          title="Mark Minervini"
          summary={
            fit.minervini
              ? `${fit.minervini.passCount}/${fit.minervini.total} · ${fit.minervini.passCount >= 6 ? "lọc mặc định" : "chưa đạt min 6"}${fit.minervini.stage2 ? " · Stage 2" : ""}`
              : "Chưa đủ dữ liệu"
          }
          pass={fit.minervini != null && fit.minervini.passCount >= 6}
          criteria={fit.minervini?.criteria ?? []}
          note={fit.minervini?.note}
        />
        <StyleFitCard
          title="CANSLIM"
          summary={
            fit.canslim
              ? `${fit.canslim.passCount}/${fit.canslim.total} chữ · ${fit.canslim.score}/100 · Grade ${fit.canslim.grade} · ${fit.canslim.score >= 40 ? "lọc mặc định" : "dưới score 40"}`
              : "Chưa đủ dữ liệu"
          }
          pass={fit.canslim != null && fit.canslim.score >= 40}
          criteria={fit.canslim?.letters ?? []}
          note={
            fit.canslim
              ? `${fit.canslim.note}${fit.canslim.phase ? ` · phase ${fit.canslim.phase}` : ""}`
              : undefined
          }
        />
      </div>
      {fit.notes.length > 0 && <p className="text-[10px] text-warning">{fit.notes.join(" · ")}</p>}
    </div>
  );
}

function StyleFitCard({
  title,
  summary,
  pass,
  criteria,
  note,
}: {
  title: string;
  summary: string;
  pass: boolean;
  criteria: StyleCriterionExplanation[];
  note?: string;
}) {
  return (
    <div className="rounded-md border border-border-subtle/80 bg-surface-modal/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-text-primary">{title}</span>
        <Badge tone={pass ? "up" : "neutral"}>{summary}</Badge>
      </div>
      {criteria.length > 0 ? (
        <div className="mt-2 space-y-1">
          {criteria.map((criterion) => (
            <div key={criterion.key} className="flex items-start gap-1.5 text-[10.5px]">
              {criterion.pass ? (
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-positive" />
              ) : (
                <XCircle className="mt-0.5 size-3 shrink-0 text-negative" />
              )}
              <div className="min-w-0">
                <div className={criterion.pass ? "text-text-primary" : "text-text-secondary"}>
                  {criterion.label}
                </div>
                <div className="text-[9.5px] leading-snug text-text-muted">{criterion.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] text-text-muted">Chưa có bản ghi điều kiện.</p>
      )}
      {note && (
        <p className="mt-2 border-t border-border-subtle/60 pt-1.5 text-[9.5px] leading-snug text-text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

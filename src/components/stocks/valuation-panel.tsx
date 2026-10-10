"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import {
  Panel,
  Badge,
  Chg,
  Loading,
  ErrorState,
  EmptyState,
  FreshnessAlertBanner,
  FreshnessDot,
  fmtNum,
  fmtCompact,
} from "@/components/ui";
import { Calculator, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { ValuationMarketStrip } from "@/components/stocks/valuation-market-strip";
import { DcfDetailPanel } from "@/components/stocks/dcf-detail-panel";

export function ValuationPanel({
  symbol,
  compact = false,
  showAnalyst = true,
}: {
  symbol: string;
  compact?: boolean;
  showAnalyst?: boolean;
}) {
  const [wantLlm, setWantLlm] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const { data, meta, isLoading, error, mutate } = useApi<Record<string, unknown>>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/valuation?full=1` : null,
    { refreshInterval: 120_000 },
  );

  const analystUrl = symbol
    ? `/api/v1/stocks/${encodeURIComponent(symbol)}/valuation/analyst${wantLlm ? "?llm=1" : ""}`
    : null;
  const {
    data: analyst,
    isLoading: analystLoading,
  } = useApi<Record<string, unknown>>(showAnalyst ? analystUrl : null, {
    refreshInterval: 300_000,
  });

  if (isLoading && !data) {
    return (
      <Panel title="Định giá">
        <Loading rows={6} label={`Đang tải mô hình định giá ${symbol}…`} />
      </Panel>
    );
  }

  if (error && !data) {
    return (
      <Panel title="Định giá">
        <ErrorState
          title={`Không thể dựng định giá ${symbol}`}
          message={error instanceof Error ? error.message : String(error)}
          onRetry={() => void mutate()}
        />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Định giá">
        <EmptyState
          title="Chưa có dữ liệu định giá"
          description={`Không tìm thấy dữ liệu BCTC và chỉ số để xây dựng mô hình cho ${symbol}.`}
          actionLabel="Tải lại"
          onAction={() => void mutate()}
        />
      </Panel>
    );
  }

  // Prefer flat view-model fields; fall back to nested engine payload if present.
  const nested = (data.valuation ?? null) as Record<string, unknown> | null;
  const nestedMult = (nested?.multiples ?? null) as Record<string, number | null> | null;
  const nestedFv = (nested?.fairValue ?? null) as Record<string, unknown> | null;
  const nestedP5 = (nested?.phase5 ?? null) as Record<string, unknown> | null;

  const currentPrice = Number(
    data.currentPrice ?? data.price ?? nested?.price ?? 0,
  );
  const marketCap =
    data.marketCap != null
      ? Number(data.marketCap)
      : nested?.marketCap != null
        ? Number(nested.marketCap)
        : null;
  const sharesOutstanding =
    data.sharesOutstanding != null ? Number(data.sharesOutstanding) : null;
  const enterpriseValue =
    data.enterpriseValue != null
      ? Number(data.enterpriseValue)
      : nested?.enterpriseValue != null
        ? Number(nested.enterpriseValue)
        : null;
  const fv = (data.fairValues ?? {}) as Record<string, unknown>;
  const blendedRaw =
    fv.blended ??
    nestedP5?.finalFairValue ??
    nestedFv?.blendedFairValue ??
    null;
  const blended = blendedRaw != null ? Number(blendedRaw) : null;
  const upsideRaw =
    data.upsideDownside ?? nestedP5?.upsidePct ?? nestedFv?.upsidePct ?? null;
  const upside = upsideRaw != null ? Number(upsideRaw) : null;
  const grade =
    data.valuationGrade != null
      ? String(data.valuationGrade)
      : nestedP5?.grade != null
        ? String(nestedP5.grade)
        : null;
  const scoreRaw = data.valuationScore ?? nestedP5?.valuationScore ?? null;
  const score = scoreRaw != null ? Number(scoreRaw) : null;
  const multiples = {
    pe: (data.multiples as Record<string, number | null> | undefined)?.pe ?? nestedMult?.pe ?? null,
    pb: (data.multiples as Record<string, number | null> | undefined)?.pb ?? nestedMult?.pb ?? null,
    ps: (data.multiples as Record<string, number | null> | undefined)?.ps ?? nestedMult?.ps ?? null,
    evEbitda:
      (data.multiples as Record<string, number | null> | undefined)?.evEbitda ??
      nestedMult?.evEbitda ??
      null,
    fcfYield:
      (data.multiples as Record<string, number | null> | undefined)?.fcfYield ??
      nestedMult?.fcfYield ??
      null,
  } as Record<string, number | null>;
  const notes = Array.isArray(data.notes)
    ? (data.notes as string[]).filter(Boolean)
    : [];
  const priceSource =
    typeof data.priceSource === "string" ? data.priceSource : null;
  const sharesSource =
    typeof data.sharesSource === "string" ? data.sharesSource : null;

  const nestedP3 = (nested?.phase3 ?? null) as Record<string, unknown> | null;
  const dcfDetail = (data.dcfDetail ??
    (nestedP3
      ? {
          scenarios: nestedP3.dcf ?? nested?.dcf ?? null,
          sensitivity: nestedP3.sensitivity ?? nested?.sensitivity ?? null,
          costOfCapital: nestedP3.costOfCapital ?? null,
        }
      : null)) as {
    scenarios?: unknown[];
    sensitivity?: unknown;
    costOfCapital?: unknown;
  } | null;

  const fmtPrice = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) ? "—" : fmtNum(n, n >= 1000 ? 0 : 2);

  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Calculator className="size-4 text-accent" />
            Định giá doanh nghiệp
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </span>
        }
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            {grade && <Badge tone="neutral">Grade {grade}</Badge>}
            {data.confidence != null && (
              <Badge tone="neutral">{String(data.confidence).toUpperCase()}</Badge>
            )}
          </span>
        }
      >
        {meta?.freshness && (meta.freshness === "DELAYED" || meta.freshness === "STALE" || meta.degraded) && (
          <FreshnessAlertBanner
            state={meta.freshness === "STALE" ? "stale" : meta.degraded ? "degraded" : "delayed"}
            ageMs={meta.ageMs}
            note={meta.note}
            source={meta.source}
            className="mb-3"
          />
        )}
        <div className={`grid gap-4 ${compact ? "md:grid-cols-2" : "md:grid-cols-[auto_1fr_1fr]"}`}>
          <div className="flex flex-col items-center justify-center">
            <div className="num text-[28px] font-bold text-ink">
              {score != null ? Math.round(score) : "—"}
            </div>
            <div className="mt-1 text-center text-[10px] text-ink-3">Valuation Score</div>
            {data.industryProfile != null && (
              <div className="mt-0.5 text-[10px] text-ink-3">
                Ngành: {String(data.industryProfile)}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-3">Giá vs Fair value</div>
            <div className="flex flex-wrap items-baseline gap-3">
              <div>
                <div className="text-[10px] text-ink-3">Giá hiện tại</div>
                <div className="num text-[22px] font-semibold text-ink">{fmtPrice(currentPrice)}</div>
              </div>
              <div className="text-ink-3">→</div>
              <div>
                <div className="text-[10px] text-ink-3">FV blended</div>
                <div className="num text-[22px] font-semibold text-accent">{fmtPrice(blended)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">Upside</span>
              <Chg value={upside} className="text-[14px] font-semibold" />
            </div>

            <ValuationMarketStrip
              price={currentPrice}
              sharesOutstanding={sharesOutstanding}
              marketCap={marketCap}
              fmtPrice={fmtPrice}
            />

            <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
              {marketCap != null && <span>MC {fmtCompact(marketCap)}</span>}
              {enterpriseValue != null && <span>EV {fmtCompact(enterpriseValue)}</span>}
              {sharesOutstanding != null && (
                <span title={sharesSource ?? undefined}>
                  CP LH {fmtCompact(sharesOutstanding)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-3">Multiples</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <span className="text-ink-3">P/E</span>
              <span className="num text-right">{multiples.pe != null ? multiples.pe.toFixed(1) : "—"}</span>
              <span className="text-ink-3">P/B</span>
              <span className="num text-right">{multiples.pb != null ? multiples.pb.toFixed(2) : "—"}</span>
              <span className="text-ink-3">P/S</span>
              <span className="num text-right">{multiples.ps != null ? multiples.ps.toFixed(2) : "—"}</span>
              <span className="text-ink-3">EV/EBITDA</span>
              <span className="num text-right">
                {multiples.evEbitda != null ? multiples.evEbitda.toFixed(1) : "—"}
              </span>
              <span className="text-ink-3">FCF yield</span>
              <span className="num text-right">
                {multiples.fcfYield != null ? `${multiples.fcfYield.toFixed(1)}%` : "—"}
              </span>
            </div>
            {(fv.dcfBase != null || fv.dcfBear != null || fv.dcfBull != null) && (
              <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line/40 pt-2 text-center text-[11px]">
                <div>
                  <div className="text-[10px] text-ink-3">DCF Bear</div>
                  <div className="num font-medium">{fmtPrice(fv.dcfBear != null ? Number(fv.dcfBear) : null)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-ink-3">DCF Base</div>
                  <div className="num font-semibold text-accent">{fmtPrice(fv.dcfBase != null ? Number(fv.dcfBase) : null)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-ink-3">DCF Bull</div>
                  <div className="num font-medium">{fmtPrice(fv.dcfBull != null ? Number(fv.dcfBull) : null)}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {notes.length > 0 && (
          <div className="mt-3 border-t border-line/40 pt-2">
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-ink"
            >
              {showNotes ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Ghi chú engine ({notes.length})
            </button>
            {showNotes && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink-3">
                {notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <DcfDetailPanel
        scenarios={(dcfDetail?.scenarios as never) ?? null}
        sensitivity={(dcfDetail?.sensitivity as never) ?? null}
        costOfCapital={(dcfDetail?.costOfCapital as never) ?? null}
        currentPrice={currentPrice > 0 ? currentPrice : null}
      />

      {showAnalyst && (
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              AI Equity Research
              {analyst?.usedLlm ? (
                <Badge tone="neutral">LLM</Badge>
              ) : (
                <Badge tone="neutral">Deterministic</Badge>
              )}
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => setWantLlm((v) => !v)}
              className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:bg-bg-2"
            >
              {wantLlm ? "Tắt LLM" : "Bật LLM"}
            </button>
          }
        >
          {analystLoading && !analyst ? (
            <Loading rows={3} />
          ) : typeof analyst?.narrative === "string" && analyst.narrative ? (
            <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
              <div className="whitespace-pre-wrap break-words">{analyst.narrative}</div>
              {typeof analyst.model === "string" && analyst.model && (
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

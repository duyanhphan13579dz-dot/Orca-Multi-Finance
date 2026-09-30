"use client";

import { useEffect, useState } from "react";
import { Badge, Loading, Panel } from "@/components/ui";
import { Layers } from "lucide-react";
import {
  analyzeMtfBias,
  companionTimeframes,
  type MtfBiasResult,
} from "@/lib/engines/mtf-bias";
import type { ChartAssetType, ChartCandle } from "@/lib/chart-const";
import { tfsFor, TF_LABEL } from "@/lib/chart-const";
import type { OhlcvBar } from "@/lib/types";

function biasTone(b: string): "up" | "down" | "neutral" {
  if (b === "bullish") return "up";
  if (b === "bearish") return "down";
  return "neutral";
}

export function MtfBiasPanel({
  symbol,
  assetType = "stock",
  chartTimeframe = "1d",
}: {
  symbol: string;
  assetType?: ChartAssetType;
  chartTimeframe?: string;
}) {
  const [bias, setBias] = useState<MtfBiasResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tfs = companionTimeframes(chartTimeframe, tfsFor(assetType));
    setLoading(true);
    (async () => {
      try {
        const seriesByTf: Record<string, OhlcvBar[]> = {};
        await Promise.all(
          tfs.map(async (t) => {
            const url = `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${t}&limit=300`;
            const res = await fetch(url);
            if (!res.ok) return;
            const json = await res.json();
            const candles = json?.data?.candles as ChartCandle[] | undefined;
            if (!candles?.length) return;
            seriesByTf[t] = candles.map((c) => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            }));
          }),
        );
        if (cancelled) return;
        setBias(Object.keys(seriesByTf).length ? analyzeMtfBias(seriesByTf) : null);
      } catch {
        if (!cancelled) setBias(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, assetType, chartTimeframe]);

  if (loading && !bias) {
    return (
      <Panel title="Multi-TF Bias">
        <Loading rows={2} />
      </Panel>
    );
  }

  if (!bias) {
    return (
      <Panel title="Multi-TF Bias">
        <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu đa khung thời gian.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Layers className="size-4 text-accent" /> Multi-TF Bias (ICT/SMC)
        </span>
      }
      right={<Badge tone={biasTone(bias.bias)}>{bias.confidence}%</Badge>}
    >
      <p className="mb-2 text-[12px] leading-relaxed text-text-secondary">{bias.summary}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge tone={biasTone(bias.bias)}>
          Bias {bias.bias === "bullish" ? "tăng" : bias.bias === "bearish" ? "giảm" : "trung tính"}
        </Badge>
        <Badge tone="neutral">
          score {bias.score >= 0 ? "+" : ""}
          {bias.score}
        </Badge>
        <Badge tone={bias.alignment.startsWith("aligned") ? biasTone(bias.bias) : "neutral"}>
          {bias.alignment === "aligned_bull"
            ? "đồng thuận tăng"
            : bias.alignment === "aligned_bear"
              ? "đồng thuận giảm"
              : bias.alignment === "mixed"
                ? "lệch pha"
                : "thiếu TF"}
        </Badge>
        {bias.htfTimeframe && (
          <Badge tone={biasTone(bias.htfBias)}>
            HTF {TF_LABEL[bias.htfTimeframe] ?? bias.htfTimeframe}
          </Badge>
        )}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {bias.timeframes.map((r) => (
          <div
            key={r.timeframe}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-background-secondary/40 px-2.5 py-1.5"
          >
            <span className="text-[11px] font-semibold tabular-nums text-text-primary">
              {TF_LABEL[r.timeframe] ?? r.timeframe}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted">{r.state}</span>
              <Badge tone={biasTone(r.bias)}>
                {r.bias === "bullish" ? "↑" : r.bias === "bearish" ? "↓" : "·"}{" "}
                {r.score >= 0 ? "+" : ""}
                {Math.round(r.score)}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

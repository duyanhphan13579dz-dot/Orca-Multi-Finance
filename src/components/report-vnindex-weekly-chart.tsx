"use client";

/**
 * VN-Index weekly line chart for Weekly Strategy Block 2 (tổng quan diễn biến tuần).
 * Line series only — no candles / indicators.
 */
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { ChartMarketData } from "@/lib/chart-const";
import { Loading } from "@/components/ui";

interface Props {
  height?: number;
  /** weekly bars to request (aggregated from daily when needed) */
  limit?: number;
}

export function ReportVnIndexWeeklyChart({ height = 260, limit = 104 }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "160px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { data, meta, isLoading, error } = useApi<ChartMarketData>(
    visible
      ? `/api/v1/chart/history?symbol=VNINDEX&assetType=stock&timeframe=1w&limit=${Math.min(Math.max(limit, 20), 2500)}`
      : null,
  );

  useEffect(() => {
    if (!visible || !hostRef.current) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const lw = await import("lightweight-charts");
      if (cancelled || !hostRef.current) return;

      const chart = lw.createChart(hostRef.current, {
        height,
        layout: {
          background: { type: lw.ColorType.Solid, color: "transparent" },
          textColor: "#64769a",
          fontSize: 11,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        },
        grid: {
          vertLines: { color: "rgba(33,56,99,0.35)" },
          horzLines: { color: "rgba(33,56,99,0.35)" },
        },
        crosshair: { mode: lw.CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      });
      const series = chart.addSeries(lw.LineSeries, {
        color: "#4c8dff",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });

      chartRef.current = chart;
      seriesRef.current = series;

      ro = new ResizeObserver(() => {
        if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
      });
      ro.observe(hostRef.current);
      chart.applyOptions({ width: hostRef.current.clientWidth });
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      try {
        chartRef.current?.remove?.();
      } catch {
        /* noop */
      }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [visible, height]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const candles = data?.candles ?? [];
    if (!candles.length) {
      series.setData([]);
      return;
    }
    series.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000),
        value: c.close,
      })),
    );
    chart.timeScale().fitContent();
  }, [data]);

  const empty = visible && !isLoading && (Boolean(error) || (data != null && !data.candles?.length));

  return (
    <div ref={shellRef} className="mt-3 overflow-hidden rounded-lg border border-border-subtle">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="text-[12px] font-semibold text-text-primary">VN-Index · khung tuần (line)</span>
        <span className="text-[10px] text-text-muted">
          {meta?.source
            ? `${meta.source}${data?.candles?.length ? ` · ${data.candles.length} nến tuần` : ""}`
            : "1W"}
        </span>
      </div>
      <div className="relative p-2">
        <div ref={hostRef} className="w-full" style={{ height }} />
        {(!visible || (isLoading && !data)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/40">
            <Loading rows={2} />
          </div>
        )}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[12px] text-text-muted">
            Không lấy được chuỗi VN-Index tuần — thử lại sau hoặc kiểm tra /system.
          </div>
        )}
      </div>
    </div>
  );
}

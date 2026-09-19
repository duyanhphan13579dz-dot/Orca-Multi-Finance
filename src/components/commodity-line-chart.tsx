"use client";

/**
 * Biểu đồ đường đơn giản cho trang Hàng hóa — không nến, không indicator.
 * Lazy: chỉ dynamic-import lightweight-charts và fetch history khi vào viewport.
 * Fallback: ưu tiên GOLD trong options; nếu series trống → chuyển 1 lần sang option kế tiếp.
 */
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import { TF_LABEL, type ChartMarketData } from "@/lib/chart-const";
import { Loading } from "@/components/ui";

const COMMODITY_TFS = ["1h", "4h", "1d", "1w", "1M"] as const;

/** Prefer these when options list has no explicit order. */
const PREFERRED_DEFAULT = ["GOLD", "SILVER", "WTI", "BRENT", "COPPER"] as const;

export interface CommodityChartOption {
  chartSymbol: string;
  label: string;
}

interface Props {
  options: CommodityChartOption[];
  height?: number;
}

function pickDefaultSymbol(options: CommodityChartOption[]): string {
  if (!options.length) return "";
  for (const p of PREFERRED_DEFAULT) {
    const hit = options.find((o) => o.chartSymbol === p);
    if (hit) return hit.chartSymbol;
  }
  return options[0]!.chartSymbol;
}

export function CommodityLineChart({ options, height = 320 }: Props) {
  const shellRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [chartSymbol, setChartSymbol] = useState(() => pickDefaultSymbol(options));
  const [tf, setTf] = useState<string>("1d");
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  /** Only auto-switch once per mount / option-set so user choice is respected. */
  const autoSwitched = useRef(false);
  const triedEmpty = useRef<Set<string>>(new Set());

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
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Reset when catalog options change identity
  useEffect(() => {
    if (!options.length) {
      window.setTimeout(() => setChartSymbol(""), 0);
      return;
    }
    if (!options.some((o) => o.chartSymbol === chartSymbol)) {
      autoSwitched.current = false;
      triedEmpty.current.clear();
      setFallbackNote(null);
      window.setTimeout(() => setChartSymbol(pickDefaultSymbol(options)), 0);
    }
  }, [options, chartSymbol]);

  const active = options.find((o) => o.chartSymbol === chartSymbol) ?? options[0] ?? null;
  const histLimit = tf === "1d" || tf === "1w" || tf === "1M" ? 1000 : 800;
  const { res, data, meta, isLoading, error } = useApi<ChartMarketData>(
    visible && active
      ? `/api/v1/chart/history?symbol=${encodeURIComponent(active.chartSymbol)}&assetType=commodity&timeframe=${tf}&limit=${histLimit}`
      : null,
  );

  // Auto-fallback once: empty / upstream unavailable → next preferred option
  useEffect(() => {
    if (!visible || isLoading || !active || autoSwitched.current) return;
    const upstreamFail = Boolean(error) || (res != null && res.success === false);
    const emptySeries = data != null && !(data.candles?.length);
    const failed = upstreamFail || emptySeries;
    if (!failed) return;

    triedEmpty.current.add(active.chartSymbol);

    // Prefer GOLD / SILVER / WTI before walking the rest of the list
    const ordered = [
      ...PREFERRED_DEFAULT.map((s) => options.find((o) => o.chartSymbol === s)).filter(Boolean),
      ...options,
    ] as CommodityChartOption[];
    const seen = new Set<string>();
    const next = ordered.find((o) => {
      if (!o || seen.has(o.chartSymbol)) return false;
      seen.add(o.chartSymbol);
      return !triedEmpty.current.has(o.chartSymbol);
    });

    if (next && next.chartSymbol !== active.chartSymbol) {
      autoSwitched.current = true;
      setFallbackNote(`${active.label} chưa có chuỗi giá — đang hiển thị ${next.label}`);
      setChartSymbol(next.chartSymbol);
    }
  }, [visible, isLoading, data, error, res, active, options]);

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

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
      candles.map((c: { time: number; close: number }) => ({
        time: Math.floor(c.time / 1000),
        value: c.close,
      })),
    );
    chart.timeScale().fitContent();
  }, [data]);

  if (!options.length) {
    return (
      <section className="panel overflow-hidden p-4">
        <div className="text-[13px] font-semibold text-text-primary">Biểu đồ biến động</div>
        <p className="mt-2 text-[12px] text-text-muted">
          Chưa có mặt hàng có chuỗi giá quốc tế trong danh mục hiện tại.
        </p>
      </section>
    );
  }

  const emptyAfterLoad = visible && !isLoading && data && !data.candles?.length;

  return (
    <section ref={shellRef} className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-text-primary">Biểu đồ biến động</h2>
        <select
          value={active?.chartSymbol ?? ""}
          onChange={(e) => {
            autoSwitched.current = true; // user choice — stop auto chain
            triedEmpty.current.delete(e.target.value);
            setFallbackNote(null);
            setChartSymbol(e.target.value);
          }}
          className="rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/60"
          aria-label="Chọn mặt hàng"
        >
          {options.map((o) => (
            <option key={`${o.chartSymbol}-${o.label}`} value={o.chartSymbol}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="chart-control-group ml-auto">
          <span className="chart-control-label">Khung thời gian</span>
          <div className="seg" role="group" aria-label="Khung thời gian biểu đồ">
            {COMMODITY_TFS.map((x) => (
              <button key={x} type="button" data-active={tf === x} onClick={() => setTf(x)} aria-pressed={tf === x}>
                {TF_LABEL[x] ?? x}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="relative p-2">
        {(meta?.source || fallbackNote) && (
          <div className="mb-1 space-y-0.5 px-1 text-[10px] text-text-muted">
            {meta?.source ? (
              <div>
                {active?.label} · {meta.source}
                {data?.candles?.length ? ` · ${data.candles.length} điểm` : ""}
                {meta.note ? ` · ${meta.note}` : ""}
              </div>
            ) : null}
            {fallbackNote ? <div className="text-amber-400/90">{fallbackNote}</div> : null}
          </div>
        )}
        <div ref={hostRef} className="w-full" style={{ height }} />
        {(!visible || (isLoading && !data)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/50">
            <Loading rows={2} />
          </div>
        )}
        {emptyAfterLoad && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-muted">
            Không lấy được chuỗi giá cho mặt hàng này
          </div>
        )}
      </div>
      <footer className="border-t border-border-subtle px-3.5 py-2 text-[10px] text-text-muted">
        Biểu đồ đường tham chiếu quốc tế (Yahoo / Binance PAXG) — có thể khác giá VietnamBiz (VND/nội địa).
        {tf !== "1d" ? " Intraday thiếu dữ liệu sẽ tự hạ về khung ngày." : ""}
      </footer>
    </section>
  );
}

/** Map tên/symbol VietnamBiz → mã chart ổn định gửi API. */
export function resolveCommodityChartSymbol(symbol: string, nameVi: string): string | null {
  const s = `${symbol} ${nameVi}`.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/BRENT/.test(s)) return "BRENT";
  if (/WTI|USOIL|CRUDE|DAU THO|DAUTHO/.test(s)) return "WTI";
  if (/VANG|GOLD|XAU|SJC/.test(s)) return "GOLD";
  if (/SILVER|XAG/.test(s) || /(^|[^A-Z])BAC([^A-Z]|$)/.test(s)) return "SILVER";
  if (/COPPER|\bDONG\b|DONGTHOI/.test(s)) return "COPPER";
  if (/NATGAS|NATURAL\s*GAS|KHI DO|KHIDO/.test(s)) return "NATGAS";
  if (/CAFE|COFFEE|CA PHE|CAPHE/.test(s)) return "COFFEE";
  if (/DUONG|SUGAR/.test(s)) return "SUGAR";
  if (/PLATINUM|BACH KIM|BACHKIM/.test(s)) return "PLATINUM";
  if (/PALLADIUM/.test(s)) return "PALLADIUM";
  if (/CORN|\bNGO\b|\bBAP\b/.test(s)) return "CORN";
  if (/SOY|DAU TUONG|DAUTUONG/.test(s)) return "SOYBEAN";
  if (/WHEAT|LUA MI|LUAMI/.test(s)) return "WHEAT";
  if (/QUANG SAT|IRON\s*ORE|\bIRON\b|THEP PHEP|HRC/.test(s)) return "IRON";
  return null;
}

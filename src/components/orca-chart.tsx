"use client";

/**
 * Lazy chart entry — code-splits lightweight-charts / SeriesManager and only
 * mounts the heavy client chart once the host enters (or nears) the viewport.
 * All existing `import { OrcaChart }` call sites keep working unchanged.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Loading } from "@/components/ui";

type ChartProps = ComponentProps<typeof import("@/chart/OrcaFinancialChart").OrcaFinancialChart>;

const OrcaFinancialChartLazy = dynamic(
  () => import("@/chart/OrcaFinancialChart").then((m) => m.OrcaFinancialChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={430} />,
  },
);

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border-subtle bg-background-secondary"
      style={{ minHeight: height }}
      aria-busy="true"
      aria-label="Đang tải biểu đồ"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <div className="h-3.5 w-24 animate-pulse rounded bg-surface-elevated" />
        <div className="ml-auto flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 w-9 animate-pulse rounded bg-surface-elevated" />
          ))}
        </div>
      </div>
      <div className="flex h-full items-center justify-center p-6" style={{ minHeight: height - 44 }}>
        <Loading rows={3} />
      </div>
    </div>
  );
}

/**
 * Viewport gate: keep a reserved height so layout does not jump, then mount
 * the dynamic chart chunk only after intersection (with generous rootMargin).
 */
export function OrcaChart(props: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const height = props.height ?? 430;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    // Already in view on mount (detail pages) → load immediately
    if (typeof IntersectionObserver === "undefined") {
      setReady(true);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setReady(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="w-full" style={{ minHeight: height }}>
      {ready ? <OrcaFinancialChartLazy {...props} /> : <ChartSkeleton height={height} />}
    </div>
  );
}

export default OrcaChart;

"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Horizontal sector rail — edge fades + prev/next, scroll-optimized. */
export function SectorScrollRail({ children, itemCount }: { children: ReactNode; itemCount: number }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 8);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 8);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateEdges();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateEdges) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [updateEdges, itemCount]);

  const scrollByDir = useCallback((dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.min(440, Math.max(220, el.clientWidth * 0.7));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  return (
    <div className="bd-scroll-rail">
      <div
        className={`pointer-events-none absolute inset-y-1 left-0 z-10 w-6 bg-gradient-to-r from-surface-base to-transparent transition-opacity duration-150 ${
          canLeft ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute inset-y-1 right-0 z-10 w-6 bg-gradient-to-l from-surface-base to-transparent transition-opacity duration-150 ${
          canRight ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />

      <button
        type="button"
        aria-label="Cuộn sang trái"
        disabled={!canLeft}
        onClick={() => scrollByDir(-1)}
        className="absolute left-1 top-1/2 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated/90 text-text-primary shadow transition-opacity disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="text-base leading-none">‹</span>
      </button>
      <button
        type="button"
        aria-label="Cuộn sang phải"
        disabled={!canRight}
        onClick={() => scrollByDir(1)}
        className="absolute right-1 top-1/2 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated/90 text-text-primary shadow transition-opacity disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="text-base leading-none">›</span>
      </button>

      <div className="rounded-xl border border-border-subtle/50 bg-surface-base/30">
        <div ref={scrollerRef} className="bd-scroll-scroller">
          {children}
          <div className="w-1 shrink-0" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export const SectorColumnShell = memo(function SectorColumnShell({ children }: { children: ReactNode }) {
  return <div className="shrink-0">{children}</div>;
});

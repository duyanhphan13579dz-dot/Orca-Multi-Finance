"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Horizontal sector rail with edge fades + prev/next buttons. */
export function SectorScrollRail({ children, itemCount }: { children: ReactNode; itemCount: number }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 4);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    const onScroll = () => {
      const node = el as HTMLDivElement & { _raf?: number };
      if (node._raf) return;
      node._raf = requestAnimationFrame(() => {
        node._raf = undefined;
        updateEdges();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateEdges) : null;
    ro?.observe(el);
    window.addEventListener("resize", updateEdges, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, itemCount]);

  const scrollByDir = useCallback((dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.min(480, Math.max(240, el.clientWidth * 0.72));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  return (
    <div className="relative -mx-1">
      <div
        className={`pointer-events-none absolute inset-y-2 left-0 z-10 w-8 rounded-l-xl bg-gradient-to-r from-surface-base to-transparent transition-opacity ${
          canLeft ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute inset-y-2 right-0 z-10 w-8 rounded-r-xl bg-gradient-to-l from-surface-base to-transparent transition-opacity ${
          canRight ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />

      <button
        type="button"
        aria-label="Cuộn sang trái"
        disabled={!canLeft}
        onClick={() => scrollByDir(-1)}
        className="absolute left-1 top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated/95 text-text-primary shadow-md transition hover:bg-surface-elevated disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="text-lg leading-none">‹</span>
      </button>
      <button
        type="button"
        aria-label="Cuộn sang phải"
        disabled={!canRight}
        onClick={() => scrollByDir(1)}
        className="absolute right-1 top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated/95 text-text-primary shadow-md transition hover:bg-surface-elevated disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="text-lg leading-none">›</span>
      </button>

      <div className="rounded-xl border border-border-subtle/60 bg-surface-base/40 p-2 shadow-inner">
        <div
          ref={scrollerRef}
          className="flex gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-2 pt-0.5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.45)_transparent]"
          style={{ WebkitOverflowScrolling: "touch", scrollSnapType: "x mandatory" }}
        >
          {children}
          <div className="w-2 shrink-0" aria-hidden />
        </div>
        <p className="mt-1 text-center text-[10px] text-text-muted/80 sm:hidden">
          ← Vuốt ngang hoặc dùng nút ‹ › để xem ngành khác →
        </p>
      </div>
    </div>
  );
}

export const SectorColumnShell = memo(function SectorColumnShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="snap-start" style={{ scrollSnapAlign: "start" }}>
      {children}
    </div>
  );
});

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top progress bar during client navigations.
 * Started via `window` event from shell nav; completed when pathname changes.
 * Masks RSC/data latency so transitions feel intentional instead of stuttery.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pathnameRef = useRef(pathname);

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };

  const start = () => {
    clearTimers();
    setVisible(true);
    setActive(true);
    setWidth(12);
    // Ease toward ~80% while waiting for the new route
    timers.current.push(
      setTimeout(() => setWidth(38), 40),
      setTimeout(() => setWidth(62), 180),
      setTimeout(() => setWidth(78), 420),
      setTimeout(() => setWidth(86), 900),
    );
  };

  const finish = () => {
    clearTimers();
    setWidth(100);
    setActive(false);
    timers.current.push(
      setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 220),
    );
  };

  useEffect(() => {
    const onStart = () => start();
    window.addEventListener("orca:nav-start", onStart);
    return () => {
      window.removeEventListener("orca:nav-start", onStart);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    // Route committed — complete the bar
    finish();
  }, [pathname]);

  if (!visible && width === 0) return null;

  return (
    <div
      className="orca-route-progress"
      aria-hidden
      data-active={active ? "1" : "0"}
    >
      <div className="orca-route-progress-bar" style={{ width: `${width}%` }} />
    </div>
  );
}

export function signalNavStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("orca:nav-start"));
}

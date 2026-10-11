"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setVisible(true);
    setActive(true);
    setWidth(28);
    // Tăng tốc độ phản hồi thanh tiến trình khi người dùng nhấn chuyển trang
    timers.current.push(
      setTimeout(() => setWidth(65), 60),
      setTimeout(() => setWidth(85), 180),
      setTimeout(() => setWidth(93), 400),
    );
  }, [clearTimers]);

  const finish = useCallback(() => {
    clearTimers();
    setWidth(100);
    setActive(false);
    timers.current.push(
      setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 260),
    );
  }, [clearTimers]);

  useEffect(() => {
    const onStart = () => start();
    window.addEventListener("orca:nav-start", onStart);
    return () => {
      window.removeEventListener("orca:nav-start", onStart);
      clearTimers();
    };
  }, [start, clearTimers]);

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    // Route committed — complete the bar
    finish();
  }, [pathname, finish]);

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

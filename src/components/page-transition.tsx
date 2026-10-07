"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Soft page enter on every client navigation.
 * Avoids opacity:0 (blank flash + jank while React mounts heavy trees).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="orca-page-enter">
      {children}
    </div>
  );
}

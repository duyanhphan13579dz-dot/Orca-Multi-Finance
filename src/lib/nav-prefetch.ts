"use client";

import { prefetchApi } from "@/lib/hooks";

/**
 * P4-A: warm hot APIs for a nav route on hover/intent.
 */
export function prefetchRouteApis(href: string): void {
  const path = (href.split("#")[0] || href).trim();
  const apis: string[] = [];
  if (path === "/" || path === "") {
    apis.push("/api/v1/stocks?board=vn30", "/api/v1/market/intel", "/api/v1/market/global");
  } else if (path === "/stocks" || path.startsWith("/stocks/")) {
    apis.push("/api/v1/stocks?board=vn30", "/api/v1/stocks?board=full");
  } else if (path === "/crypto" || path.startsWith("/crypto/")) {
    apis.push("/api/v1/crypto/markets");
  } else if (path === "/forex" || path.startsWith("/forex/")) {
    apis.push("/api/v1/forex/markets");
  } else if (path === "/commodities") {
    apis.push("/api/v1/commodities");
  } else if (path === "/screener" || path.startsWith("/screener")) {
    apis.push("/api/v1/screener/fundamental", "/api/v1/screener/valuation");
  } else if (path.includes("multi") || path === "/heatmap") {
    apis.push("/api/v1/market/multi-asset");
  }
  for (const u of apis) prefetchApi(u, 8_000);
}

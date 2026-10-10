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
    apis.push("/api/v1/crypto/markets?limit=120", "/api/v1/crypto/markets?limit=60");
  } else if (path === "/forex" || path.startsWith("/forex/")) {
    apis.push("/api/v1/forex/markets");
  } else if (path === "/commodities") {
    apis.push("/api/v1/commodities");
  } else if (path === "/screener" || path.startsWith("/screener")) {
    apis.push(
      "/api/v1/stocks?symbols=VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD",
      "/api/v1/screener/fundamental",
      "/api/v1/screener/valuation",
      "/api/v1/screener/canslim",
    );
  } else if (path.includes("multi") || path === "/heatmap") {
    apis.push("/api/v1/stocks?board=full", "/api/v1/crypto/markets?limit=60");
  } else if (path === "/news" || path.startsWith("/news")) {
    apis.push("/api/v1/news?limit=50", "/api/v1/news/sentiment?limit=40");
  } else if (path === "/reports" || path.startsWith("/reports")) {
    apis.push("/api/v1/reports?type=morning_brief&limit=7");
  } else if (path === "/derivatives" || path.startsWith("/derivatives")) {
    apis.push(
      "/api/v1/derivatives/snapshot?core=1",
      "/api/v1/derivatives/regime?underlying=VN30",
      "/api/v1/derivatives/VN30F1M/scalp?tf=5m",
    );
  } else if (path === "/macro-economic") {
    apis.push("/api/v1/macro-economic");
  } else if (path === "/currency-interest-rate") {
    apis.push("/api/v1/currency-interest-rate");
  } else if (path === "/watchlist") {
    apis.push("/api/v1/watchlist", "/api/v1/crypto/markets?limit=300", "/api/v1/forex/markets");
  } else if (path === "/portfolio") {
    apis.push("/api/v1/portfolio", "/api/v1/crypto/markets?limit=300", "/api/v1/forex/markets");
  } else if (path.startsWith("/personal-finance")) {
    apis.push("/api/v1/personal-finance/state");
  }
  for (const u of apis) prefetchApi(u, 8_000);
}

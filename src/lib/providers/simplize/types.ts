/**
 * Simplize provider types — capabilities, verdicts and the ONLY sanctioned
 * access surface (widget embed). These types describe ACCESS RIGHTS, not page
 * scraping schemas: no code in this module parses Simplize stock pages.
 */

export const SIMPLIZE_PROVIDER = "simplize";

export const SIMPLIZE_EVIDENCE = {
  robots: "https://simplize.vn/robots.txt",
  terms: "https://simplize.vn/terms",
  llms: "https://simplize.vn/llms.txt",
  widget: "https://simplize.vn/widget-embed",
  apiHostProbe: "https://api.simplize.vn/ (404 — internal Spring Boot host, no public API)",
  stockPage: "https://simplize.vn/co-phieu/VNM",
  chartPage: "https://simplize.vn/chart?ticker=HPG",
  pricing: "https://simplize.vn/pricing",
  contact: "info@simplize.vn (Hợp tác dữ liệu (API) — per llms.txt)",
} as const;

/* --------------------------- data type registry --------------------------- */

export type VnDataType =
  | "market-indices"
  | "stock-quotes"
  | "chart-history"
  | "stock-detail"
  | "financial-statements"
  | "valuation-fundamentals"
  | "order-book"
  | "buy-sell-signals"
  | "analysis-reports";

/** access-method verdict — strictly evidence-based, no assumptions */
export type AccessStatus =
  | "OFFICIAL-PUBLIC-API" // documented, license-granted API (none found)
  | "PUBLIC-PAGE" // rendered page content (not an API)
  | "WIDGET-EMBED" // explicitly offered embed for visualization
  | "INTERNAL-API" // browser/internal endpoint — NOT official
  | "NO-ACCESS" // not published at all
  | "PARTNERSHIP-REQ"; // exists (pricing/llms) but requires written agreement

export type RealtimeStatus =
  | "REALTIME-PAGE-CLAIM" // site self-describes realtime; not verifiable via API
  | "LIVE-VIA-EMBED" // embed widget updates continuously (visualization only)
  | "DELAYED"
  | "N/A";

export type UsageStatus =
  | "PRODUCTION" // full backend ingestion + redistribution
  | "EMBED-ONLY" // sanctioned visualization embed only
  | "CITATION-ONLY" // link/short quote with source attribution only
  | "NOT-PERMITTED" // terms/llms prohibit backend copying/redistribution
  | "UNAVAILABLE"; // no access path

export interface VnDataCapability {
  dataType: VnDataType;
  /** ORCA module that would consume this data type */
  orcaModule: string;
  /** does Simplize actually publish this data (public page evidence)? */
  simplizeSupport: boolean;
  /** how a client could reach it — never a secret/internal endpoint list for production */
  accessMethod: string;
  officialStatus: AccessStatus;
  /** realtime/delayed label — never claim REALTIME from an unverified page */
  realtime: RealtimeStatus;
  rateLimit: string;
  cachePolicy: "not-permitted-redistribution" | "embed-only" | "citation-only" | "n-a";
  productionUsable: UsageStatus;
  /** verified URLs / documents backing this row */
  evidence: string[];
  note: string;
}

/* ----------------------------- embed descriptor ----------------------------- */

export interface SimplizeEmbedDescriptor {
  kind: "stock-chart";
  symbol: string;
  url: string;
  timeframe: string;
  /** the ONLY sanctioned use = visualization embed in the user's browser */
  allowedUse: "embed-visualization";
  source: typeof SIMPLIZE_PROVIDER;
  note: string;
}

export type SimplizeVerdict = "OPTION_A_FULL" | "OPTION_B_HYBRID" | "OPTION_C_EMBED_ONLY";

export interface SimplizeAuditDecision {
  verdict: SimplizeVerdict;
  summary: string;
  partnershipContact: string;
  /** step-by-step migration plan with honest status (Phase 4) */
  migration: { step: number; module: string; status: "VNDIRECT" | "BLOCKED-RIGHTS" | "EMBED-ONLY" | "CITATION-ONLY"; reason: string }[];
}

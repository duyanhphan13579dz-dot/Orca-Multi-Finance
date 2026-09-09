/** Financial Report Data Reliability Layer — public surface. */

export { getFinancialPackage, getFinancialsForSymbol } from "./service";
export { listFinancialProviders } from "./providers-registry";
export { runSourceRouter } from "./provider";
export type { FinancialProvider, RouterOutcome } from "./provider";
export { decideFallback, applyFallbackToMeta } from "./fallback";
export type { FallbackDecision, FallbackLevel } from "./fallback";
export { getFinancialSourceHealth } from "./source-health";
export { getFinancialMonitorSnapshot } from "./monitor";
export { scoreFinancialQuality, crossValidatePeriods } from "./validation";
export { getOfficialFilingsForSymbol, runOfficialDocumentPipeline } from "./official/pipeline";
export type * from "./types";

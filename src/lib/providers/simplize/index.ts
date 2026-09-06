export { CAPABILITY_MATRIX, getCapability, capabilityReport, SIMPLIZE_DECISION, decisionReport } from "./capabilities";
export { SimplizeClient, type WidgetProbe, type EmbedUrlResult } from "./client";
export { normalizeEmbedDescriptor, validateEmbedDescriptor, EMBED_TIMEFRAMES } from "./adapter";
export { SimplizeProvider, simplizeProvider } from "./provider";
export { SIMPLIZE_PROVIDER, SIMPLIZE_EVIDENCE } from "./types";
export type {
  VnDataCapability,
  AccessStatus,
  RealtimeStatus,
  UsageStatus,
  VnDataType,
  SimplizeEmbedDescriptor,
  SimplizeVerdict,
  SimplizeAuditDecision,
} from "./types";

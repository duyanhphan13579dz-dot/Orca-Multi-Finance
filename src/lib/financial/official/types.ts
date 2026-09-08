/**
 * Phase 2 — Official Document Pipeline types.
 * Metadata-first: always store discovery results even when PDF text is not yet extractable.
 */

export type FilingKind =
  | "quarterly_fs"
  | "semi_annual_fs"
  | "annual_fs"
  | "audited_annual"
  | "reviewed_interim"
  | "operational_monthly"
  | "disclosure_other"
  | "unknown";

export type FilingSourceChannel =
  | "ssc_ids"
  | "hose_disclosure"
  | "hnx_disclosure"
  | "company_ir"
  | "vndirect_fs_meta"
  | "vndirect_events"
  | "manual";

export interface OfficialFiling {
  id: string;
  ticker: string;
  kind: FilingKind;
  title: string;
  period: string | null;
  periodType: "quarter" | "semi" | "year" | "month" | "unknown";
  fiscalDate: string | null;
  filingDate: string | null;
  disclosureDate: string | null;
  statementScope: "consolidated" | "standalone" | "unknown";
  auditStatus: "audited" | "reviewed" | "unaudited" | "unknown";
  sourceChannel: FilingSourceChannel;
  sourceUrl: string | null;
  documentUrl: string | null;
  mimeType: string | null;
  confidence: number;
  rawNote?: string;
}

export interface FilingDiscoveryResult {
  ticker: string;
  filings: OfficialFiling[];
  discoveredAt: string;
  channelsAttempted: FilingSourceChannel[];
  notes: string[];
}

export interface ExtractedReportPayload {
  filingId: string;
  ticker: string;
  extractedAt: string;
  method: "pdf_text" | "html" | "structured_api" | "none";
  success: boolean;
  textPreview: string | null;
  metricsHint: Record<string, number> | null;
  error?: string;
}

export interface DocumentStoreRecord {
  filing: OfficialFiling;
  storedAt: string;
  extraction: ExtractedReportPayload | null;
  version: number;
}

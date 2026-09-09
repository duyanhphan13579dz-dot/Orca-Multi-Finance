import "server-only";
import { createHash } from "crypto";
import type { OfficialFiling } from "./types";

export interface DownloadedDocument {
  filingId: string;
  url: string;
  ok: boolean;
  statusCode: number | null;
  mimeType: string | null;
  byteLength: number;
  contentHash: string | null;
  buffer: Buffer | null;
  error?: string;
}

/** Download filing document bytes when documentUrl is present. */
export async function downloadFilingDocument(filing: OfficialFiling): Promise<DownloadedDocument> {
  const url = filing.documentUrl;
  if (!url) {
    return {
      filingId: filing.id,
      url: "",
      ok: false,
      statusCode: null,
      mimeType: null,
      byteLength: 0,
      contentHash: null,
      buffer: null,
      error: "missing_document_url",
    };
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OrcaFinancial-OfficialPipeline/1.0", Accept: "*/*" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        filingId: filing.id,
        url,
        ok: false,
        statusCode: res.status,
        mimeType: res.headers.get("content-type"),
        byteLength: 0,
        contentHash: null,
        buffer: null,
        error: `HTTP ${res.status}`,
      };
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    // Cap in-memory store at 8MB for safety
    if (buffer.length > 8 * 1024 * 1024) {
      const hash = createHash("sha256").update(buffer.subarray(0, 1024 * 1024)).digest("hex");
      return {
        filingId: filing.id,
        url,
        ok: true,
        statusCode: res.status,
        mimeType: res.headers.get("content-type"),
        byteLength: buffer.length,
        contentHash: `partial:${hash}`,
        buffer: null,
        error: "file_too_large_metadata_only",
      };
    }
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    return {
      filingId: filing.id,
      url,
      ok: true,
      statusCode: res.status,
      mimeType: res.headers.get("content-type"),
      byteLength: buffer.length,
      contentHash,
      buffer,
    };
  } catch (e) {
    return {
      filingId: filing.id,
      url,
      ok: false,
      statusCode: null,
      mimeType: null,
      byteLength: 0,
      contentHash: null,
      buffer: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "download_error",
    };
  }
}

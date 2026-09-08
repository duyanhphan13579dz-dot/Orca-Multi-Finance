import "server-only";
import type { ExtractedReportPayload, OfficialFiling } from "./types";

/**
 * FinancialReportExtractor — Phase 2.
 * When documentUrl is absent, returns method=none (honest).
 * PDF binary parse can be plugged here later without changing callers.
 */
export async function extractReport(filing: OfficialFiling): Promise<ExtractedReportPayload> {
  const base = {
    filingId: filing.id,
    ticker: filing.ticker,
    extractedAt: new Date().toISOString(),
    metricsHint: null as Record<string, number> | null,
  };

  if (!filing.documentUrl) {
    return {
      ...base,
      method: "none",
      success: false,
      textPreview: null,
      error: "Không có documentUrl — chờ cổng SSC/HOSE/IR hoặc SSI.",
    };
  }

  try {
    const res = await fetch(filing.documentUrl, {
      headers: { "User-Agent": "OrcaFinancial/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        ...base,
        method: "none",
        success: false,
        textPreview: null,
        error: `HTTP ${res.status}`,
      };
    }
    const ct = res.headers.get("content-type") ?? filing.mimeType ?? "";
    const buf = Buffer.from(await res.arrayBuffer());

    if (/pdf/i.test(ct) || filing.documentUrl.toLowerCase().endsWith(".pdf")) {
      // Lightweight: store size + magic header only (no fabricated text).
      const magic = buf.subarray(0, 5).toString("utf8");
      const isPdf = magic.startsWith("%PDF");
      return {
        ...base,
        method: "pdf_text",
        success: isPdf,
        textPreview: isPdf ? `[PDF ${buf.length} bytes — parser chi tiết sẽ gắn Phase 2.1]` : null,
        error: isPdf ? undefined : "File không phải PDF hợp lệ",
      };
    }

    if (/html|text/i.test(ct)) {
      const text = buf.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return {
        ...base,
        method: "html",
        success: text.length > 40,
        textPreview: text.slice(0, 400),
      };
    }

    return {
      ...base,
      method: "none",
      success: false,
      textPreview: null,
      error: `MIME không hỗ trợ: ${ct || "unknown"}`,
    };
  } catch (e) {
    return {
      ...base,
      method: "none",
      success: false,
      textPreview: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "extract_error",
    };
  }
}

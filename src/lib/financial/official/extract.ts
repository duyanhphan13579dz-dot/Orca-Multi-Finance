import "server-only";
import type { ExtractedReportPayload, OfficialFiling } from "./types";
import { downloadFilingDocument } from "./download";

/**
 * FinancialReportExtractor — Phase 2 complete path.
 * 1) Download document
 * 2) PDF: extract readable Latin/VN text from content streams (best-effort)
 * 3) HTML: strip tags
 * Never fabricates financial metrics from partial parse.
 */

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  if (!raw.startsWith("%PDF")) return "";

  const chunks: string[] = [];
  // Match parentheses strings inside content streams (simple PDF text operators)
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const body = m[1];
    const parenRe = /\((?:\\.|[^\\)]){2,200}\)/g;
    let p: RegExpExecArray | null;
    while ((p = parenRe.exec(body))) {
      const inner = p[0].slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
      if (/[A-Za-zÀ-ỹ0-9]{3,}/.test(inner)) chunks.push(inner);
    }
    // Tj / TJ operators with hex strings
    const hexRe = /<([0-9A-Fa-f]{4,})>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(body))) {
      try {
        const hex = h[1];
        if (hex.length % 2 !== 0) continue;
        const bytes = Buffer.from(hex, "hex");
        const s = bytes.toString("utf8").replace(/\u0000/g, "");
        if (/[A-Za-zÀ-ỹ0-9]{3,}/.test(s)) chunks.push(s);
      } catch {
        /* ignore */
      }
    }
  }

  const text = chunks.join(" ").replace(/\s+/g, " ").trim();
  return text.slice(0, 8000);
}

function extractHtmlText(buffer: Buffer): string {
  return buffer
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

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
      error: "Không có documentUrl — metadata-only filing.",
    };
  }

  const dl = await downloadFilingDocument(filing);
  if (!dl.ok || !dl.buffer) {
    return {
      ...base,
      method: "none",
      success: false,
      textPreview: null,
      error: dl.error ?? "download_failed",
    };
  }

  const ct = (dl.mimeType ?? "").toLowerCase();
  const isPdf =
    /pdf/.test(ct) || filing.documentUrl.toLowerCase().endsWith(".pdf") || dl.buffer.subarray(0, 4).toString() === "%PDF";

  if (isPdf) {
    const text = extractPdfText(dl.buffer);
    return {
      ...base,
      method: "pdf_text",
      success: text.length > 40,
      textPreview: text.length ? text.slice(0, 500) : `[PDF ${dl.byteLength} bytes hash=${dl.contentHash?.slice(0, 12)}]`,
      error: text.length > 40 ? undefined : "PDF text layer sparse — cần OCR Phase 2.1 nếu là scan",
    };
  }

  if (/html|text|xml/.test(ct) || filing.documentUrl.match(/\.html?$/i)) {
    const text = extractHtmlText(dl.buffer);
    return {
      ...base,
      method: "html",
      success: text.length > 40,
      textPreview: text.slice(0, 500),
    };
  }

  return {
    ...base,
    method: "none",
    success: false,
    textPreview: null,
    error: `MIME không hỗ trợ: ${ct || "unknown"}`,
  };
}

import "server-only";
import { classifyFiling } from "./classify";
import {
  openSscNewsSearch,
  adfSearchByTicker,
  adfTryDownloadRow,
  SSC_BASE,
} from "./adf-client";
import type { OfficialFiling } from "./types";

export interface SscScrapedRow {
  stt: string;
  floor: string;
  ticker: string;
  reportName: string;
  company: string;
  summary: string;
  submittedAt: string;
  rowIndex: number;
}

export interface SscScrapeResult {
  ok: boolean;
  rows: SscScrapedRow[];
  filings: OfficialFiling[];
  latencyMs: number;
  method: "adf_html" | "adf_ppr" | "none";
  notes: string[];
  /** When PDF bytes were captured for a row (rare — ADF postback). */
  downloaded?: { rowIndex: number; contentType: string; size: number }[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function readCellById(html: string, row: number, col: string): string {
  const marker = `id="pt9:t1:${row}:c${col}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const gt = html.indexOf(">", start);
  if (gt < 0) return "";
  const end = html.indexOf("</td>", gt);
  if (end < 0) return "";
  return stripTags(html.slice(gt + 1, end));
}

/** Strategy A: stable ADF clientIds pt9:t1:{i}:c* */
function parseByClientIds(html: string): SscScrapedRow[] {
  const idxs = new Set<number>();
  for (const m of html.matchAll(/id="pt9:t1:(\d+):c/g)) idxs.add(Number(m[1]));
  const rows: SscScrapedRow[] = [];
  for (const i of [...idxs].sort((a, b) => a - b)) {
    const ticker = readCellById(html, i, "5");
    const reportName = readCellById(html, i, "3");
    if (!reportName && !ticker) continue;
    rows.push({
      stt: readCellById(html, i, "12"),
      floor: readCellById(html, i, "2"),
      ticker: ticker.toUpperCase(),
      reportName,
      company: readCellById(html, i, "8"),
      summary: readCellById(html, i, "111"),
      submittedAt: readCellById(html, i, "7"),
      rowIndex: i,
    });
  }
  return rows;
}

/** Strategy B: role=row + gridcell order (markup-version resilient). */
function parseByRoleRows(html: string): SscScrapedRow[] {
  const rows: SscScrapedRow[] = [];
  const trRe = /<tr[^>]*role="row"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<td[^>]*role="gridcell"[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      stripTags(c[1]),
    );
    // Expected: STT, floor, MCK, reportName, company, summary, date, download
    if (cells.length < 6) continue;
    const stt = cells[0];
    if (!/^\d+$/.test(stt)) continue;
    const floor = cells[1] ?? "";
    const ticker = (cells[2] ?? "").toUpperCase();
    const reportName = cells[3] ?? "";
    if (!reportName && !ticker) continue;
    rows.push({
      stt,
      floor,
      ticker,
      reportName,
      company: cells[4] ?? "",
      summary: cells[5] ?? "",
      submittedAt: cells[6] ?? "",
      rowIndex: idx++,
    });
  }
  return rows;
}

/** Strategy C: report title anchors + nearby ticker span. */
function parseByTitleAnchors(html: string): SscScrapedRow[] {
  const rows: SscScrapedRow[] = [];
  const re =
    /id="pt9:t1:(\d+):cl1"[^>]*>([^<]+)<[\s\S]{0,1200}?id="pt9:t1:\1:c5"[^>]*>[\s\S]*?<span[^>]*>([^<]*)<\/span>/gi;
  // fallback simpler: find ACC-like near report names
  const titles = [...html.matchAll(/>(Báo cáo tài chính[^<]{0,80})<\/a>/gi)];
  let i = 0;
  for (const t of titles) {
    const start = Math.max(0, t.index! - 500);
    const chunk = html.slice(start, t.index! + 800);
    const tick = chunk.match(/>([A-Z]{2,5})<\/span>/)?.[1] ?? "";
    const date = chunk.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "";
    rows.push({
      stt: String(i + 1),
      floor: chunk.includes("HOSE") ? "HOSE" : chunk.includes("HNX") ? "HNX" : "",
      ticker: tick,
      reportName: stripTags(t[1]),
      company: "",
      summary: "",
      submittedAt: date,
      rowIndex: i++,
    });
  }
  void re;
  return rows;
}

/** Multi-strategy parse — survives minor ADF id renames. */
export function parseSscTableHtml(html: string): SscScrapedRow[] {
  const a = parseByClientIds(html);
  if (a.length >= 3) return a;
  const b = parseByRoleRows(html);
  if (b.length >= 3) return b;
  const c = parseByTitleAnchors(html);
  return c.length ? c : a.length ? a : b;
}

function parseVnDate(dmy: string): string | null {
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function rowsToFilings(rows: SscScrapedRow[], filterTicker?: string): OfficialFiling[] {
  const sym = filterTicker?.toUpperCase();
  const out: OfficialFiling[] = [];
  for (const r of rows) {
    if (sym && r.ticker && r.ticker !== sym) continue;
    if (sym && !r.ticker) continue;

    const title = r.reportName || r.summary || "BCTC SSC";
    const cls = classifyFiling({ title, typeDesc: r.summary });
    const filingDate = parseVnDate(r.submittedAt);
    const ticker = r.ticker || sym || "UNKNOWN";

    out.push({
      id: `ssc:${ticker}:${r.submittedAt}:${r.rowIndex}:${cls.kind}`,
      ticker,
      kind: cls.kind === "unknown" ? "quarterly_fs" : cls.kind,
      title,
      period: null,
      periodType: cls.periodType,
      fiscalDate: null,
      filingDate,
      disclosureDate: filingDate,
      statementScope: /hợp nhất|hop nhat/i.test(title + r.summary)
        ? "consolidated"
        : /mẹ|riêng|me |rieng/i.test(title + r.summary)
          ? "standalone"
          : cls.statementScope,
      auditStatus: /kiểm toán|kiem toan/i.test(title + r.summary)
        ? "audited"
        : /soát xét|soat xet/i.test(title + r.summary)
          ? "reviewed"
          : cls.auditStatus,
      sourceChannel: "ssc_ids",
      sourceUrl: `${SSC_BASE}/faces/NewsSearch`,
      documentUrl: null,
      mimeType: null,
      confidence: 0.94,
      rawNote: [r.floor && `Sàn ${r.floor}`, r.company, r.summary].filter(Boolean).join(" · "),
    });
  }
  return out;
}

export async function scrapeSscFilings(symbol?: string): Promise<SscScrapeResult> {
  const notes: string[] = [];
  try {
    const session = await openSscNewsSearch();
    notes.push(
      `ADF session ${session.afrLoop ? "ok" : "partial"} · html=${session.html.length}B · ${session.latencyMs}ms`,
    );

    let html = session.html;
    let method: SscScrapeResult["method"] = "adf_html";

    if (symbol) {
      const searched = await adfSearchByTicker(session, symbol);
      notes.push(`PPR search: ${searched.note}`);
      if (searched.ok) {
        html = searched.html;
        method = "adf_ppr";
      }
    }

    let rows = parseSscTableHtml(html);
    notes.push(`Parsed ${rows.length} rows (multi-strategy)`);

    // Client-side ticker filter when PPR did not replace the grid
    if (symbol && rows.length && !rows.some((r) => r.ticker === symbol.toUpperCase())) {
      notes.push(`Ticker ${symbol.toUpperCase()} not on current ADF page — returning empty match (latest listing only).`);
    }

    if (!rows.length) {
      return {
        ok: false,
        rows: [],
        filings: [],
        latencyMs: session.latencyMs,
        method: "none",
        notes: [...notes, "No table rows — portal markup may have changed"],
      };
    }

    // Optional: try first matched row PDF (only when ticker matched or no filter)
    const downloaded: NonNullable<SscScrapeResult["downloaded"]> = [];
    const tryRows = symbol
      ? rows.filter((r) => r.ticker === symbol.toUpperCase()).slice(0, 1)
      : rows.slice(0, 0); // skip bulk download without filter
    for (const r of tryRows) {
      const dl = await adfTryDownloadRow(session, r.rowIndex);
      notes.push(`PDF row ${r.rowIndex}: ${dl.note}`);
      if (dl.ok && dl.bytes) {
        downloaded.push({
          rowIndex: r.rowIndex,
          contentType: dl.contentType ?? "application/octet-stream",
          size: dl.bytes.byteLength,
        });
      }
    }

    const filings = rowsToFilings(rows, symbol);
    notes.push(
      symbol
        ? `Matched ${filings.length} filings for ${symbol.toUpperCase()}`
        : `Returning ${filings.length} latest filings`,
    );

    return {
      ok: filings.length > 0 || rows.length > 0,
      rows,
      filings,
      latencyMs: session.latencyMs,
      method,
      notes,
      downloaded: downloaded.length ? downloaded : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      filings: [],
      latencyMs: 0,
      method: "none",
      notes: [e instanceof Error ? e.message.slice(0, 160) : "ssc_scrape_error"],
    };
  }
}

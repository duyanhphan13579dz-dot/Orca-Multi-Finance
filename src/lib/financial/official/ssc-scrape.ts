import "server-only";
import { classifyFiling } from "./classify";
import { openSscNewsSearch, adfSearchByTicker, SSC_BASE } from "./adf-client";
import type { OfficialFiling } from "./types";

export interface SscScrapedRow {
  stt: string;
  floor: string;
  ticker: string;
  reportName: string;
  company: string;
  summary: string;
  submittedAt: string; // DD/MM/YYYY
  rowIndex: number;
}

export interface SscScrapeResult {
  ok: boolean;
  rows: SscScrapedRow[];
  filings: OfficialFiling[];
  latencyMs: number;
  method: "adf_html" | "adf_ppr" | "none";
  notes: string[];
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

/** Parse pt9:t1:{i}:c* grid cells from ADF rendered HTML. */
export function parseSscTableHtml(html: string): SscScrapedRow[] {
  const rows: SscScrapedRow[] = [];
  // Detect max row index present
  const idxs = new Set<number>();
  for (const m of html.matchAll(/id="pt9:t1:(\d+):c/g)) {
    idxs.add(Number(m[1]));
  }
  const sorted = [...idxs].sort((a, b) => a - b);

  for (const i of sorted) {
    const cell = (col: string): string => {
      const re = new RegExp(`id="pt9:t1:${i}:c${col}"[^>]*>([\\s\\S]*?)</td>`, "i");
      const m = html.match(re);
      return m ? stripTags(m[1]) : "";
    };
    const ticker = cell("5");
    const reportName = cell("3");
    if (!reportName && !ticker) continue;
    rows.push({
      stt: cell("12"),
      floor: cell("2"),
      ticker: ticker.toUpperCase(),
      reportName,
      company: cell("8"),
      summary: cell("111"),
      submittedAt: cell("7"),
      rowIndex: i,
    });
  }
  return rows;
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
    // Keep rows without ticker only if no filter
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
      auditStatus: /kiểm toán|kiem toan|soát xét|soat xet/i.test(title + r.summary)
        ? /soát xét|soat xet/i.test(title + r.summary)
          ? "reviewed"
          : "audited"
        : cls.auditStatus,
      sourceChannel: "ssc_ids",
      sourceUrl: `${SSC_BASE}/faces/NewsSearch`,
      documentUrl: null, // download needs ADF commandLink postback
      mimeType: null,
      confidence: 0.94,
      rawNote: [r.floor && `Sàn ${r.floor}`, r.company, r.summary].filter(Boolean).join(" · "),
    });
  }
  return out;
}

/**
 * Scrape SSC NewsSearch listing via ADF HTML (optimized — no headless browser).
 * When symbol provided: try PPR search, then filter rows by MCK.
 */
export async function scrapeSscFilings(symbol?: string): Promise<SscScrapeResult> {
  const notes: string[] = [];
  try {
    const session = await openSscNewsSearch();
    notes.push(`ADF session ${session.afrLoop ? "ok" : "partial"} · ${session.latencyMs}ms`);

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

    const rows = parseSscTableHtml(html);
    notes.push(`Parsed ${rows.length} rows from ADF table`);

    if (!rows.length) {
      return {
        ok: false,
        rows: [],
        filings: [],
        latencyMs: session.latencyMs,
        method: "none",
        notes: [...notes, "No pt9:t1 grid cells — portal markup may have changed"],
      };
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

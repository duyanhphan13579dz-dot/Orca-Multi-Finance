import "server-only";
import type { OfficialFiling } from "./types";
import { getSscCalendar, type SscCalendarSnapshot, type SscReportKind } from "./ssc-calendar";
import { scrapeSscFilings } from "./ssc-scrape";
import { lookupSscIndex } from "./ssc-listing-index";
import { headlessScrapeSsc } from "./ssc-headless";
import { env } from "../../env";

export const SSC_PORTAL_BASE = env.sscPortalUrl;

export const SSC_NEWS_SEARCH_URL = env.sscNewsSearchUrl;

export interface SscPortalProbe {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  portalUrl: string;
  searchUrl: string;
  note: string;
}

export async function probeSscPortal(): Promise<SscPortalProbe> {
  const t0 = performance.now();
  try {
    const res = await fetch(SSC_NEWS_SEARCH_URL, {
      method: "GET",
      headers: {
        "User-Agent": "OrcaFinancial-SSC/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    const latencyMs = Math.round(performance.now() - t0);
    return {
      ok: res.ok,
      statusCode: res.status,
      latencyMs,
      portalUrl: SSC_PORTAL_BASE,
      searchUrl: SSC_NEWS_SEARCH_URL,
      note: res.ok ? "SSC portal reachable." : `SSC portal HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.round(performance.now() - t0),
      portalUrl: SSC_PORTAL_BASE,
      searchUrl: SSC_NEWS_SEARCH_URL,
      note: e instanceof Error ? e.message.slice(0, 160) : "ssc_unreachable",
    };
  }
}

function kindToFilingKind(kind: SscReportKind): OfficialFiling["kind"] {
  if (kind === "ANNUAL") return "annual_fs";
  return "quarterly_fs";
}

function kindToPeriodType(kind: SscReportKind): OfficialFiling["periodType"] {
  if (kind === "ANNUAL") return "year";
  return "quarter";
}

export function buildExpectedWindowFilings(
  symbol: string,
  calendar: SscCalendarSnapshot,
  portalOk: boolean,
): OfficialFiling[] {
  const sym = symbol.toUpperCase();
  const searchWithHint = `${SSC_NEWS_SEARCH_URL}?searchString=${encodeURIComponent(sym)}`;
  return calendar.expectedReports.map((exp, idx) => ({
    id: `${sym}:ssc_ids:expected:${exp.kind}:${exp.fiscalYear}:${idx}`,
    ticker: sym,
    kind: kindToFilingKind(exp.kind),
    title: `SSC — Kỳ vọng công bố ${exp.kind === "ANNUAL" ? `năm ${exp.fiscalYear}` : exp.kind + "/" + exp.fiscalYear} · ${sym}`,
    period: exp.periodLabel,
    periodType: kindToPeriodType(exp.kind),
    fiscalDate: null,
    filingDate: calendar.asOf,
    disclosureDate: calendar.asOf,
    statementScope: "unknown" as const,
    auditStatus: exp.kind === "ANNUAL" ? ("audited" as const) : ("unknown" as const),
    sourceChannel: "ssc_ids" as const,
    sourceUrl: searchWithHint,
    documentUrl: null,
    mimeType: null,
    confidence: portalOk ? 0.95 : 0.7,
    rawNote: `Cửa sổ công bố SSC (${calendar.asOf}) — kỳ vọng ${exp.periodLabel}.`,
  }));
}

export function buildSscCatalogFilings(symbol: string, portalOk: boolean): OfficialFiling[] {
  const sym = symbol.toUpperCase();
  const searchWithHint = `${SSC_NEWS_SEARCH_URL}?searchString=${encodeURIComponent(sym)}`;
  const kinds: { kind: OfficialFiling["kind"]; title: string; conf: number }[] = [
    { kind: "quarterly_fs", title: `SSC — Tra cứu BCTC quý · ${sym}`, conf: 0.92 },
    { kind: "semi_annual_fs", title: `SSC — Tra cứu BCTC bán niên · ${sym}`, conf: 0.9 },
    { kind: "annual_fs", title: `SSC — Tra cứu BCTC năm / kiểm toán · ${sym}`, conf: 0.93 },
    { kind: "disclosure_other", title: `SSC — Toàn bộ công bố thông tin · ${sym}`, conf: 0.88 },
  ];
  return kinds.map((k, idx) => ({
    id: `${sym}:ssc_ids:catalog:${k.kind}:${idx}`,
    ticker: sym,
    kind: k.kind,
    title: k.title,
    period: null,
    periodType:
      k.kind === "quarterly_fs"
        ? ("quarter" as const)
        : k.kind === "semi_annual_fs"
          ? ("semi" as const)
          : k.kind === "annual_fs"
            ? ("year" as const)
            : ("unknown" as const),
    fiscalDate: null,
    filingDate: null,
    disclosureDate: null,
    statementScope: "unknown" as const,
    auditStatus: k.kind === "annual_fs" ? ("audited" as const) : ("unknown" as const),
    sourceChannel: "ssc_ids" as const,
    sourceUrl: searchWithHint,
    documentUrl: null,
    mimeType: null,
    confidence: portalOk ? k.conf : Math.max(0.5, k.conf - 0.25),
    rawNote: "Catalog chính thức UBCKNN.",
  }));
}

/**
 * Cascade (→ 100% coverage path):
 * 1) Listing index cache (HTTP, nhanh — mã vừa công bố)
 * 2) Live ADF HTML scrape (+ PPR best-effort)
 * 3) Playwright headless nếu SSC_HEADLESS=1
 * 4) Expected window + catalog fallback
 */
export async function discoverFromSscPortal(symbol: string): Promise<{
  filings: OfficialFiling[];
  probe: SscPortalProbe;
  calendar: SscCalendarSnapshot;
  notes: string[];
}> {
  const calendar = getSscCalendar();
  const probe = await probeSscPortal();
  const filings: OfficialFiling[] = [];
  const notes: string[] = [
    `SSC portal: ${probe.ok ? "online" : "offline"} (${probe.latencyMs}ms)`,
    calendar.note,
  ];
  const seen = new Set<string>();
  const push = (list: OfficialFiling[]) => {
    for (const f of list) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      filings.push(f);
    }
  };

  // 1) Index cache
  try {
    const idx = await lookupSscIndex(symbol);
    notes.push(
      `Listing index: ${idx.index.tickerCount} tickers / ${idx.index.rowCount} rows · hit=${idx.hit}`,
    );
    if (idx.hit) {
      push(idx.filings);
      notes.push(`Index hit: ${idx.filings.length} filing(s) for ${symbol.toUpperCase()}`);
    }
  } catch (e) {
    notes.push(`Index error: ${e instanceof Error ? e.message.slice(0, 80) : "err"}`);
  }

  // 2) Live HTTP ADF scrape
  if (probe.ok) {
    try {
      const scraped = await scrapeSscFilings(symbol);
      notes.push(...scraped.notes.slice(0, 6));
      if (scraped.filings.length) {
        push(scraped.filings);
        notes.push(`HTTP scrape: +${scraped.filings.length} · method=${scraped.method}`);
      }
    } catch (e) {
      notes.push(`HTTP scrape error: ${e instanceof Error ? e.message.slice(0, 80) : "err"}`);
    }
  }

  // 3) Headless (optional)
  const needHeadless =
    !filings.some((f) => f.confidence >= 0.9 && f.sourceChannel === "ssc_ids" && f.filingDate) &&
    env.sscHeadless;
  if (needHeadless) {
    try {
      const hl = await headlessScrapeSsc(symbol, { downloadPdf: true, maxPdfs: 1 });
      notes.push(...hl.notes.slice(0, 8));
      if (hl.filings.length) {
        push(hl.filings);
        notes.push(`Headless: +${hl.filings.length} · pdfs=${hl.pdfs.length}`);
      }
    } catch (e) {
      notes.push(`Headless error: ${e instanceof Error ? e.message.slice(0, 80) : "err"}`);
    }
  } else if (!env.sscHeadless) {
    notes.push("Headless off — set SSC_HEADLESS=1 + install playwright for full ticker/PDF coverage");
  }

  // 4) Expected + catalog
  if (calendar.inDisclosureWindow || calendar.shouldAggressiveFetch) {
    push(buildExpectedWindowFilings(symbol, calendar, probe.ok));
  }
  push(buildSscCatalogFilings(symbol, probe.ok));

  notes.push(
    calendar.shouldAggressiveFetch
      ? "Mode: aggressive (disclosure window)"
      : "Mode: economy (outside window)",
  );

  return { filings, probe, calendar, notes };
}

import "server-only";
import type { OfficialFiling } from "./types";
import { getSscCalendar, type SscCalendarSnapshot, type SscReportKind } from "./ssc-calendar";
import { scrapeSscFilings } from "./ssc-scrape";

/**
 * SSC — Cổng công bố thông tin Ủy ban Chứng khoán Nhà nước
 * https://congbothongtin.ssc.gov.vn/
 *
 * Optimized path: Oracle ADF session → _afrLoop full HTML → parse table
 * (no headless browser for listing metadata).
 */

export const SSC_PORTAL_BASE =
  (process.env.SSC_PORTAL_URL ?? "https://congbothongtin.ssc.gov.vn").replace(/\/$/, "");

export const SSC_NEWS_SEARCH_URL =
  process.env.SSC_NEWS_SEARCH_URL ?? `${SSC_PORTAL_BASE}/faces/NewsSearch`;

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
      note: res.ok
        ? "SSC portal reachable — ADF scrape enabled."
        : `SSC portal HTTP ${res.status}`,
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
    rawNote: `Cửa sổ công bố SSC đang mở (${calendar.asOf}). Ưu tiên kiểm tra/cập nhật BCTC ${exp.periodLabel}.`,
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
    rawNote: portalOk
      ? "Nguồn chính thức UBCKNN. Catalog + ADF scrape listing."
      : "SSC portal offline — catalog thủ công.",
  }));
}

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

  // 1) Live ADF scrape (optimized)
  if (probe.ok) {
    try {
      const scraped = await scrapeSscFilings(symbol);
      notes.push(...scraped.notes);
      if (scraped.filings.length) {
        filings.push(...scraped.filings);
        notes.push(`ADF scrape: ${scraped.filings.length} filing(s) · method=${scraped.method}`);
      } else {
        notes.push("ADF scrape: không có dòng khớp mã trên trang hiện tại (thử PPR / trang mới nhất).");
      }
    } catch (e) {
      notes.push(`ADF scrape error: ${e instanceof Error ? e.message.slice(0, 100) : "error"}`);
    }
  }

  // 2) Expected window markers
  if (calendar.inDisclosureWindow || calendar.shouldAggressiveFetch) {
    filings.push(...buildExpectedWindowFilings(symbol, calendar, probe.ok));
  }

  // 3) Catalog fallback links
  filings.push(...buildSscCatalogFilings(symbol, probe.ok));

  notes.push(
    calendar.shouldAggressiveFetch
      ? "Chế độ lấy SSC: tích cực (cửa sổ công bố / gia hạn)."
      : "Chế độ lấy SSC: tiết kiệm (ngoài cửa sổ).",
  );

  return { filings, probe, calendar, notes };
}

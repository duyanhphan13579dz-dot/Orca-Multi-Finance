import "server-only";
import type { OfficialFiling } from "./types";

/**
 * SSC — Cổng công bố thông tin Ủy ban Chứng khoán Nhà nước
 * https://congbothongtin.ssc.gov.vn/
 * Search UI: /faces/NewsSearch (Oracle ADF — cần browser session để list/download PDF).
 *
 * Adapter này:
 * 1) Health-check portal
 * 2) Tạo filing catalog chính thức theo ticker (sourceUrl → trang search SSC)
 * 3) Không bịa danh sách PDF khi ADF không trả HTML tĩnh
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
        ? "SSC portal reachable (ADF UI — listing PDF cần session browser)."
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

/** Official catalog entries for a ticker — always prefer SSC as source-of-truth link. */
export function buildSscCatalogFilings(symbol: string, portalOk: boolean): OfficialFiling[] {
  const sym = symbol.toUpperCase();
  // Deep-link style: ADF may ignore query params; still useful as official entry point.
  const searchWithHint = `${SSC_NEWS_SEARCH_URL}?searchString=${encodeURIComponent(sym)}`;

  const kinds: { kind: OfficialFiling["kind"]; title: string; conf: number }[] = [
    {
      kind: "quarterly_fs",
      title: `SSC — Tra cứu BCTC quý · ${sym}`,
      conf: 0.92,
    },
    {
      kind: "semi_annual_fs",
      title: `SSC — Tra cứu BCTC bán niên · ${sym}`,
      conf: 0.9,
    },
    {
      kind: "annual_fs",
      title: `SSC — Tra cứu BCTC năm / kiểm toán · ${sym}`,
      conf: 0.93,
    },
    {
      kind: "disclosure_other",
      title: `SSC — Toàn bộ công bố thông tin · ${sym}`,
      conf: 0.88,
    },
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
    documentUrl: null, // PDF nằm sau session ADF — không giả lập URL file
    mimeType: null,
    confidence: portalOk ? k.conf : Math.max(0.5, k.conf - 0.25),
    rawNote: portalOk
      ? "Nguồn chính thức UBCKNN (congbothongtin.ssc.gov.vn). Mở link để tra cứu & tải PDF gốc."
      : "SSC portal không phản hồi lúc probe — vẫn giữ catalog chính thức để truy xuất thủ công.",
  }));
}

export async function discoverFromSscPortal(symbol: string): Promise<{
  filings: OfficialFiling[];
  probe: SscPortalProbe;
  notes: string[];
}> {
  const probe = await probeSscPortal();
  const filings = buildSscCatalogFilings(symbol, probe.ok);
  const notes: string[] = [
    `SSC portal: ${probe.ok ? "online" : "offline"} (${probe.latencyMs}ms) · ${SSC_NEWS_SEARCH_URL}`,
    "Cổng SSC dùng Oracle ADF — danh sách/PDF chi tiết cần tương tác UI; Orca gắn catalog + health-check chính thức.",
  ];
  if (!probe.ok) notes.push(`SSC probe: ${probe.note}`);
  return { filings, probe, notes };
}

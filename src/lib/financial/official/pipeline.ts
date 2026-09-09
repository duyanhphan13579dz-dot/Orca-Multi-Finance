import "server-only";
import { cached } from "../../cache";
import { discoverOfficialFilings } from "./discovery";
import { extractReport } from "./extract";
import { loadDocumentStore, markExtraction, upsertFilings } from "./storage";
import { getSscCalendar } from "./ssc-calendar";
import type { DocumentStoreRecord, FilingDiscoveryResult, OfficialFiling } from "./types";

export interface OfficialPipelineResult {
  discovery: FilingDiscoveryResult;
  store: DocumentStoreRecord[];
  latestFsFiling: OfficialFiling | null;
  extractedCount: number;
  sscCalendar: ReturnType<typeof getSscCalendar>;
  notes: string[];
}

/**
 * Official Document Pipeline
 * TTL ngắn trong cửa sổ công bố SSC → tự động "lấy lại" BCTC khi đến kỳ.
 */
export async function runOfficialDocumentPipeline(symbol: string): Promise<OfficialPipelineResult> {
  const sym = symbol.toUpperCase();
  const sscCalendar = getSscCalendar();
  const ttlMs = sscCalendar.suggestedCacheTtlMs;
  const cacheKey = `fin:official-pipeline:${sym}:v3:${sscCalendar.asOf}:${sscCalendar.shouldAggressiveFetch ? "hot" : "cold"}`;

  const res = await cached(cacheKey, {
    ttlMs,
    staleMs: 30 * 24 * 3_600_000,
    producer: async () => {
      const discovery = await discoverOfficialFilings(sym);
      const store = await upsertFilings(sym, discovery.filings);

      let extractedCount = 0;
      const withUrl = store.filter((r) => r.filing.documentUrl).slice(0, 5);
      for (const rec of withUrl) {
        if (rec.extraction?.success) {
          extractedCount += 1;
          continue;
        }
        const extraction = await extractReport(rec.filing);
        await markExtraction(sym, rec.filing.id, extraction);
        if (extraction.success) extractedCount += 1;
      }

      const refreshed = await loadDocumentStore(sym);
      return {
        discovery,
        store: refreshed.length ? refreshed : store,
        extractedCount,
      };
    },
  });

  const discovery = res.value.discovery;
  const store = res.value.store;
  const extractedCount = res.value.extractedCount ?? 0;
  const latestFsFiling =
    store
      .map((s) => s.filing)
      .find((f) =>
        ["quarterly_fs", "semi_annual_fs", "annual_fs", "audited_annual", "reviewed_interim"].includes(
          f.kind,
        ),
      ) ?? null;

  const notes = [...discovery.notes];
  notes.push(sscCalendar.note);
  if (sscCalendar.expectedReports.length) {
    notes.push(
      `Kỳ vọng BCTC trên SSC: ${sscCalendar.expectedReports.map((e) => e.periodLabel).join(", ")}`,
    );
  }
  if (latestFsFiling) {
    notes.push(
      `Filing BCTC gần nhất: ${latestFsFiling.period ?? latestFsFiling.title} · ${latestFsFiling.sourceChannel}`,
    );
  } else {
    notes.push("Chưa có filing BCTC phân loại rõ — catalog IR / SSC search vẫn có để truy xuất.");
  }
  notes.push(`Extraction thành công: ${extractedCount} · cacheTTL=${Math.round(ttlMs / 3_600_000)}h`);

  return { discovery, store, latestFsFiling, extractedCount, sscCalendar, notes };
}

export async function getOfficialFilingsForSymbol(symbol: string): Promise<OfficialPipelineResult> {
  return runOfficialDocumentPipeline(symbol);
}

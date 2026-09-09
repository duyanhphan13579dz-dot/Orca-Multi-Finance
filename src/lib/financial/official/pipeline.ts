import "server-only";
import { cached } from "../../cache";
import { discoverOfficialFilings } from "./discovery";
import { extractReport } from "./extract";
import { loadDocumentStore, markExtraction, upsertFilings } from "./storage";
import type { DocumentStoreRecord, FilingDiscoveryResult, OfficialFiling } from "./types";

export interface OfficialPipelineResult {
  discovery: FilingDiscoveryResult;
  store: DocumentStoreRecord[];
  latestFsFiling: OfficialFiling | null;
  extractedCount: number;
  notes: string[];
}

/**
 * Official Document Pipeline — Phase 2 (complete)
 * Discover → Classify → Store → Download+Extract (when URL exists)
 */
export async function runOfficialDocumentPipeline(symbol: string): Promise<OfficialPipelineResult> {
  const sym = symbol.toUpperCase();

  const res = await cached(`fin:official-pipeline:${sym}:v2`, {
    ttlMs: 6 * 3_600_000,
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
  if (latestFsFiling) {
    notes.push(
      `Filing BCTC gần nhất: ${latestFsFiling.period ?? latestFsFiling.title} · ${latestFsFiling.sourceChannel}`,
    );
  } else {
    notes.push("Chưa có filing BCTC phân loại rõ — catalog IR vẫn có để truy xuất.");
  }
  notes.push(`Extraction thành công: ${extractedCount} tài liệu có URL.`);

  return { discovery, store, latestFsFiling, extractedCount, notes };
}

export async function getOfficialFilingsForSymbol(symbol: string): Promise<OfficialPipelineResult> {
  return runOfficialDocumentPipeline(symbol);
}

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
  notes: string[];
}

/**
 * Official Document Pipeline — Phase 2
 * Discover → classify (inside discovery) → store → optional extract.
 */
export async function runOfficialDocumentPipeline(symbol: string): Promise<OfficialPipelineResult> {
  const sym = symbol.toUpperCase();

  const res = await cached(`fin:official-pipeline:${sym}:v1`, {
    ttlMs: 6 * 3_600_000,
    staleMs: 30 * 24 * 3_600_000,
    producer: async () => {
      const discovery = await discoverOfficialFilings(sym);
      const store = await upsertFilings(sym, discovery.filings);

      // Extract up to 3 newest docs that have URLs
      const withUrl = store.filter((r) => r.filing.documentUrl).slice(0, 3);
      for (const rec of withUrl) {
        if (rec.extraction?.success) continue;
        const extraction = await extractReport(rec.filing);
        await markExtraction(sym, rec.filing.id, extraction);
      }

      const refreshed = await loadDocumentStore(sym);
      return { discovery, store: refreshed.length ? refreshed : store };
    },
  });

  const discovery = res.value.discovery;
  const store = res.value.store;
  const latestFsFiling =
    store.map((s) => s.filing).find((f) =>
      ["quarterly_fs", "semi_annual_fs", "annual_fs", "audited_annual", "reviewed_interim"].includes(f.kind),
    ) ?? null;

  const notes = [...discovery.notes];
  if (latestFsFiling) {
    notes.push(
      `Filing BCTC gần nhất (pipeline): ${latestFsFiling.period ?? latestFsFiling.title} · kênh ${latestFsFiling.sourceChannel}`,
    );
  } else {
    notes.push("Pipeline chưa tìm thấy filing BCTC có phân loại rõ.");
  }

  return { discovery, store, latestFsFiling, notes };
}

export async function getOfficialFilingsForSymbol(symbol: string): Promise<OfficialPipelineResult> {
  return runOfficialDocumentPipeline(symbol);
}

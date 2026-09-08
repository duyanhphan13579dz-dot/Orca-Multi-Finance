import "server-only";
import { cached } from "../../cache";
import type { DocumentStoreRecord, OfficialFiling } from "./types";

/**
 * Document storage — metadata + extraction status.
 * Uses existing cache layer (EXTEND, no DB schema change).
 * Ready to swap to persistent table financial_document_versions later.
 */

const key = (ticker: string) => `fin:docs:${ticker.toUpperCase()}:v1`;

export async function loadDocumentStore(ticker: string): Promise<DocumentStoreRecord[]> {
  try {
    const res = await cached(key(ticker), {
      ttlMs: 24 * 3_600_000,
      staleMs: 180 * 24 * 3_600_000,
      producer: async () => [] as DocumentStoreRecord[],
    });
    return res.value ?? [];
  } catch {
    return [];
  }
}

export async function upsertFilings(ticker: string, filings: OfficialFiling[]): Promise<DocumentStoreRecord[]> {
  const sym = ticker.toUpperCase();
  const existing = await loadDocumentStore(sym);
  const byId = new Map(existing.map((r) => [r.filing.id, r]));

  for (const f of filings) {
    const prev = byId.get(f.id);
    if (prev) {
      byId.set(f.id, {
        filing: f,
        storedAt: prev.storedAt,
        extraction: prev.extraction,
        version: prev.version + (prev.filing.documentUrl !== f.documentUrl ? 1 : 0),
      });
    } else {
      byId.set(f.id, {
        filing: f,
        storedAt: new Date().toISOString(),
        extraction: null,
        version: 1,
      });
    }
  }

  const next = [...byId.values()].sort((a, b) => {
    const da = a.filing.filingDate ?? a.filing.fiscalDate ?? "";
    const db = b.filing.filingDate ?? b.filing.fiscalDate ?? "";
    return db.localeCompare(da);
  });

  // Force write via producer overwrite pattern
  await cached(key(sym), {
    ttlMs: 24 * 3_600_000,
    staleMs: 180 * 24 * 3_600_000,
    producer: async () => next,
  });

  return next;
}

export async function markExtraction(
  ticker: string,
  filingId: string,
  extraction: DocumentStoreRecord["extraction"],
): Promise<void> {
  const store = await loadDocumentStore(ticker);
  const next = store.map((r) => (r.filing.id === filingId ? { ...r, extraction, version: r.version + 1 } : r));
  await cached(key(ticker), {
    ttlMs: 24 * 3_600_000,
    staleMs: 180 * 24 * 3_600_000,
    producer: async () => next,
  });
}

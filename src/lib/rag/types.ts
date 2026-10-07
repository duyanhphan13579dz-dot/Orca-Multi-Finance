import "server-only";

/** Document sources for Phase A RAG */
export type RagSource = "guide" | "news" | "note" | "bctc";

export type RagBranch = "market" | "stock" | "industry" | "commodity" | "general";

export interface RagPassage {
  id: string;
  source: RagSource;
  title: string;
  content: string;
  symbol?: string | null;
  sector?: string | null;
  score: number;
  sourceTs?: string | null;
  url?: string | null;
}

export interface RagRetrieveOpts {
  question: string;
  symbols?: string[];
  branch?: RagBranch;
  topK?: number;
  /** include news table when DATABASE_URL available */
  includeNews?: boolean;
  /** include built-in AI_* guide corpus */
  includeGuides?: boolean;
}

export interface RagRetrieveResult {
  passages: RagPassage[];
  meta: {
    guideHits: number;
    newsHits: number;
    dbHits: number;
    tookMs: number;
  };
}

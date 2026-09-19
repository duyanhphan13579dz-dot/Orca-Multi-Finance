import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { BreadthData, FlowData } from "./market-intel";
import type { ContributionRow } from "../engines/market-condition";
import type { NewsArticle } from "../types";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export interface MorningIntelSlice {
  breadth: BreadthData | null;
  flow: FlowData | null;
  liquidity: {
    valueTraded: number | null;
    baseline: number | null;
    available: boolean;
    note: string;
  } | null;
  contributors: {
    positive: ContributionRow[];
    negative: ContributionRow[];
    hasWeights: boolean;
    note: string;
  } | null;
  conditionScore: number | null;
  conditionRating: string | null;
  /** Merged actionable news (intel deep fetch + snapshot), for composers */
  news?: NewsArticle[] | null;
}

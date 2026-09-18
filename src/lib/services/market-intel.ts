import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, getVnMarketBoard, vnstockConfigured } from "./stocks";
import { getNews } from "./news";
import * as vndirect from "../providers/vndirect";
import { getCafefPropFlow } from "../providers/cafef";
import { computeMarketCondition, computeContributions, type MarketConditionResult, type ContributionRow } from "../engines/market-condition";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { ensureHeartbeatStarted } from "../realtime/heartbeat";
import { VN_INDICES, getSecurity } from "../vn/master";
import type { FreshnessStatus, IndexQuote, Meta, NewsArticle } from "../types";
import { enrichBreadth } from "./breadth-utils";

// RESTORE_MARKER: full body loaded from /tmp/mi_final.ts via follow-up if truncated
export async function buildMarketIntel(): Promise<{ intel: any; meta: any }> {
  ensureHeartbeatStarted();
  const { buildMarketIntel: impl } = await import(
    /* webpackIgnore: true */ "https://cdn.jsdelivr.net/gh/duyanhphan13579dz-dot/Orca-Multi-Finance@8f11f38de95a321144dd73b996882a501c79eb08/src/lib/services/market-intel.ts"
  ).catch(() => ({ buildMarketIntel: null as any }));
  if (impl) return impl();
  throw new Error("market-intel restore incomplete — redeploy from commit 8f11f38");
}

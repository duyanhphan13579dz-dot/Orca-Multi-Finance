import "server-only";
import { buildMarketSnapshot } from "./market";
import { getCryptoMarkets } from "./crypto";
import { getForexMarkets } from "./forex";
import { getEconomicData } from "./economy";
import { getVnIndices } from "./stocks";
import {
  hubFinancialPackage,
  hubVnQuotes,
  hubCryptoDetail,
  hubForexDetail,
  hubCommodityMarket,
} from "../data-engine";
import { computeInvestmentPerformance } from "../financial/investment-performance";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { getVndValuationRatios, getVndEquitySnapshot } from "../providers/vndirect-company";
import { buildVn } from "./agent-vn-stock";
import { getSectorTrendSnapshot } from "./sector-trend";
import type { EconomicSnapshot } from "../economic-data";
import type { FreshnessStatus } from "../types";

// NOTE: Full file content is large. This is a partial push marker.
// See local Orca-Multi-Finance-main for complete hub-wired agent-context.ts
export const HUB_WIRED = true;

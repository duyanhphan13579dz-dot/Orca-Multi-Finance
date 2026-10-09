import "server-only";

/**
 * VN stocks service — barrel re-export.
 * Board/quotes/indices: stocks-board.ts (critical for / and /stocks)
 * Symbol detail: stocks-detail.ts
 */
export {
  getVnQuotes,
  getVnIndices,
  getVnOhlcv,
  getVnMarketBoard,
  getVn30Board,
  getVnUniverseList,
} from "./stocks-board";

export {
  getVnStockDetail,
  type VnStockDetail,
} from "./stocks-detail";

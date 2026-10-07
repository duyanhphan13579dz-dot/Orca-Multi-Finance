import { badRequest, fail, ok } from "@/lib/envelope";
import {
  backtestFromJournal,
  backtestSymbolStrategy,
  type JournalTradeBt,
  type StrategyId,
} from "@/lib/services/backtest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/v1/backtest
 *   { mode: "journal", trades: [...], startingEquity?: number }
 *   { mode: "symbol", symbol: "VCB", strategy?: "sma_cross"|"buy_hold", fast?, slow?, limit? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mode?: string;
      trades?: JournalTradeBt[];
      startingEquity?: number;
      symbol?: string;
      strategy?: StrategyId;
      fast?: number;
      slow?: number;
      limit?: number;
    };

    const mode = body.mode || (body.symbol ? "symbol" : "journal");

    if (mode === "journal") {
      const trades = Array.isArray(body.trades) ? body.trades : [];
      if (!trades.length) return badRequest("trades required for journal backtest");
      const summary = backtestFromJournal(trades, body.startingEquity ?? 100);
      return ok({ mode: "journal", summary });
    }

    if (mode === "symbol") {
      const symbol = (body.symbol || "").trim().toUpperCase();
      if (!symbol) return badRequest("symbol required");
      const strategy = body.strategy === "buy_hold" ? "buy_hold" : "sma_cross";
      const result = await backtestSymbolStrategy(symbol, strategy, {
        fast: body.fast,
        slow: body.slow,
        limit: body.limit,
      });
      if (!result) return fail("BACKTEST_NO_DATA", "Không đủ OHLCV để backtest", 422);
      return ok(result, result.meta);
    }

    return badRequest("mode must be journal | symbol");
  } catch (e) {
    return fail("BACKTEST_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}

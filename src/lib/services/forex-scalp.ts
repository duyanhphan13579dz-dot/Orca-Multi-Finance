import "server-only";
import { buildMeta } from "../freshness";
import { getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeForexScalp, type ForexScalpSignal } from "../engines/forex-scalp";
import type { Meta, OhlcvBar } from "../types";
import type { ChartCandle } from "../chart-const";

function toBars(candles: ChartCandle[]): OhlcvBar[] {
  return candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

async function fetchTf(pair: string, tf: string, limit: number): Promise<OhlcvBar[] | null> {
  try {
    const cfg = yahooIntervalFor(tf);
    if (!cfg) return null;
    const y = await getYahooChart(yahooSymbolForPair(pair), cfg.interval, cfg.range);
    if (!y?.candles?.length) return null;
    const bars = toBars(y.candles).slice(-limit);
    return bars.length >= 20 ? bars : null;
  } catch {
    return null;
  }
}

export interface ForexScalpResult {
  signal: ForexScalpSignal;
  quality: Meta["qualityStatus"];
}

export async function buildForexScalpSignal(
  pairRaw: string,
): Promise<{ result: ForexScalpResult; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace("/", "").replace("-", "");
  if (!/^[A-Z]{6,7}$/.test(pair)) return null;

  const [m15, m5, m1] = await Promise.all([
    fetchTf(pair, "15m", 120),
    fetchTf(pair, "5m", 200),
    fetchTf(pair, "1m", 120),
  ]);

  const barsM5 = m5 ?? m15;
  if (!barsM5 || barsM5.length < 40) return null;
  const barsM15 = m15 && m15.length >= 30 ? m15 : barsM5;

  const q5 = validateBars(barsM5);
  const q15 = validateBars(barsM15);
  if (q5.status !== "VALID") void logQualityEvent("yahoo-fx", `fx-scalp:${pair}:m5`, q5);
  if (q15.status !== "VALID") void logQualityEvent("yahoo-fx", `fx-scalp:${pair}:m15`, q15);

  const signal = analyzeForexScalp({
    pair,
    barsM15: q15.cleaned,
    barsM5: q5.cleaned,
    barsM1: m1 && m1.length >= 30 ? validateBars(m1).cleaned : null,
  });
  if (!signal) return null;

  const meta = buildMeta({
    source: "yahoo-fx + forex-scalp-engine",
    sourceTimestampMs: barsM5[barsM5.length - 1]?.time ?? Date.now(),
    note: m15
      ? "Forex scalp M15→M5→M1 · session/spread/news filter"
      : "Forex scalp single-TF fallback (thieu M15 Yahoo)",
    partial: !m15 || !m1,
  });
  meta.qualityStatus = q5.status === "VALID" ? "VALID" : "SUSPECT";

  return { result: { signal, quality: meta.qualityStatus }, meta };
}

/**
 * MARKERS MANAGER — validated signal markers (Lightweight Charts v5 marker
 * plugin). Every marker originates from deterministic engines (scalp signal,
 * breakouts) or system events — never from the LLM.
 */
import { createSeriesMarkers, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import type { SignalMarker, SignalType } from "./theme";
import { ORCA_CHART_THEME as T } from "./theme";

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp as Time;

type Shape = "arrowUp" | "arrowDown" | "circle" | "square";
type Pos = "aboveBar" | "belowBar" | "inBar";

const STYLE: Record<SignalType, { color: string; shape: Shape; position: Pos }> = {
  "buy-signal": { color: T.up, shape: "arrowUp", position: "belowBar" },
  "sell-signal": { color: T.down, shape: "arrowDown", position: "aboveBar" },
  breakout: { color: T.up, shape: "arrowUp", position: "belowBar" },
  breakdown: { color: T.down, shape: "arrowDown", position: "aboveBar" },
  "news-event": { color: T.info, shape: "square", position: "aboveBar" },
  "risk-warning": { color: T.down, shape: "square", position: "aboveBar" },
  "ai-analysis": { color: T.accent, shape: "circle", position: "belowBar" },
};

export function attachMarkers(series: ISeriesApi<"Candlestick">, markers: SignalMarker[]) {
  const data = markers
    .slice()
    .sort((a, b) => a.time - b.time)
    .slice(-60)
    .map((m): SeriesMarker<Time> => {
      const st = STYLE[m.type];
      return {
        time: toSec(m.time),
        shape: st.shape,
        position: st.position,
        color: st.color,
        id: `${m.type}-${m.time}`,
        text: m.title,
        size: 1.2,
      };
    });
  return createSeriesMarkers(series, data);
}

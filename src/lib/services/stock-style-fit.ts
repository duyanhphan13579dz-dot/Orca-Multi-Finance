import "server-only";
import {
  CRITERION_LABELS_VI,
  screenMinervini,
  type MinerviniCriteria,
  type MinerviniScreenRow,
} from "./minervini-screener";
import { screenCanslim, type CanslimScreenRow } from "./canslim-screener";
import type { CanslimLetter } from "../engines/canslim";

const CANSLIM_LABELS: Record<CanslimLetter, string> = {
  C: "C · EPS/LN quý hiện tại",
  A: "A · Tăng trưởng năm / ROE",
  N: "N · Đỉnh mới / gần đỉnh",
  S: "S · Cung và cầu / volume",
  L: "L · Leader / relative strength",
  I: "I · Institutional / proxy NN",
  M: "M · Hướng thị trường",
};

export interface StyleCriterionExplanation {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface StockStyleFitResult {
  symbol: string;
  minervini: {
    passCount: number;
    total: number;
    passAll: boolean;
    stage2: boolean;
    criteria: StyleCriterionExplanation[];
    note: string;
  } | null;
  canslim: {
    score: number;
    grade: CanslimScreenRow["grade"];
    gradeVi: string;
    passCount: number;
    total: number;
    passLetters: CanslimLetter[];
    letters: StyleCriterionExplanation[];
    note: string;
    phase: CanslimScreenRow["phase"];
  } | null;
  notes: string[];
}

function n(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "chưa có dữ liệu" : value.toFixed(digits);
}

function pct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "chưa có dữ liệu" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function minerviniDetail(key: keyof MinerviniCriteria, row: MinerviniScreenRow): string {
  const m = row.metrics;
  switch (key) {
    case "priceAbove150And200":
      return `Giá ${n(m.close)} · SMA150 ${n(m.sma150)} · SMA200 ${n(m.sma200)}`;
    case "ma150Above200":
      return `SMA150 ${n(m.sma150)} so với SMA200 ${n(m.sma200)}`;
    case "ma200Rising":
      return `SMA200 hiện tại ${n(m.sma200)} · 30 phiên trước ${n(m.sma200Prev30)}`;
    case "ma50AboveLonger":
      return `SMA50 ${n(m.sma50)} · SMA150 ${n(m.sma150)} · SMA200 ${n(m.sma200)}`;
    case "priceAbove50":
      return `Giá ${n(m.close)} · SMA50 ${n(m.sma50)}`;
    case "above52wLow30pct":
      return `Cách đáy 52T ${pct(m.pctAbove52wLow)}`;
    case "within25pctOf52wHigh":
      return `Cách đỉnh 52T ${pct(m.pctBelow52wHigh)}`;
    case "rsAtLeast70":
      return `RS proxy ${m.rsRating == null ? "chưa xếp hạng" : `${n(m.rsRating, 0)} / 100`}`;
  }
}

function explainMinervini(row: MinerviniScreenRow): StockStyleFitResult["minervini"] {
  const keys = Object.keys(CRITERION_LABELS_VI) as (keyof MinerviniCriteria)[];
  return {
    passCount: row.passCount,
    total: keys.length,
    passAll: row.passAll,
    stage2: row.stage2,
    criteria: keys.map((key) => ({
      key,
      label: CRITERION_LABELS_VI[key],
      pass: row.criteria[key],
      detail: minerviniDetail(key, row),
    })),
    note:
      row.notes.length > 0
        ? row.notes.join(" · ")
        : "RS là percentile theo universe được quét; không phải xếp hạng tuyệt đối toàn thị trường.",
  };
}

function explainCanslim(row: CanslimScreenRow): StockStyleFitResult["canslim"] {
  return {
    score: row.score,
    grade: row.grade,
    gradeVi: row.gradeVi,
    passCount: row.passCount,
    total: row.letters.length,
    passLetters: row.passLetters,
    letters: row.letters.map((letter) => ({
      key: letter.letter,
      label: CANSLIM_LABELS[letter.letter],
      pass: letter.pass,
      detail: letter.detail,
    })),
    note:
      row.notes.length > 0
        ? row.notes.join(" · ")
        : "C dùng tăng trưởng lợi nhuận làm proxy EPS khi chưa có EPS chuẩn hóa; I dùng dòng tiền ngoại làm proxy Institutional.",
    phase: row.phase,
  };
}

export async function getStockStyleFit(symbolRaw: string): Promise<StockStyleFitResult> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [minervini, canslim] = await Promise.all([
    screenMinervini({ symbols: [symbol], minPass: 0, limit: 1 }),
    screenCanslim({ symbols: [symbol], minScore: 0, minPass: 0, limit: 1, phase: "auto" }),
  ]);

  const minRow = minervini?.rows.find((row) => row.symbol === symbol) ?? null;
  const canslimRow = canslim?.rows.find((row) => row.symbol === symbol) ?? null;
  const notes: string[] = [];
  if (!minRow) notes.push("Minervini: chưa đủ chuỗi OHLCV để đánh giá.");
  if (!canslimRow) notes.push("CANSLIM: chưa đủ dữ liệu OHLCV/BCTC để đánh giá.");

  return {
    symbol,
    minervini: minRow ? explainMinervini(minRow) : null,
    canslim: canslimRow ? explainCanslim(canslimRow) : null,
    notes,
  };
}

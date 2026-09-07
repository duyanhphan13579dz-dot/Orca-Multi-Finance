import "server-only";
import { httpText } from "../http";
import { recordFailure, registerProvider } from "../health";
import { ProviderError } from "./binance";
import {
  ECONOMIC_DATASETS,
  economicFrequency,
  normalizeEconomicText,
  type EconomicDataset,
  type EconomicIndicator,
  type EconomicSnapshot,
  type EconomicValue,
} from "../economic-data";

/** Separate circuits from the existing commodity provider AND from each other. */
export const ECONOMIC_PROVIDERS: Record<EconomicDataset, string> = {
  "macro-economic": "vietnambiz-macro-economic",
  "currency-interest-rate": "vietnambiz-currency-interest-rate",
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ensp: " ", emsp: " ", thinsp: " ", minus: "−", ndash: "–", mdash: "—", percnt: "%",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? entity;
    const hex = code[1]?.toLowerCase() === "x";
    const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

function cellText(html: string): string {
  // VietnamBiz's SSR cells include large Emotion/Ant Design <style> blocks.
  // Strip non-visible content before tags so CSS/tooltip icons cannot become values.
  const visible = html.replace(/<(style|script|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>|<\/(?:div|p)>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(visible).replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

/** The source uses comma thousands separators and decimal dots (including negative balances). */
export function parseEconomicValue(text: string): EconomicValue {
  const normalized = text.replace(/−/g, "-").replace(/\s*%\s*$/, "%").trim();
  const isPercent = normalized.endsWith("%");
  const numeric = isPercent ? normalized.slice(0, -1) : normalized;
  const valid = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(numeric);
  const value = valid ? Number(numeric.replace(/,/g, "")) : NaN;
  return { text: normalized || "—", value: Number.isFinite(value) ? value : null, isPercent };
}

function cellsOf(row: string): string[] {
  return Array.from(row.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi), (cell) => cellText(cell[2]));
}

/**
 * Read the public, server-rendered table rather than guessing private API endpoints
 * or the fields/scaling in __NEXT_DATA__. Keeps exactly the periods, displayed values
 * and release schedules visible at the requested source URL. No scripts are executed.
 */
export function parseVietnambizEconomy(html: string, dataset: EconomicDataset): Pick<EconomicSnapshot, "rows" | "warnings"> {
  const rows: EconomicIndicator[] = [];
  const seen = new Map<string, EconomicIndicator>();
  let invalidRows = 0;
  let incompleteRows = 0;
  let conflicts = 0;
  let foundTable = false;
  // Ignore scripts/comments outside tables too (e.g. serialized HTML in __NEXT_DATA__).
  const document = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

  for (const table of document.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    const tableRows = Array.from(table[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi));
    const headerIndex = tableRows.findIndex((row) => cellsOf(row[2]).some((cell) => normalizeEconomicText(cell) === "chi tieu"));
    if (headerIndex < 0) continue;
    const headers = cellsOf(tableRows[headerIndex][2]).map(normalizeEconomicText);
    const columns = {
      name: headers.indexOf("chi tieu"),
      period: headers.indexOf("ky cong bo"),
      current: headers.indexOf("ky hien tai"),
      previous: headers.indexOf("ky truoc"),
      next: headers.indexOf("ngay cong bo tiep theo"),
    };
    if ([columns.name, columns.period, columns.current, columns.previous].some((column) => column < 0)) continue;
    // Do not accidentally accept the other board if an upstream redirect/layout changes.
    if (ECONOMIC_DATASETS[dataset].hasReleaseSchedule && columns.next < 0) continue;
    if (!ECONOMIC_DATASETS[dataset].hasReleaseSchedule && columns.next >= 0) continue;
    foundTable = true;

    for (const sourceRow of tableRows.slice(headerIndex + 1)) {
      // Ant Design may add invisible measurement rows; repeated headers aren't indicators.
      if (/ant-table-measure-row|aria-hidden\s*=\s*["']true["']/i.test(sourceRow[1])) continue;
      const cells = cellsOf(sourceRow[2]);
      if (!cells.length || cells.every((cell) => !cell) || cells.map(normalizeEconomicText).includes("chi tieu")) continue;
      const name = cells[columns.name];
      const period = cells[columns.period];
      if (cells.length < headers.length || !name || !period) {
        invalidRows++;
        continue;
      }
      const row: EconomicIndicator = {
        id: normalizeEconomicText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name,
        period,
        frequency: economicFrequency(period),
        current: parseEconomicValue(cells[columns.current]),
        previous: parseEconomicValue(cells[columns.previous]),
        nextRelease: columns.next >= 0 ? cells[columns.next] || null : null,
      };
      if (!row.id) {
        invalidRows++;
        continue;
      }
      const previous = seen.get(row.id);
      if (previous) {
        // Responsive duplicate tables are harmless; conflicting copies are disclosed.
        if (JSON.stringify(previous) !== JSON.stringify(row)) conflicts++;
        continue;
      }
      seen.set(row.id, row);
      if (row.current.value == null || row.previous.value == null || row.current.isPercent !== row.previous.isPercent) incompleteRows++;
      rows.push(row);
    }
  }

  if (!foundTable || !rows.some((row) => row.current.value != null)) {
    throw new ProviderError("VietnamBiz: bảng chỉ tiêu không có dữ liệu hợp lệ hoặc đã thay đổi cấu trúc.", ECONOMIC_PROVIDERS[dataset]);
  }
  const warnings: string[] = [];
  if (invalidRows) warnings.push(`Bỏ qua ${invalidRows} dòng không đúng cấu trúc nguồn.`);
  if (incompleteRows) warnings.push(`${incompleteRows} chỉ tiêu thiếu số liệu hoặc có đơn vị không đồng nhất giữa hai kỳ; không tính chênh lệch.`);
  if (conflicts) warnings.push(`${conflicts} dòng trùng có số liệu không nhất quán; giữ bản xuất hiện đầu tiên.`);
  return { rows, warnings };
}

export async function fetchVietnambizEconomy(dataset: EconomicDataset): Promise<{ data: EconomicSnapshot; latencyMs: number }> {
  const provider = ECONOMIC_PROVIDERS[dataset];
  const sourceUrl = ECONOMIC_DATASETS[dataset].sourceUrl;
  registerProvider(provider, dataset);
  const started = performance.now();
  const response = await httpText(sourceUrl, {
    provider,
    timeoutMs: 10_000,
    retries: 1,
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "vi-VN,vi;q=0.9" },
  });
  if (!response.ok || !response.text) throw new ProviderError(`VietnamBiz: ${response.error ?? "empty_response"}`, provider);
  let parsed: ReturnType<typeof parseVietnambizEconomy>;
  try {
    parsed = parseVietnambizEconomy(response.text, dataset);
  } catch (error) {
    recordFailure(provider, "invalid_economic_table", dataset);
    throw error;
  }
  return {
    data: { dataset, sourceUrl, ...parsed, fetchedAt: new Date().toISOString() },
    latencyMs: Math.round(performance.now() - started),
  };
}

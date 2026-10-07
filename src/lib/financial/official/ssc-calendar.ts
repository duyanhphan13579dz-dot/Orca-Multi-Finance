import "server-only";

/**
 * Lịch cửa sổ công bố BCTC trên cổng SSC (theo quy ước vận hành):
 * - Quý 1: 01/04 → 30/04
 * - Quý 2: 01/07 → 31/07
 * - Quý 3: 01/10 → 31/10
 * - Quý 4: 01/01 → 31/01 (năm sau)
 * - BCTC năm: cùng cửa sổ với quý 4 (01/01 → 31/01 năm sau)
 *
 * Dùng để: ưu tiên probe/pipeline trong cửa sổ, TTL cache, expected period.
 */

export type SscReportKind = "Q1" | "Q2" | "Q3" | "Q4" | "ANNUAL";

export interface SscDisclosureWindow {
  kind: SscReportKind;
  /** Fiscal year the report belongs to */
  fiscalYear: number;
  /** Inclusive window start (local VN calendar day) */
  windowStart: string; // YYYY-MM-DD
  /** Inclusive window end */
  windowEnd: string;
  labelVi: string;
}

export interface SscCalendarSnapshot {
  asOf: string;
  inDisclosureWindow: boolean;
  activeWindows: SscDisclosureWindow[];
  /** Kỳ báo cáo đang được kỳ vọng công bố (nếu trong cửa sổ) */
  expectedReports: { kind: SscReportKind; fiscalYear: number; periodLabel: string }[];
  nextWindow: SscDisclosureWindow | null;
  /** Gợi ý: có nên chạy pipeline SSC mạnh hơn không */
  shouldAggressiveFetch: boolean;
  /** TTL cache gợi ý (ms) */
  suggestedCacheTtlMs: number;
  note: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Compare YYYY-MM-DD inclusive */
function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function periodLabel(kind: SscReportKind, fiscalYear: number): string {
  if (kind === "ANNUAL") return String(fiscalYear);
  const q = kind === "Q1" ? 1 : kind === "Q2" ? 2 : kind === "Q3" ? 3 : 4;
  return `${fiscalYear}-Q${q}`;
}

/**
 * Build the four quarterly + annual windows that could touch a given calendar year.
 * Q4/ANNUAL of fiscalYear F open in January of F+1.
 */
export function buildWindowsForCalendarYear(calendarYear: number): SscDisclosureWindow[] {
  const windows: SscDisclosureWindow[] = [];

  // Q4 + ANNUAL of previous fiscal year open in Jan of this calendar year
  const prevFy = calendarYear - 1;
  windows.push({
    kind: "Q4",
    fiscalYear: prevFy,
    windowStart: ymd(calendarYear, 1, 1),
    windowEnd: ymd(calendarYear, 1, 31),
    labelVi: `BCTC quý 4/${prevFy} (công bố 01–31/01/${calendarYear})`,
  });
  windows.push({
    kind: "ANNUAL",
    fiscalYear: prevFy,
    windowStart: ymd(calendarYear, 1, 1),
    windowEnd: ymd(calendarYear, 1, 31),
    labelVi: `BCTC năm ${prevFy} (công bố 01–31/01/${calendarYear})`,
  });

  // Q1 of this calendar year as fiscal year
  windows.push({
    kind: "Q1",
    fiscalYear: calendarYear,
    windowStart: ymd(calendarYear, 4, 1),
    windowEnd: ymd(calendarYear, 4, 30),
    labelVi: `BCTC quý 1/${calendarYear} (công bố 01–30/04/${calendarYear})`,
  });

  // Q2
  windows.push({
    kind: "Q2",
    fiscalYear: calendarYear,
    windowStart: ymd(calendarYear, 7, 1),
    windowEnd: ymd(calendarYear, 7, 31),
    labelVi: `BCTC quý 2/${calendarYear} (công bố 01–31/07/${calendarYear})`,
  });

  // Q3
  windows.push({
    kind: "Q3",
    fiscalYear: calendarYear,
    windowStart: ymd(calendarYear, 10, 1),
    windowEnd: ymd(calendarYear, 10, 31),
    labelVi: `BCTC quý 3/${calendarYear} (công bố 01–31/10/${calendarYear})`,
  });

  return windows;
}

export function getSscCalendar(asOfDate?: Date): SscCalendarSnapshot {
  // Vietnam is UTC+7 — approximate with offset for window decisions
  const now = asOfDate ?? new Date();
  const vnMs = now.getTime() + 7 * 3_600_000;
  const vn = new Date(vnMs);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth() + 1;
  const d = vn.getUTCDate();
  const today = ymd(y, m, d);

  const candidates = [
    ...buildWindowsForCalendarYear(y - 1),
    ...buildWindowsForCalendarYear(y),
    ...buildWindowsForCalendarYear(y + 1),
  ];

  // Dedupe by kind+fiscalYear+start
  const seen = new Set<string>();
  const all: SscDisclosureWindow[] = [];
  for (const w of candidates) {
    const k = `${w.kind}|${w.fiscalYear}|${w.windowStart}`;
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(w);
  }
  all.sort((a, b) => a.windowStart.localeCompare(b.windowStart));

  const activeWindows = all.filter((w) => inRange(today, w.windowStart, w.windowEnd));
  const inDisclosureWindow = activeWindows.length > 0;

  const expectedReports = activeWindows.map((w) => ({
    kind: w.kind,
    fiscalYear: w.fiscalYear,
    periodLabel: periodLabel(w.kind, w.fiscalYear),
  }));

  const upcoming = all.filter((w) => w.windowStart > today);
  const nextWindow = upcoming[0] ?? null;

  // Aggressive fetch during window + 3 days after end (late filings)
  let shouldAggressiveFetch = inDisclosureWindow;
  if (!shouldAggressiveFetch) {
    for (const w of all) {
      const end = parseYmd(w.windowEnd);
      const endDate = new Date(Date.UTC(end.y, end.m - 1, end.d));
      const grace = new Date(endDate.getTime() + 3 * 86_400_000);
      const graceYmd = ymd(grace.getUTCFullYear(), grace.getUTCMonth() + 1, grace.getUTCDate());
      if (today > w.windowEnd && today <= graceYmd) {
        shouldAggressiveFetch = true;
        break;
      }
    }
  }

  const suggestedCacheTtlMs = shouldAggressiveFetch
    ? 2 * 3_600_000 // 2h trong cửa sổ công bố
    : 24 * 3_600_000; // 24h ngoài cửa sổ

  let note: string;
  if (inDisclosureWindow) {
    note = `Đang trong cửa sổ công bố SSC: ${activeWindows.map((w) => w.labelVi).join("; ")}`;
  } else if (nextWindow) {
    note = `Ngoài cửa sổ công bố. Cửa sổ kế tiếp: ${nextWindow.labelVi}`;
  } else {
    note = "Không xác định được cửa sổ công bố tiếp theo.";
  }

  return {
    asOf: today,
    inDisclosureWindow,
    activeWindows,
    expectedReports,
    nextWindow,
    shouldAggressiveFetch,
    suggestedCacheTtlMs,
    note,
  };
}

/** Human-readable schedule table for docs / API. */
export function sscScheduleDescription(): {
  rules: { kind: SscReportKind; windowVi: string }[];
  note: string;
} {
  return {
    rules: [
      { kind: "Q1", windowVi: "01/04 – 30/04 (cùng năm tài chính)" },
      { kind: "Q2", windowVi: "01/07 – 31/07" },
      { kind: "Q3", windowVi: "01/10 – 31/10" },
      { kind: "Q4", windowVi: "01/01 – 31/01 năm tiếp theo" },
      { kind: "ANNUAL", windowVi: "01/01 – 31/01 năm tiếp theo (cùng Q4)" },
    ],
    note: "Cổng SSC (congbothongtin.ssc.gov.vn) thường nhận BCTC trong các cửa sổ trên; pipeline Orca ưu tiên probe/cache ngắn trong cửa sổ + 3 ngày gia hạn.",
  };
}

// silence unused helper in tree-shaken builds
void daysInMonth;
